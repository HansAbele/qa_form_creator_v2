import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  isCanonicalSameOrigin,
  readJsonBodyWithinLimit,
  RequestBodyTooLargeError,
} from "@/lib/http-request";
import { reportOperationalError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 8_192;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_EVENTS_PER_WINDOW = 12;
const MAX_RATE_LIMIT_BUCKETS = 2_000;
const rateLimitBuckets = new Map<string, { startedAt: number; count: number }>();

function pruneRateLimitBuckets(now: number) {
  for (const [bucketKey, bucket] of rateLimitBuckets) {
    if (now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(bucketKey);
  }
}

function consumeRateLimit(key: string) {
  const now = Date.now();
  const current = rateLimitBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    if (rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) pruneRateLimitBuckets(now);
    if (!current && rateLimitBuckets.size >= MAX_RATE_LIMIT_BUCKETS) return false;
    rateLimitBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_EVENTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function optionalText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : undefined;
}

export async function POST(request: NextRequest) {
  if (!isCanonicalSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!consumeRateLimit(session.user.id)) {
    return NextResponse.json({ error: "Too many events" }, { status: 429 });
  }

  let input: Record<string, unknown>;
  try {
    const value: unknown = await readJsonBodyWithinLimit(request, MAX_REQUEST_BYTES);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    input = value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const source = input.source === "client-boundary" ? "client-boundary" : "client-runtime";
  const message = optionalText(input.message, 1_000);
  if (!message) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const eventId = await reportOperationalError({
    source,
    message,
    name: optionalText(input.name, 128),
    digest: optionalText(input.digest, 128),
    stack: optionalText(input.stack, 4_000),
    path: optionalText(input.path, 512),
    method: "CLIENT",
    userId: session.user.id,
    metadata: {
      userAgent: request.headers.get("user-agent")?.slice(0, 256),
    },
  });

  return NextResponse.json(
    { accepted: true, eventId },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
