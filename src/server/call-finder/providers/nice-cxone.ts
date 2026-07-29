import "server-only";

import { InteractionDirection, InteractionProvider } from "@prisma/client";
import { z } from "zod";
import type {
  CallSourceAdapter,
  NormalizedProviderCall,
  ProviderCallPage,
  ProviderCallSearch,
} from "@/server/call-finder/providers/contracts";
import type { NiceCxoneAccessKeyTokenProvider } from "@/server/call-finder/providers/nice-cxone-auth";

const idSchema = z.union([z.string(), z.number()]).transform(String);
const optionalIdSchema = idSchema.nullish().transform((value) => value ?? null);

const completedContactSchema = z
  .object({
    contactId: idSchema,
    masterContactId: optionalIdSchema,
    agentId: optionalIdSchema,
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    campaignId: optionalIdSchema,
    campaignName: z.string().nullish(),
    skillId: optionalIdSchema,
    skillName: z.string().nullish(),
    teamId: optionalIdSchema,
    teamName: z.string().nullish(),
    primaryDispositionId: optionalIdSchema,
    secondaryDispositionId: optionalIdSchema,
    isOutbound: z.boolean().nullish(),
    isLogged: z.boolean().nullish(),
    fromAddr: z.string().nullish(),
    toAddr: z.string().nullish(),
    contactStart: z.string().min(1),
    totalDurationSeconds: z.coerce.number().finite().nonnegative(),
    holdCount: z.coerce.number().int().nonnegative().nullish(),
    holdSeconds: z.coerce.number().finite().nonnegative().nullish(),
    mediaType: z.union([z.string(), z.number()]).nullish(),
    mediaTypeName: z.string().nullish(),
    pointOfContactId: optionalIdSchema,
    pointOfContactName: z.string().nullish(),
    transferIndicatorId: optionalIdSchema,
    transferIndicatorName: z.string().nullish(),
    endReason: z.string().nullish(),
  })
  .passthrough();

const completedContactsResponseSchema = z.object({
  totalRecords: z.coerce.number().int().nonnegative(),
  completedContacts: z.array(completedContactSchema),
});

const mediaDownloadResponseSchema = z.object({ redirectUrl: z.url() });

const legacyContactFileSchema = z
  .object({
    isDeleted: z.boolean().nullish(),
    weblink: z.boolean().nullish(),
    fileName: z.string().min(1),
    fullFileName: z.string().min(1),
    size: z.coerce.number().int().nonnegative().nullish(),
    purposeName: z.union([z.string(), z.number()]).nullish(),
    modifiedDate: z.string().nullish(),
  })
  .passthrough();

const legacyContactFilesResponseSchema = z.object({
  files: z.array(legacyContactFileSchema),
});

const legacyFileResponseSchema = z.object({
  files: z.object({
    file: z.string().min(1),
    fileName: z.string().min(1),
  }),
});

const DEFAULT_MAX_LEGACY_RECORDING_BYTES = 100 * 1024 * 1024;
const MAX_METADATA_RESPONSE_BYTES = 1024 * 1024;
const JSON_RESPONSE_OVERHEAD_BYTES = 64 * 1024;

export type NiceCxoneScopeField = "campaign" | "skill";
export type NiceCxoneRecordingMode = "legacy-acd" | "media-playback";

export type NiceCxoneAdapterConfig = {
  instanceKey: string;
  apiBaseUrl: string;
  mediaBaseUrl?: string;
  scopeField: NiceCxoneScopeField;
  pageSize?: number;
  recordingMode?: NiceCxoneRecordingMode;
  legacyFilesApiVersion?: string;
  maxLegacyRecordingBytes?: number;
};

type TokenProvider = Pick<NiceCxoneAccessKeyTokenProvider, "getAccessToken" | "invalidate">;

