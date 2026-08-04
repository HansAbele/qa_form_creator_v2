import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authFixture = vi.hoisted(() => ({
  campaignId: "",
  userId: "",
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: authFixture.userId,
      name: "QA concurrency fixture",
      email: "qa-concurrency@example.invalid",
      role: "QA" as const,
      campaignIds: [authFixture.campaignId],
      sessionVersion: 0,
    },
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(operation: T) => operation,
}));

const configuredRuntimeUrl = process.env.RESPONSE_CONCURRENCY_DATABASE_URL?.trim();
const configuredAdminUrl = process.env.RESPONSE_CONCURRENCY_ADMIN_DATABASE_URL?.trim();
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const actionApplicationName = `qore_response_race_${runId}`;

function withApplicationName(databaseUrl: string, applicationName: string) {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

const actionDatabaseUrl = configuredRuntimeUrl
  ? withApplicationName(configuredRuntimeUrl, actionApplicationName)
  : undefined;
const adminDatabaseUrl = configuredAdminUrl ?? configuredRuntimeUrl;

if (actionDatabaseUrl) {
  // The Server Action imports the project's Prisma singleton, which reads this
  // variable when its module is loaded below.
  process.env.DATABASE_URL = actionDatabaseUrl;
} else {
  console.info(
    "Response concurrency integration test skipped: set RESPONSE_CONCURRENCY_DATABASE_URL to run it.",
  );
}

const fixtureIds = {
  user: randomUUID(),
  campaign: randomUUID(),
  agent: randomUUID(),
  disposition: randomUUID(),
  form: randomUUID(),
  question: randomUUID(),
  response: randomUUID(),
};

let adminPrisma: PrismaClient | undefined;
let lockPrisma: PrismaClient | undefined;
let appPrisma: typeof import("../../src/lib/prisma").prisma | undefined;
let responseActions: typeof import("../../src/server/actions/responses") | undefined;

function requireIntegrationClients() {
  if (!adminPrisma || !lockPrisma || !appPrisma || !responseActions) {
    throw new Error("Response concurrency integration clients were not initialized");
  }
  return { adminPrisma, lockPrisma, appPrisma, responseActions };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = () => promiseResolve();
  });
  return { promise, resolve };
}

async function waitForBothActionWritesToBlock(admin: PrismaClient) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const rows = await admin.$queryRaw<Array<{ blocked_count: number }>>`
      SELECT count(*)::int AS blocked_count
      FROM pg_stat_activity
      WHERE application_name = ${actionApplicationName}
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND query ILIKE '%"Response"%'
    `;

    if ((rows[0]?.blocked_count ?? 0) >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Both response updates did not reach the PostgreSQL row lock before the timeout");
}

async function createFixture(admin: PrismaClient) {
  const suffix = `${runId}-${Date.now()}`;
  authFixture.userId = fixtureIds.user;
  authFixture.campaignId = fixtureIds.campaign;

  await admin.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: fixtureIds.user,
        email: `qa-concurrency-${suffix}@example.invalid`,
        name: "QA concurrency fixture",
        role: "QA",
        active: true,
      },
    });
    await tx.campaign.create({
      data: {
        id: fixtureIds.campaign,
        name: `Concurrency fixture ${suffix}`,
        active: true,
      },
    });
    await tx.userCampaign.create({
      data: {
        userId: fixtureIds.user,
        campaignId: fixtureIds.campaign,
        roleInCampaign: "EVALUATOR",
        canEvaluate: true,
        canEditEvaluations: true,
      },
    });
    await tx.agent.create({
      data: {
        id: fixtureIds.agent,
        name: "Concurrency agent",
        agentCode: `race-${suffix}`,
        campaignId: fixtureIds.campaign,
        active: true,
      },
    });
    await tx.disposition.create({
      data: {
        id: fixtureIds.disposition,
        name: `Concurrency disposition ${suffix}`,
        campaignId: fixtureIds.campaign,
        active: true,
        outcomeType: "RESOLVED",
        createdById: fixtureIds.user,
      },
    });
    await tx.form.create({
      data: {
        id: fixtureIds.form,
        title: `Concurrency form ${suffix}`,
        campaignId: fixtureIds.campaign,
        createdById: fixtureIds.user,
        status: "PUBLISHED",
        version: "1.0.0",
        publishedAt: new Date(),
      },
    });
    await tx.question.create({
      data: {
        id: fixtureIds.question,
        formId: fixtureIds.form,
        type: "RATING",
        label: "Concurrent rating",
        required: true,
        weight: 100,
        ratingMax: 5,
        order: 0,
      },
    });
    await tx.response.create({
      data: {
        id: fixtureIds.response,
        formId: fixtureIds.form,
        formVersion: "1.0.0",
        agentId: fixtureIds.agent,
        evaluatorId: fixtureIds.user,
        dispositionId: fixtureIds.disposition,
        score: 20,
        result: "FAIL",
        hasFatalFail: false,
        status: "SUBMITTED",
        submittedAt: new Date(),
        answers: {
          create: {
            questionId: fixtureIds.question,
            value: "1",
            score: 20,
          },
        },
      },
    });
  });
}

