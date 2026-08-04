"use server";

import type { Prisma, QuestionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";
import { PARKER_DAVIS_SCORECARD } from "@/lib/official-form-templates";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermissions,
} from "@/server/queries/campaign-filter";
import {
  type FormMutationInput,
  formMutationSchema,
  isScoredQuestionType,
} from "@/types/form-builder";

const FORM_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
} as const;

const FORM_UPDATE_SNAPSHOT_SELECT = {
  id: true,
  title: true,
  description: true,
  campaignId: true,
  createdById: true,
  parentFormId: true,
  parent: { select: { campaignId: true } },
  status: true,
  version: true,
  templateKey: true,
  templateVersion: true,
  passThresholdOverride: true,
  gradingScale: true,
  updatedAt: true,
  questions: {
    select: {
      id: true,
      type: true,
      label: true,
      required: true,
      weight: true,
      fatal: true,
      fatalOptions: true,
      requiresCommentOnFail: true,
      order: true,
      formCategory: {
        select: { qaCategoryId: true },
      },
    },
    orderBy: { order: "asc" },
  },
} satisfies Prisma.FormSelect;

const FORM_PUBLISH_SNAPSHOT_SELECT = {
  id: true,
  title: true,
  campaignId: true,
  createdById: true,
  parentFormId: true,
  parent: { select: { id: true, campaignId: true } },
  status: true,
  version: true,
  updatedAt: true,
  questions: {
    select: {
      id: true,
      type: true,
      options: true,
      weight: true,
      fatal: true,
      fatalOptions: true,
      formCategoryId: true,
    },
  },
} satisfies Prisma.FormSelect;

function assertQaOwnsForm(
  user: { id: string; role?: string | null },
  form: { createdById: string },
) {
  if (user.role === "QA" && form.createdById !== user.id) {
    throw new Error("You can only modify forms you created");
  }
}

export async function getForms() {
  return listFormsForPermissions(["canViewForms"], { restrictOperationalReaders: true });
}

export async function getFormsForReports() {
  return listFormsForPermissions(["canViewReports"], {
    statuses: [FORM_STATUS.PUBLISHED, FORM_STATUS.ARCHIVED],
  });
}

export async function getFormsForExport() {
  return listFormsForPermissions(["canExport", "canViewReports"], {
    statuses: [FORM_STATUS.PUBLISHED, FORM_STATUS.ARCHIVED],
  });
}