function validateNiceBaseUrl(value: string, expected: "api" | "media") {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const isNiceHost = host.endsWith(".nice-incontact.com") || host.endsWith(".niceincontact.com");
  const hasExpectedHost = expected === "api" ? host.startsWith("api-") : !host.startsWith("api-");
  if (
    url.protocol !== "https:" ||
    !isNiceHost ||
    !hasExpectedHost ||
    url.username ||
    url.password
  ) {
    throw new Error(`Invalid NICE CXone ${expected} base URL`);
  }
  return url.origin;
}

function validateTemporaryMediaUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowed =
    host.endsWith(".amazonaws.com") ||
    host.endsWith(".nice-incontact.com") ||
    host.endsWith(".niceincontact.com");
  if (url.protocol !== "https:" || !allowed || url.username || url.password) {
    throw new Error("NICE CXone returned an untrusted media URL");
  }
  return url.toString();
}

function validateApiVersion(value: string) {
  if (!/^v[1-9]\d*\.0$/.test(value)) {
    throw new Error("NICE_CXONE_ADMIN_API_VERSION must use the vNN.0 format");
  }
  return value;
}

function validatePositiveInteger(value: number, message: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(message);
  return value;
}

function normalizedLegacyPath(value: string) {
  return value.replaceAll("\\", "/");
}

function isTrustedCallLogPath(value: string) {
  if (!value || value.length > 2_048 || /[\0\r\n]/.test(value)) return false;
  const normalized = normalizedLegacyPath(value);
  const segments = normalized.split("/");
  return (
    segments.length >= 2 &&
    segments[0]?.toLowerCase() === "calllog" &&
    !segments.some((segment) => !segment || segment === "." || segment === "..") &&
    normalized.toLowerCase().endsWith(".wav")
  );
}

function selectLegacyCallLog(files: z.infer<typeof legacyContactFileSchema>[]) {
  return files
    .filter((file) => {
      const purposeName = String(file.purposeName ?? "")
        .trim()
        .toLowerCase();
      return (
        file.isDeleted !== true &&
        file.weblink !== true &&
        (purposeName === "calllog" ||
          normalizedLegacyPath(file.fullFileName).toLowerCase().startsWith("calllog/")) &&
        isTrustedCallLogPath(file.fullFileName) &&
        file.fileName.toLowerCase().endsWith(".wav")
      );
    })
    .sort((left, right) => {
      const sizeDifference = (right.size ?? 0) - (left.size ?? 0);
      if (sizeDifference !== 0) return sizeDifference;
      return String(right.modifiedDate ?? "").localeCompare(String(left.modifiedDate ?? ""));
    })[0];
}

class NiceCxonePayloadTooLargeError extends Error {}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new NiceCxonePayloadTooLargeError("NICE CXone response exceeded the size limit");
  }
  if (!response.body) throw new Error("NICE CXone returned an empty response");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new NiceCxonePayloadTooLargeError("NICE CXone response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const payload = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    totalBytes,
  ).toString("utf8");
  return JSON.parse(payload) as unknown;
}

function decodeBase64Recording(value: string, maximumBytes: number) {
  const normalized = value.replace(/[\t\n\r ]/g, "");
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) ||
    normalized.slice(0, -2).includes("=")
  ) {
    throw new Error("NICE CXone returned invalid Base64 recording data");
  }

  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const decodedSize = (normalized.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(decodedSize) || decodedSize < 1) {
    throw new Error("NICE CXone returned an empty recording");
  }
  if (decodedSize > maximumBytes) {
    throw new NiceCxonePayloadTooLargeError("NICE CXone recording exceeded the size limit");
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.byteLength !== decodedSize) {
    throw new Error("NICE CXone returned truncated Base64 recording data");
  }
  return decoded;
}

function fourCharacterCode(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] ?? 0) +
    (bytes[offset + 1] ?? 0) * 0x100 +
    (bytes[offset + 2] ?? 0) * 0x1_0000 +
    (bytes[offset + 3] ?? 0) * 0x100_0000
  );
}

