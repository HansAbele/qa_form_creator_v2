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
      name: "QA export download fixture",
      email: "qa-export-download@example.invalid",
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

const configuredRuntimeUrl = process.env.EXPORT_DOWNLOAD_DATABASE_URL?.trim();
const configuredAdminUrl = process.env.EXPORT_DOWNLOAD_ADMIN_DATABASE_URL?.trim();
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const actionApplicationName = `qore_export_download_${runId}`;

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
  // The export action imports the project's Prisma singleton, which reads this
  // variable when its module is loaded dynamically below.
  process.env.DATABASE_URL = actionDatabaseUrl;
} else {
  console.info(
    "Export download integration test skipped: set EXPORT_DOWNLOAD_DATABASE_URL to run it.",
  );
}

const fixtureIds = {
  user: randomUUID(),
  campaign: randomUUID(),
  agent: randomUUID(),
  form: randomUUID(),
  question: randomUUID(),
  response: randomUUID(),
  answer: randomUUID(),
};

const fixtureValues = {
  agentName: `CSV export agent ${runId}`,
  questionLabel: `CSV export rating ${runId}`,
  answer: "5",
};

const selectedFields = ["responseId", "agent", "score", "answers"] as const;

let adminPrisma: PrismaClient | undefined;
let appPrisma: typeof import("../../src/lib/prisma").prisma | undefined;
let exportActions: typeof import("../../src/server/actions/exports") | undefined;

function requireIntegrationClients() {
  if (!adminPrisma || !appPrisma || !exportActions) {
    throw new Error("Export download integration clients were not initialized");
  }
  return { adminPrisma, exportActions };
}

async function createFixture(admin: PrismaClient) {
  const suffix = `${runId}-${Date.now()}`;
  authFixture.userId = fixtureIds.user;
  authFixture.campaignId = fixtureIds.campaign;

  await admin.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: fixtureIds.user,
        email: `qa-export-download-${suffix}@example.invalid`,
        name: "QA export download fixture",
        role: "QA",
        active: true,
      },
    });
    await tx.campaign.create({
      data: {
        id: fixtureIds.campaign,
        name: `CSV export campaign ${suffix}`,
        active: true,
      },
    });
    await tx.userCampaign.create({
      data: {
        userId: fixtureIds.user,
        campaignId: fixtureIds.campaign,
        roleInCampaign: "CAMPAIGN_ADMIN",
        canExport: true,
      },
    });
    await tx.agent.create({
      data: {
        id: fixtureIds.agent,
        name: fixtureValues.agentName,
        agentCode: `csv-${suffix}`,
        campaignId: fixtureIds.campaign,
        active: true,
      },
    });
    await tx.form.create({
      data: {
        id: fixtureIds.form,
        title: `CSV export form ${suffix}`,
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
        label: fixtureValues.questionLabel,
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
        score: 100,
        result: "PASS",
        hasFatalFail: false,
        status: "SUBMITTED",
        submittedAt: new Date(),
        answers: {
          create: {
            id: fixtureIds.answer,
            questionId: fixtureIds.question,
            value: fixtureValues.answer,
            score: 100,
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
        userId: fixtureIds.user,
        module: "exports",
        entityType: "export",
      },
    });
  });

  await admin.notification.deleteMany({ where: { userId: fixtureIds.user } });
  await admin.response.deleteMany({ where: { id: fixtureIds.response } });
  await admin.form.deleteMany({ where: { id: fixtureIds.form } });
  await admin.agent.deleteMany({ where: { id: fixtureIds.agent } });
  await admin.userCampaign.deleteMany({
    where: {
      userId: fixtureIds.user,
      campaignId: fixtureIds.campaign,
    },
  });
  await admin.campaign.deleteMany({ where: { id: fixtureIds.campaign } });
  await admin.user.deleteMany({ where: { id: fixtureIds.user } });

  const [audit, notification, answer, response, question, form, agent, access, campaign, user] =
    await Promise.all([
      admin.auditLog.count({ where: { userId: fixtureIds.user, module: "exports" } }),
      admin.notification.count({ where: { userId: fixtureIds.user } }),
      admin.answer.count({ where: { id: fixtureIds.answer } }),
      admin.response.count({ where: { id: fixtureIds.response } }),
      admin.question.count({ where: { id: fixtureIds.question } }),
      admin.form.count({ where: { id: fixtureIds.form } }),
      admin.agent.count({ where: { id: fixtureIds.agent } }),
      admin.userCampaign.count({
        where: { userId: fixtureIds.user, campaignId: fixtureIds.campaign },
      }),
      admin.campaign.count({ where: { id: fixtureIds.campaign } }),
      admin.user.count({ where: { id: fixtureIds.user } }),
    ]);

  expect({
    audit,
    notification,
    answer,
    response,
    question,
    form,
    agent,
    access,
    campaign,
    user,
  }).toEqual({
    audit: 0,
    notification: 0,
    answer: 0,
    response: 0,
    question: 0,
    form: 0,
    agent: 0,
    access: 0,
    campaign: 0,
    user: 0,
  });
}

