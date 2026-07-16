import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_LIMITS, ExportBusyError, ExportGlobalBusyError } from "@/lib/export-limits";

const configuredRuntimeUrl = process.env.EXPORT_ADMISSION_DATABASE_URL?.trim();
const configuredAdminUrl = process.env.EXPORT_ADMISSION_ADMIN_DATABASE_URL?.trim();
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const actionApplicationName = `qore_export_admission_${runId}`;

function withApplicationName(databaseUrl: string, applicationName: string) {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

const actionDatabaseUrl = configuredRuntimeUrl
  ? withApplicationName(configuredRuntimeUrl, actionApplicationName)
  : undefined;
const adminDatabaseUrl = configuredAdminUrl;

if (actionDatabaseUrl) {
  // reserveExportCapacity imports the project's Prisma singleton, which reads
  // DATABASE_URL when its module is loaded dynamically below.
  process.env.DATABASE_URL = actionDatabaseUrl;
} else {
  console.info(
    "Export admission integration test skipped: set EXPORT_ADMISSION_DATABASE_URL to run it.",
  );
}

const fixtureIds = {
  users: [randomUUID(), randomUUID()] as const,
  sameUserExports: [randomUUID(), randomUUID()] as const,
  globalExports: [randomUUID(), randomUUID()] as const,
};
const allExportIds = [...fixtureIds.sameUserExports, ...fixtureIds.globalExports];
const globalAdvisoryLockKey = "qore:export:global";
const userAdvisoryLockKey = `qore:export:${fixtureIds.users[0]}`;

const perUserLimits = {
  ...DEFAULT_EXPORT_LIMITS,
  maxRequestsPerMinute: 60,
  maxConcurrentPerUser: 1,
  maxConcurrentGlobal: 2,
};
const globalLimits = {
  ...DEFAULT_EXPORT_LIMITS,
  maxRequestsPerMinute: 60,
  maxConcurrentPerUser: 1,
  maxConcurrentGlobal: 1,
};

let adminPrisma: PrismaClient | undefined;
let lockPrisma: PrismaClient | undefined;
let appPrisma: typeof import("../../src/lib/prisma").prisma | undefined;
let exportAdmission: typeof import("../../src/server/export-admission") | undefined;

function requireIntegrationClients() {
  if (!adminPrisma || !lockPrisma || !appPrisma || !exportAdmission) {
    throw new Error("Export admission integration clients were not initialized");
  }
  return { adminPrisma, lockPrisma, appPrisma, exportAdmission };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = () => promiseResolve();
  });
  return { promise, resolve };
}

async function waitForBothReservationsToBlock(admin: PrismaClient) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const rows = await admin.$queryRaw<Array<{ blockedCount: number }>>`
      SELECT count(*)::int AS "blockedCount"
      FROM pg_stat_activity
      WHERE application_name = ${actionApplicationName}
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND query ILIKE '%pg_advisory_xact_lock%'
    `;

    if ((rows[0]?.blockedCount ?? 0) >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Both export reservations did not reach the advisory lock before the timeout");
}

async function createFixture(admin: PrismaClient) {
  await admin.$transaction(async (tx) => {
    for (const [index, userId] of fixtureIds.users.entries()) {
      await tx.user.create({
        data: {
          id: userId,
          email: `export-admission-${runId}-${index}@example.invalid`,
          name: `Export admission concurrency fixture ${index + 1}`,
          role: "QA",
          active: true,
        },
      });
    }
  });
}

async function cleanupFixture(admin: PrismaClient) {
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL qore.audit_maintenance = 'enabled'`;
    await tx.auditLog.deleteMany({
      where: {
        userId: { in: [...fixtureIds.users] },
        module: "exports",
        entityType: "export",
        entityId: { in: allExportIds },
      },
    });
  });
  await admin.user.deleteMany({ where: { id: { in: [...fixtureIds.users] } } });

  const [auditResidue, userResidue] = await Promise.all([
    admin.auditLog.count({
      where: {
        userId: { in: [...fixtureIds.users] },
        module: "exports",
        entityType: "export",
        entityId: { in: allExportIds },
      },
    }),
    admin.user.count({ where: { id: { in: [...fixtureIds.users] } } }),
  ]);
  expect({ auditResidue, userResidue }).toEqual({ auditResidue: 0, userResidue: 0 });
}

async function runContendedReservations({
  admin,
  lockClient,
  lockKey,
  startAttempts,
}: {
  admin: PrismaClient;
  lockClient: PrismaClient;
  lockKey: string;
  startAttempts: () => Promise<void>[];
}) {
  const lockAcquired = createDeferred();
  const releaseLock = createDeferred();
  const lockTransaction = lockClient.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))
      `;
      lockAcquired.resolve();
      await releaseLock.promise;
    },
    { maxWait: 5_000, timeout: 30_000 },
  );

  await Promise.race([
    lockAcquired.promise,
    lockTransaction.then(() => {
      throw new Error("The advisory-lock transaction ended before acquiring the lock");
    }),
  ]);

  const attempts = startAttempts();
  let blockedReservationError: unknown;
  try {
    await waitForBothReservationsToBlock(admin);
  } catch (error) {
    blockedReservationError = error;
  } finally {
    releaseLock.resolve();
    await lockTransaction;
  }

  const settledAttempts = await Promise.allSettled(attempts);
  if (blockedReservationError) throw blockedReservationError;
  return settledAttempts;
}

