import { logger } from "@/lib/logger";

export type OperationalErrorSource =
  | "next-server"
  | "client-runtime"
  | "client-boundary"
  | "api-route";

export type OperationalErrorInput = {
  source: OperationalErrorSource;
  message: string;
  name?: string;
  digest?: string;
  stack?: string;
  path?: string;
  method?: string;
  routePath?: string;
  routeType?: string;
  userId?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_STACK_LENGTH = 4_000;
const MAX_METADATA_ENTRIES = 20;
const SENSITIVE_KEY_PATTERN =
  "(?:token|secret|password|code|api[_-]?key|access[_-]?token|refresh[_-]?token|session|auth|key|state)";

export function sanitizeObservabilityText(value: string, maxLength = MAX_MESSAGE_LENGTH) {
  return value
    .replace(/\b(authorization|proxy-authorization)\s*:\s*[^\r\n]+/gi, "$1: [redacted]")
    .replace(/\b(set-cookie|cookie)\s*:\s*[^\r\n]+/gi, "$1: [redacted]")
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[credential]@")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\b/gi, "[credential]")
    .replace(new RegExp(`([?&]${SENSITIVE_KEY_PATTERN}=)[^&\\s#]+`, "gi"), "$1[redacted]")
    .replace(
      new RegExp(
        `(\\b${SENSITIVE_KEY_PATTERN}\\b\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;}\\]]+)`,
        "gi",
      ),
      "$1[redacted]",
    )
    .slice(0, maxLength);
}

function sanitizePath(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value, "http://qore.internal").pathname.slice(0, 512);
  } catch {
    return value.split("?")[0]?.slice(0, 512);
  }
}

function sanitizeMetadata(metadata: OperationalErrorInput["metadata"]) {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata)
      .slice(0, MAX_METADATA_ENTRIES)
      .map(([key, value]) => [
        key.slice(0, 64),
        typeof value === "string" ? sanitizeObservabilityText(value, 256) : value,
      ]),
  );
}

export function normalizeOperationalError(input: OperationalErrorInput) {
  return {
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    service: process.env.OBSERVABILITY_SERVICE_NAME ?? "qore",
    environment: process.env.NODE_ENV ?? "development",
    source: input.source,
    name: sanitizeObservabilityText(input.name ?? "Error", 128),
    message: sanitizeObservabilityText(input.message),
    digest: input.digest ? sanitizeObservabilityText(input.digest, 128) : undefined,
    stack: input.stack ? sanitizeObservabilityText(input.stack, MAX_STACK_LENGTH) : undefined,
    path: sanitizePath(input.path),
    method: input.method?.slice(0, 16),
    routePath: sanitizePath(input.routePath),
    routeType: input.routeType?.slice(0, 64),
    userId: input.userId?.slice(0, 128),
    metadata: sanitizeMetadata(input.metadata),
  };
}

export async function reportOperationalError(input: OperationalErrorInput) {
  const event = normalizeOperationalError(input);
  logger.error({ operationalError: event }, "Application error captured");

  const webhookUrl = process.env.ERROR_REPORTING_WEBHOOK_URL?.trim();
  if (!webhookUrl) return event.eventId;

  try {
    const token = process.env.ERROR_REPORTING_WEBHOOK_TOKEN?.trim();
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!response.ok) {
      logger.warn(
        { eventId: event.eventId, status: response.status },
        "Error reporting webhook rejected event",
      );
    }
  } catch (error) {
    logger.warn({ eventId: event.eventId, err: error }, "Error reporting webhook unavailable");
  }

  return event.eventId;
}
