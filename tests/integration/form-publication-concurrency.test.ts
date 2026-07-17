import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FormMutationInput } from "@/types/form-builder";

const authFixture = vi.hoisted(() => ({
  campaignId: "",
  userId: "",
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: authFixture.userId,
      name: "QA form concurrency fixture",
      email: "qa-form-concurrency@example.invalid",
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

const configuredRuntimeUrl = process.env.FORM_PUBLICATION_CONCURRENCY_DATABASE_URL?.trim();
const configuredAdminUrl = process.env.FORM_PUBLICATION_CONCURRENCY_ADMIN_DATABASE_URL?.trim();
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const actionApplicationName = `qore_form_publication_race_${runId}`;

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
  // The Server Actions import the project's Prisma singleton, which reads this
  // variable when the modules are loaded dynamically below.
  process.env.DATABASE_URL = actionDatabaseUrl;
} else {
  console.info(
    "Form publication concurrency integration test skipped: set FORM_PUBLICATION_CONCURRENCY_DATABASE_URL to run it.",
  );
}

const fixtureIds = {
  user: randomUUID(),
  campaign: randomUUID(),
  qaCategory: randomUUID(),
  rootForm: randomUUID(),
  rootFormCategory: randomUUID(),
  rootQuestion: randomUUID(),
  draftForm: randomUUID(),
  draftFormCategory: randomUUID(),
  draftQuestion: randomUUID(),
};

const publishedDefinition = {
  title: "Published immutable definition",
  description: "Published definition must not be edited in place",
  questionLabel: "Published immutable question",
};

const initialDraftDefinition = {
  title: "Pending definition before the race",
  description: "Pending definition can be saved or published",
  questionLabel: "Pending question before the race",
};

let adminPrisma: PrismaClient | undefined;
let lockPrisma: PrismaClient | undefined;
let appPrisma: typeof import("../../src/lib/prisma").prisma | undefined;
let formActions: typeof import("../../src/server/actions/forms") | undefined;

function requireIntegrationClients() {
  if (!adminPrisma || !lockPrisma || !appPrisma || !formActions) {
    throw new Error("Form publication concurrency integration clients were not initialized");
  }
  return { adminPrisma, lockPrisma, appPrisma, formActions };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = () => promiseResolve();
  });
  return { promise, resolve };
}

function buildFormInput(title: string, description: string, questionLabel: string) {
  return {
    title,
    description,
    campaignId: fixtureIds.campaign,
    questions: [
      {
        type: "RATING",
        label: questionLabel,
        required: true,
        qaCategoryId: fixtureIds.qaCategory,
        weight: 100,
        fatal: false,
        requiresCommentOnFail: false,
      },
    ],
  } satisfies FormMutationInput;
}