async function cleanupFixture(admin: PrismaClient) {
  // Audit rows are append-only even for the owner unless the transaction is
  // explicitly marked as approved maintenance.
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL qore.audit_maintenance = 'enabled'`;
    await tx.auditLog.deleteMany({
      where: {
        entityType: "response",
        entityId: fixtureIds.response,
      },
    });
  });

  await admin.response.deleteMany({ where: { id: fixtureIds.response } });
  await admin.form.deleteMany({ where: { id: fixtureIds.form } });
  await admin.disposition.deleteMany({ where: { id: fixtureIds.disposition } });
  await admin.agent.deleteMany({ where: { id: fixtureIds.agent } });
  await admin.userCampaign.deleteMany({
    where: {
      userId: fixtureIds.user,
      campaignId: fixtureIds.campaign,
    },
  });
  await admin.campaign.deleteMany({ where: { id: fixtureIds.campaign } });
  await admin.user.deleteMany({ where: { id: fixtureIds.user } });
}

const integrationDescribe = actionDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

integrationDescribe("response concurrency with PostgreSQL 16", () => {
  beforeAll(async () => {
    if (!actionDatabaseUrl || !adminDatabaseUrl) return;

    adminPrisma = new PrismaClient({
      datasources: {
        db: {
          url: withApplicationName(adminDatabaseUrl, `qore_response_race_admin_${runId}`),
        },
      },
    });
    lockPrisma = new PrismaClient({
      datasources: {
        db: {
          url: withApplicationName(
            configuredRuntimeUrl as string,
            `qore_response_race_lock_${runId}`,
          ),
        },
      },
    });

    const versionRows = await adminPrisma.$queryRaw<Array<{ server_version_num: string }>>`
      SELECT current_setting('server_version_num') AS server_version_num
    `;
    const versionNumber = Number(versionRows[0]?.server_version_num);
    expect(versionNumber).toBeGreaterThanOrEqual(160_000);
    expect(versionNumber).toBeLessThan(170_000);

    ({ prisma: appPrisma } = await import("../../src/lib/prisma"));
    responseActions = await import("../../src/server/actions/responses");
  });

  afterAll(async () => {
    await Promise.allSettled([
      appPrisma?.$disconnect(),
      lockPrisma?.$disconnect(),
      adminPrisma?.$disconnect(),
    ]);
  });

  it("commits exactly one competing submission with consistent answers and one audit event", async () => {
    const { adminPrisma, lockPrisma, responseActions } = requireIntegrationClients();
    await createFixture(adminPrisma);

    try {
      const existing = await adminPrisma.response.findUniqueOrThrow({
        where: { id: fixtureIds.response },
        select: { updatedAt: true },
      });

      const lockAcquired = createDeferred();
      const releaseLock = createDeferred();
      const lockTransaction = lockPrisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
              SELECT "id"
              FROM "Response"
              WHERE "id" = ${fixtureIds.response}
              FOR UPDATE
            `;
          lockAcquired.resolve();
          await releaseLock.promise;
        },
        { maxWait: 5_000, timeout: 30_000 },
      );

      await Promise.race([
        lockAcquired.promise,
        lockTransaction.then(() => {
          throw new Error("The row-lock transaction ended before acquiring the lock");
        }),
      ]);

      const candidates = [
        { value: "4", expectedScore: 80 },
        { value: "5", expectedScore: 100 },
      ] as const;
      const attempts = candidates.map((candidate) =>
        responseActions.submitResponseAction({
          responseId: fixtureIds.response,
          expectedUpdatedAt: existing.updatedAt.toISOString(),
          formId: fixtureIds.form,
          agentId: fixtureIds.agent,
          dispositionId: fixtureIds.disposition,
          answers: [{ questionId: fixtureIds.question, value: candidate.value }],
        }),
      );

      let blockedWriteError: unknown;
      try {
        await waitForBothActionWritesToBlock(adminPrisma);
      } catch (error) {
        blockedWriteError = error;
      } finally {
        releaseLock.resolve();
        await lockTransaction;
      }

      const settledAttempts = await Promise.allSettled(attempts);
      if (blockedWriteError) throw blockedWriteError;
      const results = settledAttempts.map((attempt) => {
        if (attempt.status === "rejected") throw attempt.reason;
        return attempt.value;
      });
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toHaveLength(1);

      const successfulResult = results.find((result) => result.ok);
      if (!successfulResult?.ok) throw new Error("Expected one successful submission");
      expect(results.find((result) => !result.ok)).toEqual({
        ok: false,
        error: {
          code: "CONFLICT",
          message:
            "La evaluacion fue modificada por otra sesion. Recarga la pagina e intenta nuevamente",
        },
      });

      const winningCandidate = candidates.find(
        (candidate) => candidate.expectedScore === successfulResult.data.score,
      );
      if (!winningCandidate) throw new Error("The committed score does not match either writer");

      const [finalResponse, responseCount, auditRows] = await Promise.all([
        adminPrisma.response.findUniqueOrThrow({
          where: { id: fixtureIds.response },
          include: { answers: true },
        }),
        adminPrisma.response.count({ where: { id: fixtureIds.response } }),
        adminPrisma.auditLog.findMany({
          where: {
            entityType: "response",
            entityId: fixtureIds.response,
          },
        }),
      ]);

      expect(responseCount).toBe(1);
      expect(finalResponse.status).toBe("SUBMITTED");
      expect(finalResponse.result).toBe("PASS");
      expect(finalResponse.submittedAt).not.toBeNull();
      expect(finalResponse.updatedAt.toISOString()).toBe(successfulResult.data.updatedAt);
      expect(Number(finalResponse.score)).toBe(winningCandidate.expectedScore);
      expect(finalResponse.answers).toHaveLength(1);
      expect(finalResponse.answers[0]).toMatchObject({
        questionId: fixtureIds.question,
        value: winningCandidate.value,
        isFatalFail: false,
        notApplicable: false,
      });
      expect(Number(finalResponse.answers[0]?.score)).toBe(winningCandidate.expectedScore);

      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        module: "evaluations",
        action: "updated",
        entityType: "response",
        entityId: fixtureIds.response,
      });
      const auditAfterValue = auditRows[0]?.afterValue as
        | { score?: unknown; answers?: Array<{ questionId?: unknown; value?: unknown }> }
        | undefined;
      expect(Number(auditAfterValue?.score)).toBe(winningCandidate.expectedScore);
      expect(auditAfterValue?.answers).toEqual([
        expect.objectContaining({
          questionId: fixtureIds.question,
          value: winningCandidate.value,
        }),
      ]);
    } finally {
      await cleanupFixture(adminPrisma);
    }
  }, 30_000);
});