function isValidWaveRecording(bytes: Uint8Array) {
  if (
    bytes.byteLength < 44 ||
    fourCharacterCode(bytes, 0) !== "RIFF" ||
    fourCharacterCode(bytes, 8) !== "WAVE"
  ) {
    return false;
  }

  const containerEnd = readUint32LE(bytes, 4) + 8;
  if (containerEnd < 44 || containerEnd > bytes.byteLength) return false;

  let hasFormat = false;
  let hasAudioData = false;
  let offset = 12;
  while (offset + 8 <= containerEnd) {
    const chunkName = fourCharacterCode(bytes, offset);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > containerEnd) return false;

    if (chunkName === "fmt ") {
      if (chunkSize < 16) return false;
      const format = readUint16LE(bytes, dataStart);
      const channels = readUint16LE(bytes, dataStart + 2);
      const sampleRate = readUint32LE(bytes, dataStart + 4);
      const byteRate = readUint32LE(bytes, dataStart + 8);
      const blockAlign = readUint16LE(bytes, dataStart + 12);
      const bitsPerSample = readUint16LE(bytes, dataStart + 14);
      if (
        format < 1 ||
        channels < 1 ||
        sampleRate < 1 ||
        byteRate < 1 ||
        blockAlign < 1 ||
        bitsPerSample < 1
      ) {
        return false;
      }
      hasFormat = true;
    }
    if (chunkName === "data" && chunkSize > 0) hasAudioData = true;

    offset = dataEnd + (chunkSize % 2);
  }
  return hasFormat && hasAudioData;
}

function safeLegacyFileName(value: string, contactId: string) {
  const baseName = value.split(/[\\/]/).at(-1) ?? "";
  const sanitized = baseName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\r\n"\\]/g, "_")
    .slice(0, 150);
  return sanitized.toLowerCase().endsWith(".wav") ? sanitized : `contact-${contactId}.wav`;
}

function safeProviderStatus(response: Response) {
  return new Response(null, { status: response.status, statusText: response.statusText });
}

function requiredEnvironmentValue(environment: Record<string, string | undefined>, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function loadNiceCxoneAdapterConfig(
  environment: Record<string, string | undefined> = process.env,
): NiceCxoneAdapterConfig {
  const scopeField = environment.NICE_CXONE_SCOPE_FIELD?.trim().toLowerCase() ?? "campaign";
  if (scopeField !== "campaign" && scopeField !== "skill") {
    throw new Error("NICE_CXONE_SCOPE_FIELD must be campaign or skill");
  }
  const pageSize = z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(1_000)
    .parse(environment.NICE_CXONE_PAGE_SIZE?.trim() || undefined);
  const recordingMode = z
    .enum(["legacy-acd", "media-playback"])
    .default("legacy-acd")
    .parse(environment.NICE_CXONE_RECORDING_MODE?.trim().toLowerCase() || undefined);
  const mediaBaseUrl = environment.NICE_CXONE_MEDIA_BASE_URL?.trim();
  if (recordingMode === "media-playback" && !mediaBaseUrl) {
    throw new Error("NICE_CXONE_MEDIA_BASE_URL is required for Media Playback");
  }
  const legacyFilesApiVersion = validateApiVersion(
    environment.NICE_CXONE_ADMIN_API_VERSION?.trim() || "v34.0",
  );
  const maxLegacyRecordingBytes = z.coerce
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .default(DEFAULT_MAX_LEGACY_RECORDING_BYTES)
    .parse(environment.NICE_CXONE_MAX_LEGACY_RECORDING_BYTES?.trim() || undefined);
  return {
    instanceKey: requiredEnvironmentValue(environment, "NICE_CXONE_INSTANCE_KEY"),
    apiBaseUrl: validateNiceBaseUrl(
      requiredEnvironmentValue(environment, "NICE_CXONE_API_BASE_URL"),
      "api",
    ),
    ...(mediaBaseUrl ? { mediaBaseUrl: validateNiceBaseUrl(mediaBaseUrl, "media") } : {}),
    scopeField,
    pageSize,
    recordingMode,
    legacyFilesApiVersion,
    maxLegacyRecordingBytes,
  };
}

function providerAgentName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
) {
  const value = [firstName, lastName]
    .flatMap((part) => (part?.trim() ? [part.trim()] : []))
    .join(" ");
  return value || null;
}