async function waitForBlockedFormActions(admin: PrismaClient, expectedCount: number) {
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

    if ((rows[0]?.blockedCount ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `${expectedCount} form mutations did not reach the PostgreSQL advisory lock before the timeout`,
  );
}

async function runBehindFamilyLock<T>({
  admin,
  lockClient,
  startAttempts,
}: {
  admin: PrismaClient;
  lockClient: PrismaClient;
  startAttempts: () => Promise<T>[];
}) {
  const lockAcquired = createDeferred();
  const releaseLock = createDeferred();
  const lockTransaction = lockClient.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${fixtureIds.rootForm}, 0))
      `;
      lockAcquired.resolve();
      await releaseLock.promise;
    },
    { maxWait: 5_000, timeout: 30_000 },
  );

  await Promise.race([
    lockAcquired.promise,
    lockTransaction.then(() => {
      throw new Error("The family-lock transaction ended before acquiring the lock");
    }),
  ]);

  const attempts = startAttempts();
  let blockedActionError: unknown;
  try {
    await waitForBlockedFormActions(admin, attempts.length);
  } catch (error) {
    blockedActionError = error;
  } finally {
    releaseLock.resolve();
    await lockTransaction;
  }

  const settledAttempts = await Promise.allSettled(attempts);
  if (blockedActionError) throw blockedActionError;
  return settledAttempts;
}

async function createFixture(admin: PrismaClient, options: { includeDraft: boolean }) {
  const suffix = `${runId}-${Date.now()}`;
  authFixture.userId = fixtureIds.user;
  authFixture.campaignId = fixtureIds.campaign;

  await admin.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: fixtureIds.user,
        email: `qa-form-concurrency-${suffix}@example.invalid`,
        name: "QA form concurrency fixture",
        role: "QA",
        active: true,
      },
    });
    await tx.campaign.create({
      data: {
        id: fixtureIds.campaign,
        name: `Form concurrency fixture ${suffix}`,
        active: true,
      },
    });
    await tx.userCampaign.create({
      data: {
        userId: fixtureIds.user,
        campaignId: fixtureIds.campaign,
        roleInCampaign: "EVALUATOR",
        canViewForms: true,
        canCreateForms: true,
        canEditForms: true,
        canPublishForms: true,
      },
    });
    await tx.qACategory.create({
      data: {
        id: fixtureIds.qaCategory,
        name: `Form concurrency category ${suffix}`,
        isActive: true,
        canBeFatal: false,
        requiresCommentOnFail: false,
      },
    });
    await tx.form.create({
      data: {
        id: fixtureIds.rootForm,
        title: publishedDefinition.title,
        description: publishedDefinition.description,
        campaignId: fixtureIds.campaign,
        createdById: fixtureIds.user,
        status: "PUBLISHED",
        version: "1.0.0",
        publishedAt: new Date(),
      },
    });
    await tx.formCategory.create({
      data: {
        id: fixtureIds.rootFormCategory,
        formId: fixtureIds.rootForm,
        qaCategoryId: fixtureIds.qaCategory,
        weight: 100,
      },
    });
    await tx.question.create({
      data: {
        id: fixtureIds.rootQuestion,
        formId: fixtureIds.rootForm,
        formCategoryId: fixtureIds.rootFormCategory,
        type: "RATING",
        label: publishedDefinition.questionLabel,
        required: true,
        weight: 100,
        order: 0,
      },
    });

    if (!options.includeDraft) return;

    await tx.form.create({
      data: {
        id: fixtureIds.draftForm,
        title: initialDraftDefinition.title,
        description: initialDraftDefinition.description,
        campaignId: fixtureIds.campaign,
        createdById: fixtureIds.user,
        parentFormId: fixtureIds.rootForm,
        status: "DRAFT",
        version: "1.1.0",
      },
    });
    await tx.formCategory.create({
      data: {
        id: fixtureIds.draftFormCategory,
        formId: fixtureIds.draftForm,
        qaCategoryId: fixtureIds.qaCategory,
        weight: 100,
      },
    });
    await tx.question.create({
      data: {
        id: fixtureIds.draftQuestion,
        formId: fixtureIds.draftForm,
        formCategoryId: fixtureIds.draftFormCategory,
        type: "RATING",
        label: initialDraftDefinition.questionLabel,
        required: true,
        weight: 100,
        order: 0,
      },
    });
  });
}

async function cleanupFixture(admin: PrismaClient) {
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL qore.audit_maintenance = 'enabled'`;
    await tx.auditLog.deleteMany({
      where: {
        userId: fixtureIds.user,
        campaignId: fixtureIds.campaign,
        module: "forms",
      },
    });
  });

  await admin.form.deleteMany({ where: { campaignId: fixtureIds.campaign } });
  await admin.userCampaign.deleteMany({
    where: { userId: fixtureIds.user, campaignId: fixtureIds.campaign },
  });
  await admin.campaign.deleteMany({ where: { id: fixtureIds.campaign } });
  await admin.user.deleteMany({ where: { id: fixtureIds.user } });
  await admin.qACategory.deleteMany({ where: { id: fixtureIds.qaCategory } });

  const [
    auditResidue,
    formResidue,
    assignmentResidue,
    campaignResidue,
    userResidue,
    categoryResidue,
  ] = await Promise.all([
    admin.auditLog.count({
      where: {
        userId: fixtureIds.user,
        campaignId: fixtureIds.campaign,
        module: "forms",
      },
    }),
    admin.form.count({ where: { campaignId: fixtureIds.campaign } }),
    admin.userCampaign.count({
      where: { userId: fixtureIds.user, campaignId: fixtureIds.campaign },
    }),
    admin.campaign.count({ where: { id: fixtureIds.campaign } }),
    admin.user.count({ where: { id: fixtureIds.user } }),
    admin.qACategory.count({ where: { id: fixtureIds.qaCategory } }),
  ]);
  expect({
    auditResidue,
    formResidue,
    assignmentResidue,
    campaignResidue,
    userResidue,
    categoryResidue,
  }).toEqual({
    auditResidue: 0,
    formResidue: 0,
    assignmentResidue: 0,
    campaignResidue: 0,
    userResidue: 0,
    categoryResidue: 0,
  });
}

