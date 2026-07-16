import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_MAX_FAILURES = 10;
const IP_MAX_FAILURES = 50;

export type LoginRateLimitScope = "account" | "ip";

export type LoginRateLimitKey = {
  keyHash: string;
  scope: LoginRateLimitScope;
  maxFailures: number;
};

type StoredRateLimit = {
  failureCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
  expiresAt: Date;
};

export type NextRateLimitState = {
  failureCount: number;
  windowStartedAt: Date;
  lastFailureAt: Date;
  blockedUntil: Date | null;
  expiresAt: Date;
};

function getHashSecret() {
  const secret = process.env.RATE_LIMIT_HASH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.startsWith("CHANGE_ME")) {
    throw new Error("RATE_LIMIT_HASH_SECRET or AUTH_SECRET must be configured");
  }
  return secret;
}

function hashRateLimitKey(scope: LoginRateLimitScope, value: string, secret: string) {
  return createHmac("sha256", secret).update(`${scope}:${value}`).digest("hex");
}

export function getClientAddress(headers: Headers) {
  const candidates = [
    headers.get("x-real-ip")?.trim(),
    headers.get("x-forwarded-for")?.split(",").at(-1)?.trim(),
  ];

  for (const candidate of candidates) {
    if (candidate && isIP(candidate)) return candidate.toLowerCase();
  }

  return "unknown";
}

export function createLoginRateLimitKeys(email: string, headers: Headers): LoginRateLimitKey[] {
  const secret = getHashSecret();
  const normalizedEmail = email.trim().toLowerCase();
  const clientAddress = getClientAddress(headers);

  return [
    {
      keyHash: hashRateLimitKey("account", normalizedEmail, secret),
      scope: "account",
      maxFailures: ACCOUNT_MAX_FAILURES,
    },
    {
      keyHash: hashRateLimitKey("ip", clientAddress, secret),
      scope: "ip",
      maxFailures: IP_MAX_FAILURES,
    },
  ];
}

export function computeNextRateLimitState(
  current: StoredRateLimit | null,
  maxFailures: number,
  now: Date,
): NextRateLimitState {
  const windowExpired =
    !current ||
    current.expiresAt <= now ||
    current.windowStartedAt.getTime() <= now.getTime() - WINDOW_MS;
  const failureCount = windowExpired ? 1 : current.failureCount + 1;
  const existingBlock =
    current?.blockedUntil && current.blockedUntil > now ? current.blockedUntil : null;
  const blockedUntil =
    existingBlock ?? (failureCount >= maxFailures ? new Date(now.getTime() + BLOCK_MS) : null);
  const retentionEnd = new Date(now.getTime() + RETENTION_MS);

  return {
    failureCount,
    windowStartedAt: windowExpired ? now : current.windowStartedAt,
    lastFailureAt: now,
    blockedUntil,
    expiresAt: blockedUntil && blockedUntil > retentionEnd ? blockedUntil : retentionEnd,
  };
}

export type ReserveLoginResult =
  | { allowed: true; reservationId: string }
  | {
      allowed: false;
      blockedScope: LoginRateLimitScope;
      blockedUntil: Date;
      reason: "blocked" | "capacity";
    };

export async function reserveLoginAttempt(
  keys: LoginRateLimitKey[],
  now = new Date(),
): Promise<ReserveLoginResult> {
  const { accountKey, ipKey } = validateKeys(keys);
  await cleanupExpiredRateLimitState(now);

  const reservationId = randomUUID();
  const rows = await prisma.$queryRaw<
    Array<{
      allowed: boolean;
      reservation_id: string | null;
      blocked_scope: string | null;
      blocked_until: Date | null;
      reason: string | null;
    }>
  >(Prisma.sql`
    SELECT *
    FROM qa_reserve_login_attempt(
      ${accountKey.keyHash},
      ${ipKey.keyHash},
      ${reservationId}::uuid,
      ${now}::timestamp
    )
  `);
  const result = rows[0];
  if (!result) throw new Error("Login rate-limit reservation returned no result");
  if (result.allowed && result.reservation_id) {
    return { allowed: true, reservationId: result.reservation_id };
  }
  if (
    (result.blocked_scope === "account" || result.blocked_scope === "ip") &&
    result.blocked_until &&
    (result.reason === "blocked" || result.reason === "capacity")
  ) {
    return {
      allowed: false,
      blockedScope: result.blocked_scope,
      blockedUntil: result.blocked_until,
      reason: result.reason,
    };
  }
  throw new Error("Login rate-limit reservation returned an invalid result");
}

export async function completeLoginAttempt(
  reservationId: string,
  outcome: "success" | "failure",
  now = new Date(),
) {
  const rows = await prisma.$queryRaw<
    Array<{
      completed: boolean;
      account_blocked_until: Date | null;
      ip_blocked_until: Date | null;
    }>
  >(Prisma.sql`
    SELECT *
    FROM qa_complete_login_attempt(
      ${reservationId}::uuid,
      ${outcome},
      ${now}::timestamp
    )
  `);
  const result = rows[0];
  if (!result) throw new Error("Login rate-limit completion returned no result");
  return {
    completed: result.completed,
    states:
      result.completed && outcome === "failure"
        ? [
            { scope: "account" as const, state: { blockedUntil: result.account_blocked_until } },
            { scope: "ip" as const, state: { blockedUntil: result.ip_blocked_until } },
          ]
        : [],
  };
}

async function cleanupExpiredRateLimitState(now: Date) {
  // Separate autocommit statements avoid carrying child locks into the atomic
  // reservation function. Parent cleanup is indexed and protects live tokens.
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "LoginRateLimit" AS limiter
    WHERE limiter."expiresAt" <= ${now}
      AND NOT EXISTS (
        SELECT 1
        FROM "LoginRateLimitReservation" AS reservation
        WHERE reservation."expiresAt" > ${now}
          AND (
            reservation."accountKeyHash" = limiter."keyHash"
            OR reservation."ipKeyHash" = limiter."keyHash"
          )
      )
  `);
  await prisma.loginRateLimitReservation.deleteMany({
    where: { expiresAt: { lte: now } },
  });
}

function validateKeys(keys: LoginRateLimitKey[]) {
  if (
    keys.length !== 2 ||
    keys.filter((key) => key.scope === "account").length !== 1 ||
    keys.filter((key) => key.scope === "ip").length !== 1
  ) {
    throw new Error("Exactly one account key and one IP key are required");
  }
  const accountKey = keys.find((key) => key.scope === "account");
  const ipKey = keys.find((key) => key.scope === "ip");
  if (
    !accountKey ||
    !ipKey ||
    accountKey.maxFailures !== ACCOUNT_MAX_FAILURES ||
    ipKey.maxFailures !== IP_MAX_FAILURES
  ) {
    throw new Error("Login rate-limit thresholds do not match the database policy");
  }
  return { accountKey, ipKey };
}