function parseCursor(value: string | undefined) {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value)) throw new Error("Invalid NICE CXone cursor");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid NICE CXone cursor");
  return parsed;
}

function parseContactStart(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("NICE CXone returned an invalid call date");
  return parsed;
}

function normalizedPhone(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function contactMatchesFilters(call: NormalizedProviderCall, input: ProviderCallSearch) {
  if (
    input.providerAgentIds?.length &&
    !input.providerAgentIds.includes(call.providerAgentId ?? "")
  ) {
    return false;
  }
  if (input.direction && call.direction !== input.direction) return false;
  if (
    input.phoneNumber &&
    !normalizedPhone(call.phoneNumber).includes(normalizedPhone(input.phoneNumber))
  ) {
    return false;
  }
  if (input.minDurationSeconds !== undefined && call.durationSeconds < input.minDurationSeconds) {
    return false;
  }
  if (input.maxDurationSeconds !== undefined && call.durationSeconds > input.maxDurationSeconds) {
    return false;
  }
  return true;
}

export class NiceCxoneCallSourceAdapter implements CallSourceAdapter {
  readonly provider = InteractionProvider.NICE_CXONE;
  private readonly apiBaseUrl: string;
  private readonly mediaBaseUrl: string | null;
  private readonly pageSize: number;
  private readonly recordingMode: NiceCxoneRecordingMode;
  private readonly legacyFilesApiVersion: string;
  private readonly maxLegacyRecordingBytes: number;

  constructor(
    private readonly config: NiceCxoneAdapterConfig,
    private readonly tokenProvider: TokenProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.apiBaseUrl = validateNiceBaseUrl(config.apiBaseUrl, "api");
    this.recordingMode = config.recordingMode ?? "legacy-acd";
    this.mediaBaseUrl = config.mediaBaseUrl
      ? validateNiceBaseUrl(config.mediaBaseUrl, "media")
      : null;
    if (this.recordingMode === "media-playback" && !this.mediaBaseUrl) {
      throw new Error("NICE CXone Media Playback base URL is required");
    }
    this.legacyFilesApiVersion = validateApiVersion(config.legacyFilesApiVersion ?? "v34.0");
    this.maxLegacyRecordingBytes = validatePositiveInteger(
      config.maxLegacyRecordingBytes ?? DEFAULT_MAX_LEGACY_RECORDING_BYTES,
      "Invalid NICE CXone legacy recording size limit",
    );
    this.pageSize = config.pageSize ?? 100;
    if (!config.instanceKey.trim()) throw new Error("NICE CXone instance key is required");
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 1_000) {
      throw new Error("Invalid NICE CXone page size");
    }
  }

  private async authorizedFetch(url: URL, init: RequestInit = {}) {
    const execute = async (forceRefresh = false) => {
      const token = await this.tokenProvider.getAccessToken({ forceRefresh });
      return this.fetchImplementation(url, {
        ...init,
        headers: { ...init.headers, Accept: "application/json", Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    };
    let response = await execute();
    if (response.status === 401) {
      this.tokenProvider.invalidate();
      response = await execute(true);
    }
    return response;
  }

  async searchCalls(input: ProviderCallSearch): Promise<ProviderCallPage> {
    if (input.externalCampaignIds.length === 0) {
      throw new Error("NICE CXone synchronization requires an external scope");
    }
    const skip = parseCursor(input.cursor);
    const url = new URL("/incontactapi/services/v23.0/contacts/completed", this.apiBaseUrl);
    url.searchParams.set("startDate", input.startedFrom.toISOString());
    url.searchParams.set("endDate", input.startedTo.toISOString());
    url.searchParams.set("top", String(this.pageSize));
    url.searchParams.set("skip", String(skip));

    const response = await this.authorizedFetch(url);
    if (!response.ok)
      throw new Error(`NICE CXone completed contacts failed (HTTP ${response.status})`);
    const parsed = completedContactsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      const invalidFields = [
        ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
      ].slice(0, 8);
      throw new Error(
        `NICE CXone returned an invalid completed contacts response (${invalidFields.join(", ") || "unknown field"})`,
      );
    }

    const scopes = new Set(input.externalCampaignIds);
    const calls = parsed.data.completedContacts
      .map((contact): NormalizedProviderCall => {
        const startedAt = parseContactStart(contact.contactStart);
        const durationSeconds = Math.round(contact.totalDurationSeconds);
        const providerCampaignId =
          this.config.scopeField === "skill" ? contact.skillId : contact.campaignId;
        return {
          provider: InteractionProvider.NICE_CXONE,
          providerInstance: this.config.instanceKey,
          providerInteractionId: contact.contactId,
          providerRecordingId: contact.masterContactId ?? contact.contactId,
          providerCampaignId,
          providerAgentId: contact.agentId,
          providerAgentName: providerAgentName(contact.firstName, contact.lastName),
          dispositionCode: contact.primaryDispositionId,
          direction: contact.isOutbound
            ? InteractionDirection.OUTBOUND
            : InteractionDirection.INBOUND,
          phoneNumber: contact.isOutbound ? (contact.toAddr ?? null) : (contact.fromAddr ?? null),
          queueName: contact.skillName ?? contact.campaignName ?? null,
          status: contact.endReason ?? "COMPLETED",
          startedAt,
          endedAt: new Date(startedAt.getTime() + durationSeconds * 1_000),
          durationSeconds,
          hasRecording: contact.isLogged === true,
          metadata: {
            masterContactId: contact.masterContactId,
            campaignId: contact.campaignId,
            campaignName: contact.campaignName,
            skillId: contact.skillId,
            skillName: contact.skillName,
            teamId: contact.teamId,
            teamName: contact.teamName,
            mediaType: contact.mediaType,
            mediaTypeName: contact.mediaTypeName,
            pointOfContactId: contact.pointOfContactId,
            pointOfContactName: contact.pointOfContactName,
            primaryDispositionId: contact.primaryDispositionId,
            secondaryDispositionId: contact.secondaryDispositionId,
            holdCount: contact.holdCount,
            holdSeconds: contact.holdSeconds,
            transferIndicatorId: contact.transferIndicatorId,
            transferIndicatorName: contact.transferIndicatorName,
          },
        };
      })
      .filter(
        (call) =>
          call.providerCampaignId !== null &&
          scopes.has(call.providerCampaignId) &&
          contactMatchesFilters(call, input),
      );

    const nextOffset = skip + parsed.data.completedContacts.length;
    return {
      calls,
      nextCursor: nextOffset < parsed.data.totalRecords ? String(nextOffset) : null,
    };
  }

  private async fetchMediaPlaybackRecording(providerRecordingId: string) {
    if (!this.mediaBaseUrl) throw new Error("NICE CXone Media Playback is not configured");
    const url = new URL("/media-playback/v1/contacts", this.mediaBaseUrl);
    url.searchParams.set("acd-call-id", providerRecordingId);
    url.searchParams.set("media-type", "voice-only");
    url.searchParams.set("exclude-waveforms", "true");
    url.searchParams.set("isDownload", "true");
    const response = await this.authorizedFetch(url);
    if (!response.ok) return response;

    const parsed = mediaDownloadResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid NICE CXone media response" }, { status: 502 });
    }
    const mediaUrl = validateTemporaryMediaUrl(parsed.data.redirectUrl);
    return this.fetchImplementation(mediaUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  }

  private async fetchLegacyAcdRecording(contactId: string) {
    if (!/^\d{1,20}$/.test(contactId)) {
      throw new Error("Invalid NICE CXone contact ID");
    }

    const metadataUrl = new URL(
      `/incontactapi/services/${this.legacyFilesApiVersion}/contacts/${contactId}/files`,
      this.apiBaseUrl,
    );
    const metadataResponse = await this.authorizedFetch(metadataUrl);
    if (metadataResponse.status === 204) {
      return Response.json({ error: "Recording not found" }, { status: 404 });
    }
    if (!metadataResponse.ok) return safeProviderStatus(metadataResponse);

    let metadataPayload: unknown;
    try {
      metadataPayload = await readBoundedJson(metadataResponse, MAX_METADATA_RESPONSE_BYTES);
    } catch (error) {
      const status = error instanceof NiceCxonePayloadTooLargeError ? 413 : 502;
      return Response.json({ error: "Invalid NICE CXone ACD file response" }, { status });
    }
    const parsedMetadata = legacyContactFilesResponseSchema.safeParse(metadataPayload);
    if (!parsedMetadata.success) {
      return Response.json({ error: "Invalid NICE CXone ACD file response" }, { status: 502 });
    }

    const selectedFile = selectLegacyCallLog(parsedMetadata.data.files);
    if (!selectedFile) {
      return Response.json({ error: "Recording not found" }, { status: 404 });
    }
    if (
      selectedFile.size !== null &&
      selectedFile.size !== undefined &&
      selectedFile.size > this.maxLegacyRecordingBytes
    ) {
      return Response.json(
        { error: "Recording exceeds the configured size limit" },
        { status: 413 },
      );
    }

    const fileUrl = new URL(
      `/incontactapi/services/${this.legacyFilesApiVersion}/files`,
      this.apiBaseUrl,
    );
    fileUrl.searchParams.set("fileName", selectedFile.fullFileName);
    const fileResponse = await this.authorizedFetch(fileUrl, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!fileResponse.ok) return safeProviderStatus(fileResponse);

    const maximumJsonBytes =
      Math.ceil((this.maxLegacyRecordingBytes * 4) / 3) + JSON_RESPONSE_OVERHEAD_BYTES;
    let filePayload: unknown;
    try {
      filePayload = await readBoundedJson(fileResponse, maximumJsonBytes);
    } catch (error) {
      const status = error instanceof NiceCxonePayloadTooLargeError ? 413 : 502;
      return Response.json({ error: "Invalid NICE CXone ACD recording response" }, { status });
    }
    const parsedFile = legacyFileResponseSchema.safeParse(filePayload);
    if (!parsedFile.success) {
      return Response.json({ error: "Invalid NICE CXone ACD recording response" }, { status: 502 });
    }

    let recording: Buffer;
    try {
      recording = decodeBase64Recording(parsedFile.data.files.file, this.maxLegacyRecordingBytes);
    } catch (error) {
      const status = error instanceof NiceCxonePayloadTooLargeError ? 413 : 502;
      return Response.json({ error: "Invalid NICE CXone ACD recording response" }, { status });
    }
    if (
      selectedFile.size !== null &&
      selectedFile.size !== undefined &&
      selectedFile.size > 0 &&
      selectedFile.size !== recording.byteLength
    ) {
      return Response.json({ error: "Invalid NICE CXone ACD recording response" }, { status: 502 });
    }
    if (!isValidWaveRecording(recording)) {
      return Response.json({ error: "Invalid NICE CXone ACD recording response" }, { status: 502 });
    }

    const fileName = safeLegacyFileName(parsedFile.data.files.fileName, contactId);
    return new Response(new Uint8Array(recording), {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(recording.byteLength),
        "Content-Type": "audio/wav",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  async fetchRecording(input: {
    providerInteractionId: string;
    providerRecordingId?: string | null;
  }) {
    if (this.recordingMode === "legacy-acd") {
      return this.fetchLegacyAcdRecording(input.providerInteractionId);
    }
    return this.fetchMediaPlaybackRecording(
      input.providerRecordingId ?? input.providerInteractionId,
    );
  }
}