async function listFormsForPermissions(
  permissions: readonly [CampaignPermissionKey, ...CampaignPermissionKey[]],
  options: { restrictOperationalReaders?: boolean; statuses?: string[] } = {},
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const campaignFilter = await getCampaignFilterForPermissions(permissions);
  const formVisibility: Prisma.FormWhereInput =
    options.restrictOperationalReaders && session.user.role !== "ADMIN"
      ? {
          OR: [
            {
              status: FORM_STATUS.PUBLISHED,
              campaign: { active: true },
            },
            ...(session.user.role === "QA"
              ? [
                  {
                    createdById: session.user.id,
                    campaign: {
                      users: {
                        some: {
                          userId: session.user.id,
                          OR: [
                            { canCreateForms: true },
                            { canEditForms: true },
                            { canPublishForms: true },
                          ],
                        },
                      },
                    },
                  },
                ]
              : []),
          ],
        }
      : {};

  return prisma.form.findMany({
    where: {
      ...campaignFilter,
      ...formVisibility,
      status: options.statuses ? { in: options.statuses } : { not: FORM_STATUS.ARCHIVED },
    },
    include: {
      campaign: {
        select: {
          name: true,
          active: true,
          users: {
            where: { userId: session.user.id },
            select: {
              canCreateForms: true,
              canEditForms: true,
              canPublishForms: true,
              canEvaluate: true,
            },
          },
        },
      },
      _count: { select: { questions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getFormById(id: string) {
  return getFormByIdWithPermission(id, "canViewForms");
}

export async function getFormForEditing(id: string) {
  return getFormByIdWithPermission(id, "canEditForms");
}

export async function getFormForEvaluation(id: string) {
  return getFormByIdWithPermission(id, "canEvaluate", {
    requirePublished: true,
    requireActiveCampaign: true,
  });
}

export async function getFormForEvaluationDraft(id: string) {
  return getFormByIdWithPermission(id, "canEvaluate", {
    allowedStatuses: [FORM_STATUS.PUBLISHED, FORM_STATUS.ARCHIVED],
    requireActiveCampaign: true,
  });
}

export async function getFormForEvaluationCorrection(id: string) {
  return getFormByIdWithPermission(id, "canEditEvaluations", {
    allowedStatuses: [FORM_STATUS.PUBLISHED, FORM_STATUS.ARCHIVED],
  });
}

export async function getFormForDraftCorrection(id: string) {
  return getFormByIdWithPermission(id, "canEditEvaluations", {
    allowedStatuses: [FORM_STATUS.PUBLISHED, FORM_STATUS.ARCHIVED],
    requireActiveCampaign: true,
  });
}

async function getFormByIdWithPermission(
  id: string,
  permission: CampaignPermissionKey,
  options: {
    requirePublished?: boolean;
    requireActiveCampaign?: boolean;
    allowedStatuses?: string[];
  } = {},
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const form = await prisma.form.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true, active: true } },
      questions: {
        orderBy: { order: "asc" },
        include: {
          formCategory: {
            select: {
              qaCategoryId: true,
              weight: true,
              fatalIfFailed: true,
              requiresComment: true,
              sortOrder: true,
              qaCategory: {
                select: {
                  id: true,
                  name: true,
                  systemColor: true,
                  systemIcon: true,
                  canBeFatal: true,
                  requiresCommentOnFail: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!form) throw new Error("Form not found");

  await assertCampaignPermissionForUser(session.user, form.campaignId, permission);
  if (options.requirePublished && form.status !== FORM_STATUS.PUBLISHED) {
    throw new Error("Form is not published");
  }
  if (options.allowedStatuses && !options.allowedStatuses.includes(form.status)) {
    throw new Error("Form is not available for correction");
  }
  if (options.requireActiveCampaign && !form.campaign.active) {
    throw new Error("The form campaign is inactive");
  }

  if (permission === "canViewForms" && session.user.role !== "ADMIN") {
    const access =
      session.user.role === "QA"
        ? await prisma.userCampaign.findUnique({
            where: {
              userId_campaignId: {
                userId: session.user.id,
                campaignId: form.campaignId,
              },
            },
            select: {
              canCreateForms: true,
              canEditForms: true,
              canPublishForms: true,
            },
          })
        : null;
    const canManageOwnForm =
      form.createdById === session.user.id &&
      Boolean(access?.canCreateForms || access?.canEditForms || access?.canPublishForms);
    if (form.status !== FORM_STATUS.PUBLISHED || !form.campaign.active) {
      if (!canManageOwnForm) {
        throw new Error(
          form.status !== FORM_STATUS.PUBLISHED
            ? "Form is not published"
            : "The form campaign is inactive",
        );
      }
    }
  }

  return form;
}

export async function createForm(data: FormMutationInput) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const input = await parseFormInput(data);

  await assertCampaignPermissionForUser(session.user, input.campaignId, "canCreateForms");

  const form = await prisma.$transaction(async (tx) => {
    const createdForm = await tx.form.create({
      data: {
        title: input.title,
        description: input.description,
        campaignId: input.campaignId,
        createdById: session.user.id,
        status: FORM_STATUS.DRAFT,
      },
    });

    await createFormQuestionStructure(tx, createdForm.id, input.questions);

    const form = await tx.form.findUniqueOrThrow({
      where: { id: createdForm.id },
      include: { questions: true, categories: true },
    });

    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: input.campaignId,
        module: "forms",
        action: "created",
        entityType: "form",
        entityId: form.id,
        afterValue: {
          id: form.id,
          title: form.title,
          description: form.description,
          campaignId: form.campaignId,
          status: form.status,
          questionCount: form.questions.length,
          categoryCount: form.categories.length,
        },
        impact: "Form created as a draft; it must be published before evaluations can use it.",
      },
      tx,
    );

    return form;
  });

  revalidatePath("/forms");
  return form;
}

export async function createParkerDavisScorecard(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const normalizedCampaignId = campaignId.trim();
  if (!normalizedCampaignId) throw new Error("Select a campaign");

  await assertCampaignPermissionForUser(session.user, normalizedCampaignId, "canCreateForms");
  const input = await parseFormInput({
    title: PARKER_DAVIS_SCORECARD.title,
    description: PARKER_DAVIS_SCORECARD.description,
    campaignId: normalizedCampaignId,
    questions: PARKER_DAVIS_SCORECARD.questions,
  });

  const result = await prisma.$transaction(async (tx) => {
    await lockFormFamily(tx, `${normalizedCampaignId}:${PARKER_DAVIS_SCORECARD.key}`);

    const existing = await tx.form.findFirst({
      where: {
        campaignId: normalizedCampaignId,
        templateKey: PARKER_DAVIS_SCORECARD.key,
        status: { not: FORM_STATUS.ARCHIVED },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (existing) {
      return { id: existing.id, status: existing.status, created: false };
    }

    const createdForm = await tx.form.create({
      data: {
        title: input.title,
        description: input.description,
        campaignId: normalizedCampaignId,
        createdById: session.user.id,
        status: FORM_STATUS.DRAFT,
        templateKey: PARKER_DAVIS_SCORECARD.key,
        templateVersion: PARKER_DAVIS_SCORECARD.version,
        passThresholdOverride: PARKER_DAVIS_SCORECARD.passThreshold,
        gradingScale: PARKER_DAVIS_SCORECARD.gradingScale.map((band) => ({ ...band })),
      },
      select: { id: true, status: true },
    });

    await createFormQuestionStructure(tx, createdForm.id, input.questions);

    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: normalizedCampaignId,
        module: "forms",
        action: "official_template_created",
        entityType: "form",
        entityId: createdForm.id,
        afterValue: {
          id: createdForm.id,
          title: input.title,
          templateKey: PARKER_DAVIS_SCORECARD.key,
          templateVersion: PARKER_DAVIS_SCORECARD.version,
          passThreshold: PARKER_DAVIS_SCORECARD.passThreshold,
          questionCount: input.questions.length,
        },
        impact: "Official Parker Davis QA scorecard created as a draft for review and publication.",
      },
      tx,
    );

    return { id: createdForm.id, status: createdForm.status, created: true };
  });

  revalidatePath("/forms");
  return result;
}

export async function updateForm(id: string, data: FormMutationInput) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const input = await parseFormInput(data);

  const existing = await prisma.form.findUnique({
    where: { id },
    select: FORM_UPDATE_SNAPSHOT_SELECT,
  });
  if (!existing) throw new Error("Form not found");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canEditForms");
  await assertCampaignPermissionForUser(session.user, input.campaignId, "canEditForms");

  if (existing.status === FORM_STATUS.ARCHIVED) {
    throw new Error("An archived form cannot be edited");
  }

  if (existing.parent && existing.parent.campaignId !== existing.campaignId) {
    throw new Error("The legacy form record belongs to a different campaign");
  }

  if (
    input.campaignId !== existing.campaignId &&
    (existing.status === FORM_STATUS.PUBLISHED || existing.parentFormId)
  ) {
    throw new Error("A published or legacy form cannot be moved to another campaign");
  }

  const rootFormId = existing.parentFormId ?? existing.id;
  const form = await prisma.$transaction(async (tx) => {
    await lockFormFamily(tx, rootFormId);
    const current = await tx.form.findUnique({
      where: { id },
      select: FORM_UPDATE_SNAPSHOT_SELECT,
    });
    if (!current) throw new Error("Form not found");
    assertUnchangedFormSnapshot(existing, current);

    if (current.status === FORM_STATUS.ARCHIVED) {
      throw new Error("An archived form cannot be edited");
    }
    if (current.parent && current.parent.campaignId !== current.campaignId) {
      throw new Error("The legacy form record belongs to a different campaign");
    }
    if (
      input.campaignId !== current.campaignId &&
      (current.status === FORM_STATUS.PUBLISHED || current.parentFormId)
    ) {
      throw new Error("A published or legacy form cannot be moved to another campaign");
    }

    if (current.status === FORM_STATUS.PUBLISHED) {
      const replacedAt = new Date();
      const replacement = await tx.form.create({
        data: {
          title: input.title,
          description: input.description,
          campaignId: current.campaignId,
          createdById: current.createdById,
          status: FORM_STATUS.PUBLISHED,
          templateKey: current.templateKey,
          templateVersion: current.templateVersion,
          passThresholdOverride: current.passThresholdOverride,
          gradingScale:
            current.gradingScale === null
              ? undefined
              : (current.gradingScale as Prisma.InputJsonValue),
          publishedAt: replacedAt,
        },
      });

      await createFormQuestionStructure(tx, replacement.id, input.questions);
      await tx.form.update({
        where: { id: current.id },
        data: { status: FORM_STATUS.ARCHIVED, archivedAt: replacedAt },
      });

      const form = await tx.form.findUniqueOrThrow({
        where: { id: replacement.id },
        include: { questions: true, categories: true },
      });

      await writeFormMutationAudit(tx, {
        sessionUserId: session.user.id,
        form,
        existing: current,
        action: "updated",
      });
      return form;
    }

    if (current.status !== FORM_STATUS.DRAFT) {
      throw new Error("The form is no longer available for editing");
    }

    await tx.question.deleteMany({ where: { formId: id } });
    await tx.formCategory.deleteMany({ where: { formId: id } });

    await tx.form.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        campaignId: input.campaignId,
      },
    });

    await createFormQuestionStructure(tx, id, input.questions);

    const form = await tx.form.findUniqueOrThrow({
      where: { id },
      include: { questions: true, categories: true },
    });

    await writeFormMutationAudit(tx, {
      sessionUserId: session.user.id,
      form,
      existing: current,
      action: "updated",
    });
    return form;
  });

  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  revalidatePath(`/forms/${form.id}`);
  return form;
}

export async function publishForm(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const form = await prisma.form.findUnique({
    where: { id },
    select: FORM_PUBLISH_SNAPSHOT_SELECT,
  });
  if (!form) throw new Error("Form not found");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canPublishForms");
  assertQaOwnsForm(session.user, form);

  if (form.parent && form.parent.campaignId !== form.campaignId) {
    throw new Error("The legacy form record belongs to a different campaign");
  }

  const rootFormId = form.parentFormId ?? form.id;
  const published = await prisma.$transaction(async (tx) => {
    await lockFormFamily(tx, rootFormId);
    const current = await tx.form.findUnique({
      where: { id },
      select: FORM_PUBLISH_SNAPSHOT_SELECT,
    });
    if (!current) throw new Error("Form not found");
    assertUnchangedFormSnapshot(form, current);
    assertQaOwnsForm(session.user, current);

    if (current.parent && current.parent.campaignId !== current.campaignId) {
      throw new Error("The legacy form record belongs to a different campaign");
    }
    if (current.status === FORM_STATUS.ARCHIVED) {
      throw new Error("An archived form cannot be published");
    }
    if (current.status === FORM_STATUS.PUBLISHED) {
      return current;
    }
    if (current.status !== FORM_STATUS.DRAFT) {
      throw new Error("The form is no longer available for publication");
    }

    validatePublishableForm(current.questions);
    const now = new Date();
    await tx.form.updateMany({
      where: {
        campaignId: current.campaignId,
        status: FORM_STATUS.PUBLISHED,
        id: { not: id },
        OR: [{ id: rootFormId }, { parentFormId: rootFormId }],
      },
      data: {
        status: FORM_STATUS.ARCHIVED,
        archivedAt: now,
      },
    });

    const published = await tx.form.update({
      where: { id },
      data: {
        status: FORM_STATUS.PUBLISHED,
        publishedAt: now,
        archivedAt: null,
      },
    });

    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: current.campaignId,
        module: "forms",
        action: "published",
        entityType: "form",
        entityId: current.id,
        beforeValue: { id: current.id, status: current.status },
        afterValue: {
          id: published.id,
          status: published.status,
        },
        impact: "Form published for evaluations; any previous active definition was archived.",
      },
      tx,
    );
    return published;
  });

  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return published;
}

export async function archiveForm(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const form = await prisma.form.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      campaignId: true,
      createdById: true,
      parentFormId: true,
      status: true,
      version: true,
      updatedAt: true,
    },
  });
  if (!form) throw new Error("Form not found");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canPublishForms");
  assertQaOwnsForm(session.user, form);

  const rootFormId = form.parentFormId ?? form.id;
  const archived = await prisma.$transaction(async (tx) => {
    await lockFormFamily(tx, rootFormId);
    const current = await tx.form.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        campaignId: true,
        createdById: true,
        parentFormId: true,
        status: true,
        version: true,
        updatedAt: true,
      },
    });
    if (!current) throw new Error("Form not found");
    assertUnchangedFormSnapshot(form, current);
    assertQaOwnsForm(session.user, current);
    if (current.status !== FORM_STATUS.PUBLISHED) {
      throw new Error("Only published forms can be archived");
    }

    const archived = await tx.form.update({
      where: { id },
      data: {
        status: FORM_STATUS.ARCHIVED,
        archivedAt: new Date(),
      },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: current.campaignId,
        module: "forms",
        action: "archived",
        entityType: "form",
        entityId: current.id,
        beforeValue: current,
        afterValue: {
          id: archived.id,
          status: archived.status,
          archivedAt: archived.archivedAt,
        },
        impact: "Form removed from future evaluations; historical evaluations are preserved.",
      },
      tx,
    );
    return archived;
  });

  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return archived;
}