const integrationDescribe = actionDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

integrationDescribe("authorized export download with PostgreSQL 16", () => {
  beforeAll(async () => {
    if (!actionDatabaseUrl || !adminDatabaseUrl) return;

    adminPrisma = new PrismaClient({
      datasources: {
        db: {
          url: withApplicationName(adminDatabaseUrl, `qore_export_download_admin_${runId}`),
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
    exportActions = await import("../../src/server/actions/exports");
  });

  afterAll(async () => {
    await Promise.allSettled([appPrisma?.$disconnect(), adminPrisma?.$disconnect()]);
  });

  it("streams answers to EOF and records generated audit and notification", async () => {
    const { adminPrisma, exportActions } = requireIntegrationClients();

    try {
      await createFixture(adminPrisma);

      const download = await exportActions.createExportDownload("csv", {
        campaignId: fixtureIds.campaign,
        formId: fixtureIds.form,
        fields: [...selectedFields],
      });

      expect(download).toMatchObject({
        contentType: "text/csv; charset=utf-8",
        extension: "csv",
      });

      const [preConsumptionAudits, preConsumptionNotifications] = await Promise.all([
        adminPrisma.auditLog.findMany({
          where: {
            userId: fixtureIds.user,
            module: "exports",
            entityType: "export",
          },
        }),
        adminPrisma.notification.count({
          where: {
            userId: fixtureIds.user,
            type: "export_generated",
          },
        }),
      ]);
      expect(preConsumptionAudits).toHaveLength(2);
      expect(preConsumptionAudits.map((row) => row.action).sort()).toEqual(["reserved", "started"]);
      expect(preConsumptionNotifications).toBe(0);

      const csv = await new Response(download.body).text();
      const lines = csv.split(/\r?\n/);
      expect(lines).toHaveLength(2);

      const headers = lines[0]?.replace(/^\uFEFF/, "").split(",");
      const row = lines[1]?.split(",");
      expect(headers?.slice(0, 3)).toEqual(["ID evaluacion", "Agente", "Score"]);
      expect(headers?.[3]).toContain(fixtureValues.questionLabel);
      expect(headers?.[3]).toContain(`[${fixtureIds.question}]`);
      expect(row).toEqual([
        fixtureIds.response,
        fixtureValues.agentName,
        "100",
        fixtureValues.answer,
      ]);

      const auditRows = await adminPrisma.auditLog.findMany({
        where: {
          userId: fixtureIds.user,
          module: "exports",
          entityType: "export",
        },
        orderBy: { createdAt: "asc" },
      });

      expect(auditRows).toHaveLength(3);
      expect(auditRows.map((row) => row.action).sort()).toEqual([
        "generated",
        "reserved",
        "started",
      ]);

      const exportIds = new Set(auditRows.map((row) => row.entityId));
      expect(exportIds.size).toBe(1);
      const exportId = auditRows[0]?.entityId;
      expect(exportId).toEqual(expect.any(String));

      const reservedAudit = auditRows.find((row) => row.action === "reserved");
      const startedAudit = auditRows.find((row) => row.action === "started");
      const generatedAudit = auditRows.find((row) => row.action === "generated");
      expect(reservedAudit?.campaignId).toBeNull();
      expect(startedAudit?.campaignId).toBe(fixtureIds.campaign);
      expect(generatedAudit).toMatchObject({
        campaignId: fixtureIds.campaign,
        entityId: exportId,
      });
      expect(generatedAudit?.afterValue).toMatchObject({
        exportId,
        format: "csv",
        selectedFields: [...selectedFields],
        rowCount: 1,
        detailRowCount: 1,
        filters: {
          campaignId: fixtureIds.campaign,
          formId: fixtureIds.form,
          fields: [...selectedFields],
        },
      });
      expect(reservedAudit?.createdAt.getTime()).toBeLessThanOrEqual(
        startedAudit?.createdAt.getTime() ?? 0,
      );
      expect(startedAudit?.createdAt.getTime()).toBeLessThanOrEqual(
        generatedAudit?.createdAt.getTime() ?? 0,
      );

      const notifications = await adminPrisma.notification.findMany({
        where: {
          userId: fixtureIds.user,
          type: "export_generated",
        },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        campaignId: fixtureIds.campaign,
        severity: "SUCCESS",
        entityType: "export",
        entityId: null,
        metadata: {
          exportId,
          format: "csv",
          selectedFields: [...selectedFields],
          rowCount: 1,
          detailRowCount: 1,
        },
      });
    } finally {
      await cleanupFixture(adminPrisma);
    }
  }, 30_000);
});
