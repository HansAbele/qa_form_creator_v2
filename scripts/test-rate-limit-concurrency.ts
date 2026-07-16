import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  completeLoginAttempt,
  type LoginRateLimitKey,
  reserveLoginAttempt,
} from "../src/lib/rate-limit";

const touchedKeys = new Set<string>();

function hashKey(label: string) {
  const hash = createHash("sha256").update(`${randomUUID()}:${label}`).digest("hex");
  touchedKeys.add(hash);
  return hash;
}

function keys(accountHash: string, ipHash: string): LoginRateLimitKey[] {
  return [
    { keyHash: accountHash, scope: "account", maxFailures: 10 },
    { keyHash: ipHash, scope: "ip", maxFailures: 50 },
  ];
}

async function completeSuccessfulAdmissions(
  admissions: Awaited<ReturnType<typeof reserveLoginAttempt>>[],
) {
  await Promise.all(
    admissions
      .filter((admission) => admission.allowed)
      .map((admission) => completeLoginAttempt(admission.reservationId, "success")),
  );
}

async function run() {
  const cleanupNow = new Date();
  const expiredWithoutReservation = hashKey("expired-without-reservation");
  const protectedExpiredAccount = hashKey("protected-expired-account");
  const protectedExpiredIp = hashKey("protected-expired-ip");
  const protectedReservationId = randomUUID();
  await prisma.loginRateLimit.createMany({
    data: [expiredWithoutReservation, protectedExpiredAccount, protectedExpiredIp].map(
      (keyHash, index) => ({
        keyHash,
        scope: index === 2 ? "ip" : "account",
        failureCount: 0,
        windowStartedAt: new Date(cleanupNow.getTime() - 25 * 60 * 60 * 1000),
        lastFailureAt: new Date(cleanupNow.getTime() - 25 * 60 * 60 * 1000),
        blockedUntil: null,
        expiresAt: new Date(cleanupNow.getTime() - 1000),
      }),
    ),
  });
  await prisma.loginRateLimitReservation.create({
    data: {
      id: protectedReservationId,
      accountKeyHash: protectedExpiredAccount,
      ipKeyHash: protectedExpiredIp,
      expiresAt: new Date(cleanupNow.getTime() + 60_000),
    },
  });
  const cleanupProbe = await reserveLoginAttempt(
    keys(hashKey("cleanup-probe-account"), hashKey("cleanup-probe-ip")),
  );
  assert.equal(cleanupProbe.allowed, true);
  if (cleanupProbe.allowed) await completeLoginAttempt(cleanupProbe.reservationId, "success");
  assert.equal(
    await prisma.loginRateLimit.findUnique({ where: { keyHash: expiredWithoutReservation } }),
    null,
    "an expired limiter without an active reservation must be purged",
  );
  assert.notEqual(
    await prisma.loginRateLimit.findUnique({ where: { keyHash: protectedExpiredAccount } }),
    null,
    "an active reservation must protect its limiter from cleanup",
  );
  await completeLoginAttempt(protectedReservationId, "success");

  const sameAccount = hashKey("same-account");
  const sameIp = hashKey("same-ip");
  const samePairAdmissions = await Promise.all(
    Array.from({ length: 100 }, () => reserveLoginAttempt(keys(sameAccount, sameIp))),
  );
  assert.equal(
    samePairAdmissions.filter((admission) => admission.allowed).length,
    10,
    "same account/IP must admit exactly ten concurrent bcrypt reservations",
  );
  await completeSuccessfulAdmissions(samePairAdmissions);

  const sharedIp = hashKey("shared-ip");
  const distinctAccountAdmissions = await Promise.all(
    Array.from({ length: 60 }, (_, index) =>
      reserveLoginAttempt(keys(hashKey(`account-${index}`), sharedIp)),
    ),
  );
  assert.equal(
    distinctAccountAdmissions.filter((admission) => admission.allowed).length,
    50,
    "one IP must admit exactly fifty concurrent reservations",
  );
  const deniedAccount = hashKey("capacity-denied-account");
  const deniedAdmission = await reserveLoginAttempt(keys(deniedAccount, sharedIp));
  assert.equal(deniedAdmission.allowed, false, "a saturated IP must reject another account");
  assert.equal(
    await prisma.loginRateLimitReservation.count({ where: { accountKeyHash: deniedAccount } }),
    0,
    "a rejected IP admission must not leave a partial account reservation",
  );
  await completeSuccessfulAdmissions(distinctAccountAdmissions);

  const sharedAccount = hashKey("shared-account");
  const distinctIpAdmissions = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      reserveLoginAttempt(keys(sharedAccount, hashKey(`ip-${index}`))),
    ),
  );
  assert.equal(
    distinctIpAdmissions.filter((admission) => admission.allowed).length,
    10,
    "one account must admit exactly ten concurrent reservations across IPs",
  );
  await completeSuccessfulAdmissions(distinctIpAdmissions);

  const idempotentAccount = hashKey("idempotent-account");
  const idempotentIp = hashKey("idempotent-ip");
  const idempotentAdmission = await reserveLoginAttempt(keys(idempotentAccount, idempotentIp));
  assert.equal(idempotentAdmission.allowed, true);
  if (!idempotentAdmission.allowed) throw new Error("Expected an idempotency reservation");
  await Promise.all(
    Array.from({ length: 20 }, () =>
      completeLoginAttempt(idempotentAdmission.reservationId, "failure"),
    ),
  );
  const [accountState, ipState] = await Promise.all([
    prisma.loginRateLimit.findUniqueOrThrow({ where: { keyHash: idempotentAccount } }),
    prisma.loginRateLimit.findUniqueOrThrow({ where: { keyHash: idempotentIp } }),
  ]);
  assert.equal(accountState.failureCount, 1, "one reservation may increment the account once");
  assert.equal(ipState.failureCount, 1, "one reservation may increment the IP once");

  assert.equal(
    await prisma.loginRateLimitReservation.count({
      where: {
        OR: [
          { accountKeyHash: { in: [...touchedKeys] } },
          { ipKeyHash: { in: [...touchedKeys] } },
        ],
      },
    }),
    0,
    "all admitted test reservations must be consumed",
  );

  console.log("Concurrent login admission checks passed.");
}

run()
  .finally(async () => {
    await prisma.loginRateLimitReservation.deleteMany({
      where: {
        OR: [
          { accountKeyHash: { in: [...touchedKeys] } },
          { ipKeyHash: { in: [...touchedKeys] } },
        ],
      },
    });
    await prisma.loginRateLimit.deleteMany({ where: { keyHash: { in: [...touchedKeys] } } });
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Concurrent rate-limit test failed");
    process.exitCode = 1;
  });
