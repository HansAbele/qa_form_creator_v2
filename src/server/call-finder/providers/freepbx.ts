import "server-only";

import { InteractionDirection, InteractionProvider } from "@prisma/client";
import { load } from "cheerio";
import { z } from "zod";
import {
  addDateOnlyDays,
  assertValidOperationalTimeZone,
  toOperationalDateKey,
} from "@/lib/operational-time";
import { providerAgentDisplayName } from "@/lib/provider-agent";
import type {
  CallSourceAdapter,
  NormalizedProviderCall,
  ProviderCallPage,
  ProviderCallSearch,
  ProviderRecordingLocator,
} from "@/server/call-finder/providers/contracts";

const FREEPBX_PROVIDER = InteractionProvider.FREEPBX;
const MAX_CDR_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const CDR_UNIQUE_ID_PATTERN = /^\d{10,12}\.\d+$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const pageSizeSchema = z.coerce.number().int().min(100).max(10_000).default(5_000);

export type FreePbxAdapterConfig = {
  instanceKey: string;
  baseUrl: string;
  allowedHosts: string[];
  username: string;
  password: string;
  timeZone: string;
  pageSize: number;
};

type FreePbxEnvironment = Record<string, string | undefined>;
type FetchImplementation = typeof fetch;

function requiredEnvironmentValue(environment: FreePbxEnvironment, key: string) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function normalizedBaseUrl(rawValue: string, allowedHosts: string[]) {
  const url = new URL(rawValue);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new Error("FREEPBX_BASE_URL must be an allowed HTTPS origin without credentials");
  }
  return `${url.origin}/`;
}

export function loadFreePbxAdapterConfig(
  environment: FreePbxEnvironment = process.env,
): FreePbxAdapterConfig {
  const allowedHosts = requiredEnvironmentValue(environment, "FREEPBX_ALLOWED_HOSTS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHosts.length === 0 || allowedHosts.some((host) => !/^[a-z0-9.-]+$/.test(host))) {
    throw new Error("FREEPBX_ALLOWED_HOSTS is invalid");
  }

  return {
    instanceKey: requiredEnvironmentValue(environment, "FREEPBX_INSTANCE_KEY"),
    baseUrl: normalizedBaseUrl(
      requiredEnvironmentValue(environment, "FREEPBX_BASE_URL"),
      allowedHosts,
    ),
    allowedHosts,
    username: requiredEnvironmentValue(environment, "FREEPBX_USERNAME"),
    password: requiredEnvironmentValue(environment, "FREEPBX_PASSWORD"),
    timeZone: assertValidOperationalTimeZone(
      environment.FREEPBX_TIME_ZONE?.trim() || "America/New_York",
    ),
    pageSize: pageSizeSchema.parse(environment.FREEPBX_CDR_PAGE_SIZE?.trim() || undefined),
  };
}

function responseSetCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = response.headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,\s]+=)/) : [];
}

function loginPage(html: string) {
  return /name=["']username["']/i.test(html) && /name=["']password["']/i.test(html);
}

async function readBoundedText(response: Response, maximumBytes = MAX_CDR_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("FreePBX CDR response exceeded the size limit");
  }
  if (!response.body) throw new Error("FreePBX returned an empty CDR response");

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
        throw new Error("FreePBX CDR response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    totalBytes,
  ).toString("utf8");
}

function durationSeconds(value: string) {
  const parts = value.trim().split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  const minutes = Number(parts.at(-2));
  const seconds = Number(parts.at(-1));
  const total = hours * 3_600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) &&
    hours >= 0 &&
    minutes >= 0 &&
    minutes < 60 &&
    seconds >= 0 &&
    seconds < 60
    ? total
    : null;
}

function callerIdParts(value: string) {
  const match = /^(?:"([^"]*)"\s*)?<([^>]*)>$/.exec(value.trim());
  const rawNumber = match?.[2] ?? value;
  return {
    name: match?.[1]?.trim() || null,
    number: rawNumber.replace(/\D/g, ""),
  };
}

function isExtension(value: string) {
  return /^\d{3,6}$/.test(value);
}

function isExternalNumber(value: string) {
  return /^\d{7,15}$/.test(value);
}

function externalCampaignId(input: ProviderCallSearch) {
  const values = [
    ...new Set(input.externalCampaignIds.map((value) => value.trim()).filter(Boolean)),
  ];
  if (values.length !== 1) {
    throw new Error("A FreePBX source must map to exactly one external campaign identifier");
  }
  return values[0] as string;
}

type ParsedCdrPage = { calls: NormalizedProviderCall[]; rowCount: number };

