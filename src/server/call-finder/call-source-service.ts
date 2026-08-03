import "server-only";

import { InteractionProvider, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import { createCallSourceAdapter } from "@/server/call-finder/providers/factory";
import {
  persistPlaybackRecording,
  persistRecordingResponse,
  type StoredRecording,
} from "@/server/call-finder/recording-ingest";
import { syncCampaignCallSource } from "@/server/call-finder/sync-engine";

const SUPPORTED_CALL_PROVIDERS = [
  InteractionProvider.NICE_CXONE,
  InteractionProvider.FREEPBX,
] as const;

const sourceSettingsSchema = z
  .object({
    initialLookbackHours: z.coerce.number().int().min(1).max(72).default(24),
    overlapMinutes: z.coerce.number().int().min(1).max(60).default(15),
    completionLagMinutes: z.coerce.number().int().min(0).max(60).default(5),
    maxPages: z.coerce.number().int().min(1).max(100).default(10),
    providerAgentIds: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(500)
      .transform((values) => [...new Set(values)])
      .optional(),
  })
  .passthrough();

type ServiceDatabase = typeof prisma;
type AdapterFactory = typeof createCallSourceAdapter;

type ServiceDependencies = {
  database?: ServiceDatabase;
  now?: () => Date;
  adapterFactory?: AdapterFactory;
  persistRecording?: typeof persistRecordingResponse;
  persistPlayback?: typeof persistPlaybackRecording;
};

export type CallSourceSyncScope = { campaignId?: string };

export class CallRecordingProviderError extends Error {
  constructor(
    message: string,
    readonly code: "RECORDING_NOT_FOUND" | "RECORDING_FORBIDDEN" | "RECORDING_UNAVAILABLE",
  ) {
    super(message);
    this.name = "CallRecordingProviderError";
  }
}

function settingsFromJson(value: Prisma.JsonValue | null) {
  const parsed = sourceSettingsSchema.safeParse(value ?? {});
  if (!parsed.success) throw new Error("Call source settings are invalid");
  return parsed.data;
}

function providerLabel(provider: InteractionProvider) {
  if (provider === InteractionProvider.NICE_CXONE) return "NICE CXone";
  if (provider === InteractionProvider.FREEPBX) return "FreePBX";
  return provider;
}

export async function syncEnabledCallSources(
  scope: CallSourceSyncScope = {},
  dependencies: ServiceDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const now = dependencies.now?.() ?? new Date();
  const adapterFactory = dependencies.adapterFactory ?? createCallSourceAdapter;
  const sources = await database.campaignCallSource.findMany({
    where: {
      provider: { in: [...SUPPORTED_CALL_PROVIDERS] },
      enabled: true,
      ...(scope.campaignId ? { campaignId: scope.campaignId } : {}),
    },
    select: {
      id: true,
      campaignId: true,
      provider: true,
      instanceKey: true,
      settings: true,
      lastSyncedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const results = [];
  for (const source of sources) {
    const settings = settingsFromJson(source.settings);
    const startedTo = new Date(now.getTime() - settings.completionLagMinutes * 60_000);
    const candidateFrom = source.lastSyncedAt
      ? new Date(source.lastSyncedAt.getTime() - settings.overlapMinutes * 60_000)
      : new Date(startedTo.getTime() - settings.initialLookbackHours * 3_600_000);
    const startedFrom =
      candidateFrom < startedTo ? candidateFrom : new Date(startedTo.getTime() - 60_000);

    const result = await syncCampaignCallSource(
      {
        sourceId: source.id,
        adapter: adapterFactory(source.provider, source.instanceKey),
        startedFrom,
        startedTo,
        maxPages: settings.maxPages,
        downloadRecordings: false,
        providerAgentIds: settings.providerAgentIds,
      },
      { database, now: () => now },
    );
    results.push({
      ...result,
      campaignId: source.campaignId,
      provider: source.provider,
      startedFrom,
      startedTo,
    });
  }
  return results;
}

type RecordingInteraction = {
  id: string;
  campaignId: string;
  provider: InteractionProvider;
  providerInstance: string;
  providerInteractionId: string;
  hasRecording: boolean;
  metadata: Prisma.JsonValue | null;
  startedAt: Date;
  durationSeconds: number;
};

function metadataString(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value[key];
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  return null;
}

function providerRecordingId(interaction: RecordingInteraction) {
  if (interaction.provider === InteractionProvider.NICE_CXONE) {
    return (
      metadataString(interaction.metadata, "masterContactId") ?? interaction.providerInteractionId
    );
  }
  if (interaction.provider === InteractionProvider.FREEPBX) {
    return metadataString(interaction.metadata, "recordingId") ?? interaction.providerInteractionId;
  }
  return interaction.providerInteractionId;
}

export async function attachProviderRecording(
  input: { interaction: RecordingInteraction; userId: string },
  dependencies: ServiceDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const persistRecording = dependencies.persistRecording ?? persistRecordingResponse;
  const persistPlayback = dependencies.persistPlayback ?? persistPlaybackRecording;
  const adapterFactory = dependencies.adapterFactory ?? createCallSourceAdapter;
  if (!SUPPORTED_CALL_PROVIDERS.some((provider) => provider === input.interaction.provider)) {
    throw new Error("This recording provider is not configured yet");
  }
  const label = providerLabel(input.interaction.provider);
  if (!input.interaction.hasRecording) {
    throw new Error(`${label} does not report a recording for this call`);
  }

  const existingAssets = await database.mediaAsset.findMany({
    where: { interactionId: input.interaction.id, kind: { in: ["ORIGINAL", "PLAYBACK"] } },
    select: {
      id: true,
      kind: true,
      storageKey: true,
      originalFileName: true,
      mimeType: true,
      byteSize: true,
      sha256: true,
      durationMs: true,
      channelCount: true,
    },
  });
  const existingPlayback = existingAssets.find((asset) => asset.kind === "PLAYBACK");
  if (existingPlayback) return { assetId: existingPlayback.id, attached: false };

  const existingOriginal = existingAssets.find((asset) => asset.kind === "ORIGINAL");
  if (existingOriginal && input.interaction.provider !== InteractionProvider.FREEPBX) {
    return { assetId: existingOriginal.id, attached: false };
  }

  let storedOriginal: StoredRecording;
  if (existingOriginal) {
    storedOriginal = {
      storageKey: existingOriginal.storageKey,
      originalFileName: existingOriginal.originalFileName,
      mimeType: existingOriginal.mimeType,
      byteSize: existingOriginal.byteSize,
      sha256: existingOriginal.sha256,
      durationMs: existingOriginal.durationMs,
      channelCount: existingOriginal.channelCount,
    };
  } else {
    const source = await database.campaignCallSource.findFirst({
      where: {
        campaignId: input.interaction.campaignId,
        provider: input.interaction.provider,
        instanceKey: input.interaction.providerInstance,
        enabled: true,
      },
      select: { id: true },
    });
    if (!source) throw new Error("The call source is not available");

    const response = await adapterFactory(
      input.interaction.provider,
      input.interaction.providerInstance,
    ).fetchRecording({
      providerInteractionId: input.interaction.providerInteractionId,
      providerRecordingId: providerRecordingId(input.interaction),
    });
    if (response.status === 404) {
      throw new CallRecordingProviderError(
        `${label} could not find the recording for this call. Verify recording retention on the provider.`,
        "RECORDING_NOT_FOUND",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new CallRecordingProviderError(
        `${label} denied access to this recording. Verify the server-side credentials and permissions.`,
        "RECORDING_FORBIDDEN",
      );
    }
    if (!response.ok) {
      throw new CallRecordingProviderError(
        `${label} recording retrieval is temporarily unavailable.`,
        "RECORDING_UNAVAILABLE",
      );
    }

    storedOriginal = await persistRecording({
      response,
      provider: input.interaction.provider,
      providerInstance: input.interaction.providerInstance,
      interactionId: input.interaction.id,
      startedAt: input.interaction.startedAt,
    });
  }

  let storedPlayback: StoredRecording | null = null;
  if (input.interaction.provider === InteractionProvider.FREEPBX) {
    try {
      storedPlayback = await persistPlayback({
        sourceStorageKey: storedOriginal.storageKey,
        provider: input.interaction.provider,
        providerInstance: input.interaction.providerInstance,
        interactionId: input.interaction.id,
        startedAt: input.interaction.startedAt,
      });
    } catch {
      throw new CallRecordingProviderError(
        "FreePBX recording could not be prepared for browser playback.",
        "RECORDING_UNAVAILABLE",
      );
    }
  }

  return database.$transaction(async (transaction) => {
    let originalAsset = await transaction.mediaAsset.findFirst({
      where: { interactionId: input.interaction.id, kind: "ORIGINAL" },
      select: { id: true },
    });
    let attached = false;
    if (!originalAsset) {
      originalAsset = await transaction.mediaAsset.create({
        data: {
          interactionId: input.interaction.id,
          kind: "ORIGINAL",
          storageKey: storedOriginal.storageKey,
          originalFileName: storedOriginal.originalFileName,
          mimeType: storedOriginal.mimeType,
          byteSize: storedOriginal.byteSize,
          sha256: storedOriginal.sha256,
          durationMs: storedOriginal.durationMs ?? input.interaction.durationSeconds * 1_000,
          channelCount: storedOriginal.channelCount,
        },
        select: { id: true },
      });
      attached = true;
    }

    let selectedAsset = originalAsset;
    if (storedPlayback) {
      let playbackAsset = await transaction.mediaAsset.findFirst({
        where: { interactionId: input.interaction.id, kind: "PLAYBACK" },
        select: { id: true },
      });
      if (!playbackAsset) {
        playbackAsset = await transaction.mediaAsset.create({
          data: {
            interactionId: input.interaction.id,
            kind: "PLAYBACK",
            storageKey: storedPlayback.storageKey,
            originalFileName: storedPlayback.originalFileName,
            mimeType: storedPlayback.mimeType,
            byteSize: storedPlayback.byteSize,
            sha256: storedPlayback.sha256,
            durationMs: storedPlayback.durationMs ?? input.interaction.durationSeconds * 1_000,
            channelCount: storedPlayback.channelCount,
          },
          select: { id: true },
        });
        attached = true;
      }
      selectedAsset = playbackAsset;
    }

    if (attached) {
      await writeAuditLog(
        {
          userId: input.userId,
          campaignId: input.interaction.campaignId,
          module: "call_finder",
          action: "recording_attached",
          entityType: "interaction",
          entityId: input.interaction.id,
          afterValue: {
            provider: input.interaction.provider,
            mediaAssetId: selectedAsset.id,
            browserPlaybackPrepared: Boolean(storedPlayback),
          },
          impact: "The provider recording is now stored with the call and its evaluation.",
        },
        transaction,
      );
    }
    return { assetId: selectedAsset.id, attached };
  });
}