export async function deleteForm(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const form = await prisma.form.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      campaignId: true,
      createdById: true,
      parentFormId: true,
      status: true,
      updatedAt: true,
    },
  });
  if (!form) throw new Error("Form not found");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canEditForms");
  assertQaOwnsForm(session.user, form);

  const rootFormId = form.parentFormId ?? form.id;
  await prisma.$transaction(async (tx) => {
    await lockFormFamily(tx, rootFormId);
    const current = await tx.form.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        campaignId: true,
        createdById: true,
        parentFormId: true,
        status: true,
        updatedAt: true,
      },
    });
    if (!current) throw new Error("Form not found");
    assertUnchangedFormSnapshot(form, current);
    assertQaOwnsForm(session.user, current);
    if (current.status !== FORM_STATUS.DRAFT) {
      throw new Error("Only drafts can be deleted; archive published forms");
    }

    const responseCount = await tx.response.count({ where: { formId: id } });
    if (responseCount > 0) {
      throw new Error("A form with recorded evaluations cannot be deleted");
    }

    await tx.form.delete({ where: { id } });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: current.campaignId,
        module: "forms",
        action: "deleted",
        entityType: "form",
        entityId: id,
        beforeValue: current,
        impact: "Form deleted with no recorded evaluations.",
      },
      tx,
    );
  });
  revalidatePath("/forms");
}