export function parseFreePbxCdrHtml(
  html: string,
  input: { instanceKey: string; externalCampaignId: string; baseUrl: string },
): ParsedCdrPage {
  const $ = load(html);
  const calls: NormalizedProviderCall[] = [];
  let rowCount = 0;

  $("#cdr_table tr").each((_index, row) => {
    const cells = $(row).children("td");
    if (cells.length < 10) return;
    rowCount += 1;

    const text = (cellIndex: number) => $(cells.get(cellIndex)).text().trim();
    const application = text(6).toUpperCase();
    const disposition = text(8).toUpperCase();
    const seconds = durationSeconds(text(9));
    const uniqueId = text(2);
    const recordingHref = $(cells.get(1)).find('a[href*="download_audio"]').attr("href");
    if (
      application !== "DIAL" ||
      disposition !== "ANSWERED" ||
      !seconds ||
      !CDR_UNIQUE_ID_PATTERN.test(uniqueId) ||
      !recordingHref
    ) {
      return;
    }

    const recordingUrl = new URL(recordingHref, input.baseUrl);
    const recordingId = recordingUrl.searchParams.get("cdr_file")?.trim() ?? "";
    if (!CDR_UNIQUE_ID_PATTERN.test(recordingId)) return;

    const caller = callerIdParts(text(3));
    const destination = text(7).replace(/\D/g, "");
    const outboundCallerId = callerIdParts(text(4)).number;
    const did = text(5).replace(/\D/g, "");
    let direction: InteractionDirection;
    let agentExtension: string;
    let phoneNumber: string;

    if (isExtension(destination) && isExternalNumber(caller.number)) {
      direction = InteractionDirection.INBOUND;
      agentExtension = destination;
      phoneNumber = caller.number;
    } else if (isExtension(caller.number) && isExternalNumber(destination)) {
      direction = InteractionDirection.OUTBOUND;
      agentExtension = caller.number;
      phoneNumber = destination;
    } else {
      return;
    }

    const epochSeconds = Number(uniqueId.split(".", 1)[0]);
    if (!Number.isSafeInteger(epochSeconds) || epochSeconds < 1) return;
    const startedAt = new Date(epochSeconds * 1_000);
    if (Number.isNaN(startedAt.getTime())) return;

    calls.push({
      provider: FREEPBX_PROVIDER,
      providerInstance: input.instanceKey,
      providerInteractionId: uniqueId,
      providerRecordingId: recordingId,
      providerCampaignId: input.externalCampaignId,
      providerAgentId: agentExtension,
      providerAgentName: providerAgentDisplayName(FREEPBX_PROVIDER, agentExtension, null),
      dispositionCode: disposition,
      direction,
      phoneNumber,
      queueName: null,
      status: disposition,
      startedAt,
      endedAt: new Date(startedAt.getTime() + seconds * 1_000),
      durationSeconds: seconds,
      hasRecording: true,
      metadata: {
        providerSystem: "FreePBX",
        cdrUniqueId: uniqueId,
        recordingId,
        agentExtension,
        application,
        disposition,
        talkSeconds: seconds,
        callerIdName: caller.name,
        did: did || null,
        outboundCallerId: outboundCallerId || null,
      },
    });
  });

  return { calls, rowCount };
}

function dateKeys(input: ProviderCallSearch, timeZone: string) {
  const first = toOperationalDateKey(input.startedFrom, timeZone);
  const last = toOperationalDateKey(input.startedTo, timeZone);
  const keys: string[] = [];
  for (let value = first; value <= last; value = addDateOnlyDays(value, 1)) {
    keys.push(value);
  }
  return keys;
}

function normalizedPhoneSearch(value: string | undefined) {
  return value?.replace(/\D/g, "") || null;
}

export class FreePbxCallSourceAdapter implements CallSourceAdapter {
  readonly provider = FREEPBX_PROVIDER;
  private readonly origin: string;
  private readonly cookies = new Map<string, string>();
  private authenticated = false;

  constructor(
    private readonly config: FreePbxAdapterConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {
    this.origin = new URL(config.baseUrl).origin;
  }

  private trustedUrl(pathOrUrl: string | URL) {
    const url = new URL(pathOrUrl, this.config.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.origin !== this.origin ||
      !this.config.allowedHosts.includes(url.hostname.toLowerCase())
    ) {
      throw new Error("FreePBX refused an untrusted URL");
    }
    return url;
  }

  private rememberCookies(response: Response) {
    for (const header of responseSetCookies(response)) {
      const pair = header.split(";", 1)[0]?.trim();
      const separator = pair?.indexOf("=") ?? -1;
      if (!pair || separator < 1) continue;
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  private cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  private async request(pathOrUrl: string | URL, init: RequestInit = {}) {
    let url = this.trustedUrl(pathOrUrl);
    let method = init.method ?? "GET";
    let body = init.body;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const headers = new Headers(init.headers);
      const cookie = this.cookieHeader();
      if (cookie) headers.set("cookie", cookie);
      const response = await this.fetchImplementation(url, {
        ...init,
        method,
        body,
        headers,
        redirect: "manual",
      });
      this.rememberCookies(response);

      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      url = this.trustedUrl(location);
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method !== "GET")
      ) {
        method = "GET";
        body = undefined;
      }
    }
    throw new Error("FreePBX returned too many redirects");
  }

