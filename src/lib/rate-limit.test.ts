import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";
import {
  completeLoginAttempt,
  computeNextRateLimitState,
  createLoginRateLimitKeys,
  getClientAddress,
  reserveLoginAttempt,
} from "./rate-limit";

vi.mock("./prisma", () => ({ prisma: prismaMock }));

describe("distributed login rate limiting", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_HASH_SECRET = "test-rate-limit-secret-with-sufficient-entropy";
    resetPrismaMock();
  });

  it("hashes normalized account and client address without storing either raw value", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.8" });
    const keys = createLoginRateLimitKeys(" QA@Example.COM ", headers);

    expect(getClientAddress(headers)).toBe("203.0.113.8");
    expect(keys).toHaveLength(2);
    expect(keys.map((key) => key.scope)).toEqual(["account", "ip"]);
    expect(keys.every((key) => /^[a-f0-9]{64}$/.test(key.keyHash))).toBe(true);
    expect(JSON.stringify(keys)).not.toContain("qa@example.com");
    expect(JSON.stringify(keys)).not.toContain("203.0.113.8");
  });

  it("blocks on the configured failure threshold and resets an expired window", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    const current = {
      failureCount: 9,
      windowStartedAt: new Date("2026-07-15T11:55:00.000Z"),
      blockedUntil: null,
      expiresAt: new Date("2026-07-16T11:55:00.000Z"),
    };

    const blocked = computeNextRateLimitState(current, 10, now);
    expect(blocked.failureCount).toBe(10);
    expect(blocked.blockedUntil).toEqual(new Date("2026-07-15T12:15:00.000Z"));

    const reset = computeNextRateLimitState(
      { ...current, windowStartedAt: new Date("2026-07-15T11:40:00.000Z") },
      10,
      now,
    );
    expect(reset.failureCount).toBe(1);
    expect(reset.blockedUntil).toBeNull();
  });

  it("reserves account and IP capacity atomically before credential verification", async () => {
    const keys = [
      { keyHash: "a".repeat(64), scope: "account" as const, maxFailures: 10 },
      { keyHash: "b".repeat(64), scope: "ip" as const, maxFailures: 50 },
    ];
    prismaMock.loginRateLimitReservation.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.$queryRaw.mockResolvedValue([
      {
        allowed: true,
        reservation_id: "00000000-0000-4000-8000-000000000001",
        blocked_scope: null,
        blocked_until: null,
        reason: null,
      },
    ]);

    const result = await reserveLoginAttempt(keys, new Date("2026-07-15T12:00:00.000Z"));

    expect(result.allowed).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
    expect(prismaMock.loginRateLimitReservation.deleteMany).toHaveBeenCalledOnce();
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
  });

  it("rejects capacity before creating a partial reservation", async () => {
    const keys = [
      { keyHash: "a".repeat(64), scope: "account" as const, maxFailures: 10 },
      { keyHash: "b".repeat(64), scope: "ip" as const, maxFailures: 50 },
    ];
    prismaMock.loginRateLimitReservation.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.$queryRaw.mockResolvedValue([
      {
        allowed: false,
        reservation_id: null,
        blocked_scope: "account",
        blocked_until: new Date("2026-07-15T12:06:00.000Z"),
        reason: "capacity",
      },
    ]);

    const result = await reserveLoginAttempt(keys, new Date("2026-07-15T12:01:00.000Z"));

    expect(result).toMatchObject({
      allowed: false,
      blockedScope: "account",
      reason: "capacity",
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("completes one reservation idempotently and records a failure once", async () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    prismaMock.$queryRaw.mockResolvedValue([
      {
        completed: true,
        account_blocked_until: null,
        ip_blocked_until: null,
      },
    ]);

    const result = await completeLoginAttempt(
      "00000000-0000-4000-8000-000000000001",
      "failure",
      now,
    );

    expect(result.completed).toBe(true);
    expect(result.states).toHaveLength(2);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
  });
});