type FormQuestionInput = FormMutationInput["questions"][number];

type FormWriteTransaction = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type PublishableQuestion = {
  type: QuestionType;
  options: unknown;
  weight: number;
  fatal: boolean;
  fatalOptions: unknown;
  formCategoryId: string | null;
};

function assertUnchangedFormSnapshot(
  initial: {
    campaignId: string;
    createdById: string;
    parentFormId: string | null;
    status: string;
    updatedAt?: Date;
  },
  current: {
    campaignId: string;
    createdById: string;
    parentFormId: string | null;
    status: string;
    updatedAt?: Date;
  },
) {
  const timestampChanged =
    initial.updatedAt instanceof Date &&
    current.updatedAt instanceof Date &&
    initial.updatedAt.getTime() !== current.updatedAt.getTime();
  if (
    timestampChanged ||
    initial.campaignId !== current.campaignId ||
    initial.createdById !== current.createdById ||
    initial.parentFormId !== current.parentFormId ||
    initial.status !== current.status
  ) {
    throw new Error(
      "The form changed while the action was being processed. Reload the page and try again.",
    );
  }
}

async function lockFormFamily(tx: FormWriteTransaction, rootFormId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rootFormId}, 0))`;
}

async function writeFormMutationAudit(
  tx: FormWriteTransaction,
  input: {
    sessionUserId: string;
    form: {
      id: string;
      title: string;
      description: string | null;
      campaignId: string;
      status: string;
      questions: unknown[];
      categories: unknown[];
    };
    existing: unknown;
    action: "updated";
  },
) {
  await writeAuditLog(
    {
      userId: input.sessionUserId,
      campaignId: input.form.campaignId,
      module: "forms",
      action: input.action,
      entityType: "form",
      entityId: input.form.id,
      beforeValue: input.existing,
      afterValue: {
        id: input.form.id,
        title: input.form.title,
        description: input.form.description,
        campaignId: input.form.campaignId,
        questionCount: input.form.questions.length,
        categoryCount: input.form.categories.length,
        status: input.form.status,
      },
      impact: "Form updated for future evaluations; historical evaluations remain unchanged.",
    },
    tx,
  );
}

function validatePublishableForm(questions: PublishableQuestion[]) {
  if (questions.length === 0) {
    throw new Error("Add at least one question before publishing");
  }

  if (questions.some((question) => !question.formCategoryId)) {
    throw new Error("Every question must have a QA category before publishing");
  }

  const invalidFatalOptionQuestion = questions.some((question) => {
    if (!question.fatal || !isOptionQuestion(question.type)) return false;
    const options = getStringOptions(question.options);
    const fatalOptions = getStringOptions(question.fatalOptions);
    return fatalOptions.length === 0 || fatalOptions.some((option) => !options.includes(option));
  });
  if (invalidFatalOptionQuestion) {
    throw new Error("Select at least one valid critical option before publishing");
  }

  const scoredQuestions = questions.filter((question) => isScoredQuestionType(question.type));
  if (scoredQuestions.length === 0) return;

  const scoredWeightTotal = scoredQuestions.reduce((sum, question) => sum + question.weight, 0);
  if (scoredWeightTotal !== 100) {
    throw new Error("Scored question weights must total 100% before publishing");
  }
}

async function parseFormInput(data: unknown): Promise<FormMutationInput> {
  const parsed = formMutationSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid form data");
  }

  const input = parsed.data;
  const categoryIds = [...new Set(input.questions.map((question) => question.qaCategoryId))];
  const categories = await prisma.qACategory.findMany({
    where: { id: { in: categoryIds }, isActive: true },
    select: {
      id: true,
      canBeFatal: true,
      requiresCommentOnFail: true,
    },
  });
  const categoriesById = new Map(categories.map((category) => [category.id, category]));

  if (categoriesById.size !== categoryIds.length) {
    throw new Error("One or more QA categories are unavailable");
  }

  for (const question of input.questions) {
    const category = categoriesById.get(question.qaCategoryId);
    if (question.fatal && !category?.canBeFatal) {
      throw new Error("The selected category does not allow critical failures");
    }
  }

  return {
    ...input,
    questions: input.questions.map((question) => {
      const category = categoriesById.get(question.qaCategoryId);
      return {
        ...question,
        fatal: category?.canBeFatal ? question.fatal : false,
        fatalOptions:
          category?.canBeFatal && question.fatal && isOptionQuestion(question.type)
            ? question.fatalOptions
            : undefined,
        requiresCommentOnFail:
          question.requiresCommentOnFail || Boolean(category?.requiresCommentOnFail),
      };
    }),
  };
}

async function createFormQuestionStructure(
  tx: FormWriteTransaction,
  formId: string,
  questions: FormQuestionInput[],
) {
  const formCategoryIds = new Map<string, string>();
  const categoryOrder = [...new Set(questions.map((question) => question.qaCategoryId))];

  for (const qaCategoryId of categoryOrder) {
    const categoryQuestions = questions.filter(
      (question) => question.qaCategoryId === qaCategoryId,
    );
    const weight = categoryQuestions.reduce(
      (sum, question) => sum + (isScoredQuestionType(question.type) ? question.weight : 0),
      0,
    );

    const formCategory = await tx.formCategory.create({
      data: {
        formId,
        qaCategoryId,
        weight,
        fatalIfFailed: categoryQuestions.some((question) => question.fatal),
        requiresComment: categoryQuestions.some((question) => question.requiresCommentOnFail),
        sortOrder: categoryOrder.indexOf(qaCategoryId),
      },
      select: { id: true },
    });
    formCategoryIds.set(qaCategoryId, formCategory.id);
  }

  await tx.question.createMany({
    data: questions.map((question, index) => ({
      formId,
      formCategoryId: formCategoryIds.get(question.qaCategoryId),
      type: question.type as QuestionType,
      label: question.label,
      options: buildOptionsJson(question),
      fatalOptions:
        question.fatal && isOptionQuestion(question.type)
          ? (question.fatalOptions ?? undefined)
          : undefined,
      required: question.required,
      weight: isScoredQuestionType(question.type) ? question.weight : 0,
      fatal: question.fatal,
      criticalType: question.fatal ? (question.criticalType ?? null) : null,
      ratingFailThreshold:
        question.fatal && question.type === "RATING"
          ? (question.ratingFailThreshold ?? null)
          : null,
      ratingMax: question.type === "RATING" ? (question.ratingMax ?? null) : null,
      ratingStyle: question.type === "RATING" ? (question.ratingStyle ?? null) : null,
      requiresCommentOnFail: question.requiresCommentOnFail,
      order: index,
    })),
  });
}

function isOptionQuestion(type: QuestionType) {
  return type === "SELECT" || type === "RADIO" || type === "BOOLEAN";
}

/** Option types persist weighted options `[{value, points}]`; other types keep plain options. */
function buildOptionsJson(question: FormQuestionInput) {
  if (!isOptionQuestion(question.type)) return question.options ?? undefined;
  const options = question.options ?? [];
  if (options.length === 0) return undefined;
  const points = question.optionPoints ?? [];
  return options.map((value, index) => ({ value, points: points[index] ?? 0 }));
}

function getStringOptions(options: unknown) {
  return Array.isArray(options)
    ? options
        .map((option) =>
          typeof option === "string"
            ? option
            : option && typeof option === "object" && "value" in option
              ? String((option as { value: unknown }).value)
              : "",
        )
        .map((option) => option.trim())
        .filter(Boolean)
    : [];
}