  private async login() {
    const reportPath = "/admin/config.php?display=cdr";
    const initial = await this.request(reportPath);
    if (!initial.ok) throw new Error("FreePBX authentication is unavailable");
    const initialHtml = await readBoundedText(initial);
    if (!loginPage(initialHtml)) {
      this.authenticated = true;
      return;
    }

    const form = new URLSearchParams({
      username: this.config.username,
      password: this.config.password,
    });
    const response = await this.request(reportPath, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!response.ok) throw new Error("FreePBX authentication failed");
    const html = await readBoundedText(response);
    if (loginPage(html) || !/CDR Reports|Call Detail Record Search/i.test(html)) {
      throw new Error("FreePBX authentication failed");
    }
    this.authenticated = true;
  }

  private async ensureAuthenticated() {
    if (!this.authenticated) await this.login();
  }

  private cdrBody(dateKey: string) {
    const [year, month, day] = dateKey.split("-");
    return new URLSearchParams({
      order: "calldate",
      startday: day ?? "",
      startmonth: month ?? "",
      startyear: year ?? "",
      starthour: "00",
      startmin: "00",
      endday: day ?? "",
      endmonth: month ?? "",
      endyear: year ?? "",
      endhour: "23",
      endmin: "59",
      need_html: "true",
      limit: String(this.config.pageSize),
      disposition: "ANSWERED",
      sort: "DESC",
      group: "day",
    });
  }

  private async fetchCdrHtml(dateKey: string, retry = true): Promise<string> {
    await this.ensureAuthenticated();
    const response = await this.request("/admin/config.php?display=cdr", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: this.trustedUrl("/admin/config.php?display=cdr").toString(),
      },
      body: this.cdrBody(dateKey).toString(),
    });
    if (!response.ok) throw new Error(`FreePBX CDR request failed with HTTP ${response.status}`);
    const html = await readBoundedText(response);
    if (loginPage(html)) {
      if (!retry) throw new Error("FreePBX session expired during CDR retrieval");
      this.authenticated = false;
      this.cookies.clear();
      return this.fetchCdrHtml(dateKey, false);
    }
    return html;
  }

  async searchCalls(input: ProviderCallSearch): Promise<ProviderCallPage> {
    const campaignId = externalCampaignId(input);
    const keys = dateKeys(input, this.config.timeZone);
    const selectedKey = input.cursor ?? keys[0];
    if (!selectedKey || !DATE_KEY_PATTERN.test(selectedKey) || !keys.includes(selectedKey)) {
      throw new Error("Invalid FreePBX synchronization cursor");
    }

    const html = await this.fetchCdrHtml(selectedKey);
    const parsed = parseFreePbxCdrHtml(html, {
      instanceKey: this.config.instanceKey,
      externalCampaignId: campaignId,
      baseUrl: this.config.baseUrl,
    });
    if (parsed.rowCount >= this.config.pageSize) {
      throw new Error("FreePBX CDR result limit reached; reduce the synchronization window");
    }

    const phoneSearch = normalizedPhoneSearch(input.phoneNumber);
    const agentIds = input.providerAgentIds ? new Set(input.providerAgentIds) : null;
    const calls = parsed.calls.filter(
      (call) =>
        call.startedAt >= input.startedFrom &&
        call.startedAt <= input.startedTo &&
        (!input.direction || call.direction === input.direction) &&
        (!agentIds || (call.providerAgentId !== null && agentIds.has(call.providerAgentId))) &&
        (!phoneSearch ||
          normalizedPhoneSearch(call.phoneNumber ?? undefined)?.includes(phoneSearch)) &&
        (input.minDurationSeconds === undefined ||
          call.durationSeconds >= input.minDurationSeconds) &&
        (input.maxDurationSeconds === undefined ||
          call.durationSeconds <= input.maxDurationSeconds),
    );
    const nextIndex = keys.indexOf(selectedKey) + 1;
    return { calls, nextCursor: keys[nextIndex] ?? null };
  }

  async fetchRecording(locator: ProviderRecordingLocator): Promise<Response> {
    const recordingId = locator.providerRecordingId?.trim() || locator.providerInteractionId.trim();
    if (!CDR_UNIQUE_ID_PATTERN.test(recordingId)) {
      throw new Error("Invalid FreePBX recording identifier");
    }
    await this.ensureAuthenticated();
    const path = new URL("/admin/config.php", this.config.baseUrl);
    path.searchParams.set("display", "cdr");
    path.searchParams.set("action", "download_audio");
    path.searchParams.set("cdr_file", recordingId);
    const response = await this.request(path, {
      headers: { referer: this.trustedUrl("/admin/config.php?display=cdr").toString() },
    });
    if (!response.ok) return new Response(null, { status: response.status });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) {
      return new Response(null, { status: 401 });
    }
    if (contentType.startsWith("application/octet-stream")) {
      const headers = new Headers(response.headers);
      headers.set("content-type", "audio/wav");
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  }
}