const integrationDescribe = actionDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

integrationDescribe("export admission concurrency with PostgreSQL 16", () => {
  beforeAll(async () => {
    if (!actionDatabaseUrl || !adminDatabaseUrl || !configuredRuntimeUrl) return;

    adminPrisma = new PrismaClient({
      datasources: {
        db: {
          url: withApplicationName(adminDatabaseUrl, `qore_export_admission_admin_${runId}`),
        },
      },
    });
    lockPrisma = new PrismaClient({
      datasources: {
        db: {
          url: withApplicationName(configuredRuntimeUrl, `qore_export_admission_lock_${runId}`),
        },
      },
    });

    const versionRows = await adminPrisma.$queryRaw<Array<{ serverVersionNumber: string }>>`
      SELECT current_setting('server_version_num') AS "serverVersionNumber"
    `;
    const versionNumber = Number(versionRows[0]?.serverVersionNumber);
    expect(versionNumber).toBeGreaterThanOrEqual(160_000);
    expect(versionNumber).toBeLessThan(170_000);

    ({ prisma: appPrisma } = await import("../../src/lib/prisma"));
    exportAdmission = await import("../../src/server/export-admission");
  });

  afterAll(async () => {
    await Promise.allSettled([
      appPrisma?.$disconnect(),
      lockPrisma?.$disconnect(),
      adminPrisma?.$disconnect(),
    ]);
  });

  it("commits one reservation and rejects the simultaneous competitor as busy", async () => {
    const { adminPrisma, lockPrisma, exportAdmission } = requireIntegrationClients();
    await createFixture(adminPrisma);

    try {
      const settledAttempts = await runContendedReservations({
        admin: adminPrisma,
        lockClient: lockPrisma,
        lockKey: userAdvisoryLockKey,
        startAttempts: () =>
          fixtureIds.sameUserExports.map((exportId) =>
            exportAdmission.reserveExportCapacity({
              userId: fixtureIds.users[0],
              exportId,
              limits: perUserLimits,
            }),
          ),
      });

      const successes = settledAttempts.filter(
        (attempt): attempt is PromiseFulfilledResult<void> => attempt.status === "fulfilled",
      );
      const failures = settledAttempts.filter(
        (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
      );
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.reason).toBeInstanceOf(ExportBusyError);

      const auditRows = await adminPrisma.auditLog.findMany({
        where: {
          userId: fixtureIds.users[0],
          module: "exports",
          entityType: "export",
          entityId: { in: [...fixtureIds.sameUserExports] },
        },
      });
      const reservationRows = auditRows.filter((row) => row.action === "reserved");
      const rejectionRows = auditRows.filter((row) => row.action === "rejected");
      expect(reservationRows).toHaveLength(1);
      expect(rejectionRows).toHaveLength(1);
      expect(fixtureIds.sameUserExports).toContain(reservationRows[0]?.entityId);
      expect(reservationRows[0]?.afterValue).toMatchObject({
        maxRequestsPerMinute: 60,
        maxConcurrentPerUser: 1,
        maxConcurrentGlobal: 2,
        leaseTimeoutSeconds: DEFAULT_EXPORT_LIMITS.leaseTimeoutSeconds,
      });
      expect(rejectionRows[0]?.afterValue).toMatchObject({
        reason: "user_concurrency",
        activeUserCount: 1,
      });
    } finally {
      await cleanupFixture(adminPrisma);
    }
  }, 30_000);

  it("enforces the global limit across simultaneous reservations from different users", async () => {
    const { adminPrisma, lockPrisma, exportAdmission } = requireIntegrationClients();
    await createFixture(adminPrisma);

    try {
      const settledAttempts = await runContendedReservations({
        admin: adminPrisma,
        lockClient: lockPrisma,
        lockKey: globalAdvisoryLockKey,
        startAttempts: () =>
          fixtureIds.globalExports.map((exportId, index) =>
            exportAdmission.reserveExportCapacity({
              userId: fixtureIds.users[index],
              exportId,
              limits: globalLimits,
            }),
          ),
      });

      const successes = settledAttempts.filter(
        (attempt): attempt is PromiseFulfilledResult<void> => attempt.status === "fulfilled",
      );
      const failures = settledAttempts.filter(
        (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
      );
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.reason).toBeInstanceOf(ExportGlobalBusyError);

      const auditRows = await adminPrisma.auditLog.findMany({
        where: {
          userId: { in: [...fixtureIds.users] },
          module: "exports",
          entityType: "export",
          entityId: { in: [...fixtureIds.globalExports] },
        },
      });
      const reservationRows = auditRows.filter((row) => row.action === "reserved");
      const rejectionRows = auditRows.filter((row) => row.action === "rejected");
      expect(reservationRows).toHaveLength(1);
      expect(rejectionRows).toHaveLength(1);
      expect(rejectionRows[0]?.afterValue).toMatchObject({
        reason: "global_concurrency",
        activeUserCount: 0,
        activeGlobalCount: 1,
        maxConcurrentGlobal: 1,
      });
    } finally {
      await cleanupFixture(adminPrisma);
    }
  }, 30_000);
});