async function readFormDefinition(admin: PrismaClient, id: string) {
  const form = await admin.form.findUniqueOrThrow({
    where: { id },
    select: {
      title: true,
      description: true,
      questions: {
        select: { label: true, type: true, weight: true, required: true, order: true },
        orderBy: { order: "asc" },
      },
    },
  });
  return form;
}

const integrationDescribe = actionDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

integrationDescribe("form publication concurrency with PostgreSQL 16", () => {
  beforeAll(async () => {
    if (!actionDatabaseUrl || !adminDatabaseUrl || !configuredRuntimeUrl) return;

    adminPrisma = new PrismaClient({
      datasources: {
        db: {
          url: withApplicationName(adminDatabaseUrl, `qore_form_publication_race_admin_${runId}`),
        },
      },
    });
    lockPrisma = new PrismaClient({
      datasources: {
        db: {
          url: withApplicationName(
            configuredRuntimeUrl,
            `qore_form_publication_race_lock_${runId}`,
          ),
        },
      },
    });

    const versionRows = await adminPrisma.$queryRaw<Array<{ serverVersionNumber: string }>>`
      SELECT current_setting('server_version_num') AS "serverVersionNumber"
    `;
    const versionNumber = Number(versionRows[0]?.serverVersionNumber);
    expect(versionNumber).toBeGreaterThanOrEqual(160_000);
    expect(versionNumber).toBeLessThan(170_000);

    const draftIndexRows = await adminPrisma.$queryRaw<Array<{ indexDefinition: string }>>`
      SELECT indexdef AS "indexDefinition"
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'Form_one_draft_per_family_key'
    `;
    expect(draftIndexRows).toHaveLength(1);
    expect(draftIndexRows[0]?.indexDefinition).toContain("UNIQUE INDEX");
    expect(draftIndexRows[0]?.indexDefinition).toContain("WHERE (status = 'DRAFT'::text)");

    ({ prisma: appPrisma } = await import("../../src/lib/prisma"));
    formActions = await import("../../src/server/actions/forms");
  });

  afterAll(async () => {
    await Promise.allSettled([
      appPrisma?.$disconnect(),
      lockPrisma?.$disconnect(),
      adminPrisma?.$disconnect(),
    ]);
  });

  it("creates one pending draft when two sessions edit the published definition", async () => {
    const { adminPrisma, lockPrisma, formActions } = requireIntegrationClients();
    await createFixture(adminPrisma, { includeDraft: false });

    try {
      const definitionBefore = await readFormDefinition(adminPrisma, fixtureIds.rootForm);
      const competingInputs = [
        buildFormInput("Pending definition A", "Competing save A", "Pending question A"),
        buildFormInput("Pending definition B", "Competing save B", "Pending question B"),
      ];

      const settledAttempts = await runBehindFamilyLock({
        admin: adminPrisma,
        lockClient: lockPrisma,
        startAttempts: () =>
          competingInputs.map((input) => formActions.updateForm(fixtureIds.rootForm, input)),
      });

      const successes = settledAttempts.filter(
        (
          attempt,
        ): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof formActions.updateForm>>> =>
          attempt.status === "fulfilled",
      );
      const failures = settledAttempts.filter(
        (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
      );
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.reason).toBeInstanceOf(Error);
      expect((failures[0]?.reason as Error).message).toBe(
        "Este formulario ya tiene cambios pendientes. Abre el borrador desde Formularios.",
      );

      const family = await adminPrisma.form.findMany({
        where: {
          campaignId: fixtureIds.campaign,
          OR: [{ id: fixtureIds.rootForm }, { parentFormId: fixtureIds.rootForm }],
        },
        include: { questions: { orderBy: { order: "asc" } } },
      });
      const drafts = family.filter((form) => form.status === "DRAFT");
      const published = family.filter((form) => form.status === "PUBLISHED");
      expect(drafts).toHaveLength(1);
      expect(published).toHaveLength(1);
      expect(published[0]?.id).toBe(fixtureIds.rootForm);
      expect(drafts[0]?.parentFormId).toBe(fixtureIds.rootForm);
      expect(competingInputs.map((input) => input.title)).toContain(drafts[0]?.title);
      expect(competingInputs.map((input) => input.questions[0]?.label)).toContain(
        drafts[0]?.questions[0]?.label,
      );

      expect(await readFormDefinition(adminPrisma, fixtureIds.rootForm)).toEqual(definitionBefore);

      const auditRows = await adminPrisma.auditLog.findMany({
        where: {
          userId: fixtureIds.user,
          campaignId: fixtureIds.campaign,
          module: "forms",
        },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]).toMatchObject({
        action: "revision_created",
        entityType: "form",
        entityId: drafts[0]?.id,
      });
    } finally {
      await cleanupFixture(adminPrisma);
    }
  }, 30_000);

  it("commits either the pending save or publication and rejects the stale competitor", async () => {
    const { adminPrisma, lockPrisma, formActions } = requireIntegrationClients();
    await createFixture(adminPrisma, { includeDraft: true });

    try {
      const definitionBefore = await readFormDefinition(adminPrisma, fixtureIds.rootForm);
      const savedInput = buildFormInput(
        "Pending definition saved during the race",
        "Concurrent save before publication",
        "Pending question saved during the race",
      );

      const settledAttempts = await runBehindFamilyLock({
        admin: adminPrisma,
        lockClient: lockPrisma,
        startAttempts: () => [
          formActions.updateForm(fixtureIds.draftForm, savedInput),
          formActions.publishForm(fixtureIds.draftForm),
        ],
      });

      const successes = settledAttempts.filter((attempt) => attempt.status === "fulfilled");
      const failures = settledAttempts.filter(
        (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
      );
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.reason).toBeInstanceOf(Error);
      expect((failures[0]?.reason as Error).message).toBe(
        "El formulario cambio mientras se procesaba la accion. Recarga la pagina e intenta de nuevo.",
      );

      const family = await adminPrisma.form.findMany({
        where: {
          campaignId: fixtureIds.campaign,
          OR: [{ id: fixtureIds.rootForm }, { parentFormId: fixtureIds.rootForm }],
        },
        include: { questions: { orderBy: { order: "asc" } } },
        orderBy: { version: "asc" },
      });
      const root = family.find((form) => form.id === fixtureIds.rootForm);
      const pendingRevision = family.find((form) => form.id === fixtureIds.draftForm);
      expect(root).toBeDefined();
      expect(pendingRevision).toBeDefined();
      expect(family.filter((form) => form.status === "PUBLISHED")).toHaveLength(1);
      expect(family.filter((form) => form.status === "DRAFT").length).toBeLessThanOrEqual(1);
      expect(await readFormDefinition(adminPrisma, fixtureIds.rootForm)).toEqual(definitionBefore);

      const auditRows = await adminPrisma.auditLog.findMany({
        where: {
          userId: fixtureIds.user,
          campaignId: fixtureIds.campaign,
          module: "forms",
        },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.entityId).toBe(fixtureIds.draftForm);

      if (auditRows[0]?.action === "updated") {
        expect(root?.status).toBe("PUBLISHED");
        expect(pendingRevision).toMatchObject({
          status: "DRAFT",
          title: savedInput.title,
          description: savedInput.description,
        });
        expect(pendingRevision?.questions[0]?.label).toBe(savedInput.questions[0]?.label);
      } else {
        expect(auditRows[0]?.action).toBe("published");
        expect(root?.status).toBe("ARCHIVED");
        expect(pendingRevision).toMatchObject({
          status: "PUBLISHED",
          title: initialDraftDefinition.title,
          description: initialDraftDefinition.description,
        });
        expect(pendingRevision?.questions[0]?.label).toBe(initialDraftDefinition.questionLabel);
      }
    } finally {
      await cleanupFixture(adminPrisma);
    }
  }, 30_000);
});
