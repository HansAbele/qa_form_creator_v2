"use server";

import type { Prisma, QuestionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
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

export async function getForms() {
  return listFormsForPermission("canViewForms", { restrictOperationalReaders: true });
}

export async function getFormsForReports() {
  return listFormsForPermission("canViewReports", {
    statuses: [FORM_STATUS.PUBLISHED, FORM_STATUS.ARCHIVED],
  });
}

export async function getFormsForExport() {
  return listFormsForPermission("canExport", {
    statuses: [FORM_STATUS.PUBLISHED, FORM_STATUS.ARCHIVED],
  });
}

async function listFormsForPermission(
  permission: CampaignPermissionKey,
  options: { restrictOperationalReaders?: boolean; statuses?: string[] } = {},
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(permission);
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

export async function getFormForEvaluationCorrection(id: string) {
  return getFormByIdWithPermission(id, "canEditEvaluations", {
    allowedStatuses: [FORM_STATUS.PUBLISHED, FORM_STATUS.ARCHIVED],
  });
}

export async function getFormForDraftCorrection(id: string) {
  return getFormByIdWithPermission(id, "canEditEvaluations", {
    requirePublished: true,
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
  if (!session?.user) throw new Error("No autorizado");

  const form = await prisma.form.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true, active: true } },
      parent: { select: { id: true, version: true, status: true, campaignId: true } },
      revisions: {
        where: { status: { not: FORM_STATUS.ARCHIVED } },
        select: { id: true, version: true, status: true, campaignId: true },
        orderBy: { createdAt: "desc" },
      },
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

  if (!form) throw new Error("Formulario no encontrado");

  await assertCampaignPermissionForUser(session.user, form.campaignId, permission);
  if (options.requirePublished && form.status !== FORM_STATUS.PUBLISHED) {
    throw new Error("Formulario no publicado");
  }
  if (options.allowedStatuses && !options.allowedStatuses.includes(form.status)) {
    throw new Error("Formulario no disponible para correccion");
  }
  if (options.requireActiveCampaign && !form.campaign.active) {
    throw new Error("La campana del formulario esta inactiva");
  }

  let canManageFormVersions = session.user.role === "ADMIN" || permission === "canEditForms";
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
    canManageFormVersions = Boolean(
      access?.canCreateForms || access?.canEditForms || access?.canPublishForms,
    );

    if (form.status !== FORM_STATUS.PUBLISHED || !form.campaign.active) {
      if (!access?.canCreateForms && !access?.canEditForms && !access?.canPublishForms) {
        throw new Error(
          form.status !== FORM_STATUS.PUBLISHED
            ? "Formulario no publicado"
            : "La campana del formulario esta inactiva",
        );
      }
    }
  }

  if (!canManageFormVersions) return { ...form, parent: null, revisions: [] };

  const parent =
    form.parent?.campaignId === form.campaignId
      ? { id: form.parent.id, version: form.parent.version, status: form.parent.status }
      : null;
  const revisions = form.revisions
    .filter((revision) => revision.campaignId === form.campaignId)
    .map((revision) => ({
      id: revision.id,
      version: revision.version,
      status: revision.status,
    }));
  return { ...form, parent, revisions };
}

export async function createForm(data: FormMutationInput) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
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
          version: form.version,
          questionCount: form.questions.length,
          categoryCount: form.categories.length,
        },
        impact: "Formulario creado como borrador; requiere publicacion para evaluar.",
      },
      tx,
    );

    return form;
  });

  revalidatePath("/forms");
  return form;
}

export async function updateForm(id: string, data: FormMutationInput) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  const input = await parseFormInput(data);

  const existing = await prisma.form.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      campaignId: true,
      createdById: true,
      parentFormId: true,
      parent: { select: { campaignId: true } },
      status: true,
      version: true,
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
    },
  });
  if (!existing) throw new Error("Formulario no encontrado");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canEditForms");
  await assertCampaignPermissionForUser(session.user, input.campaignId, "canEditForms");

  if (existing.status === FORM_STATUS.ARCHIVED) {
    throw new Error("No se puede editar un formulario archivado");
  }

  if (existing.parent && existing.parent.campaignId !== existing.campaignId) {
    throw new Error("La revision no pertenece a la misma campana que su formulario base");
  }

  if (
    input.campaignId !== existing.campaignId &&
    (existing.status === FORM_STATUS.PUBLISHED || existing.parentFormId)
  ) {
    throw new Error("No se puede cambiar la campana de una familia de revisiones");
  }

  const isPublishedRevision = existing.status === FORM_STATUS.PUBLISHED;
  const form = await prisma.$transaction(async (tx) => {
    if (isPublishedRevision) {
      const rootFormId = existing.parentFormId ?? existing.id;
      await lockFormFamily(tx, rootFormId);
      const familyVersions = await tx.form.findMany({
        where: {
          campaignId: existing.campaignId,
          OR: [{ id: rootFormId }, { parentFormId: rootFormId }],
        },
        select: { version: true },
      });
      const latestVersion =
        [existing.version, ...(familyVersions ?? []).map((item) => item.version)]
          .sort(compareFormVersions)
          .at(-1) ?? existing.version;
      const draft = await tx.form.create({
        data: {
          title: input.title,
          description: input.description,
          campaignId: existing.campaignId,
          createdById: session.user.id,
          parentFormId: rootFormId,
          status: FORM_STATUS.DRAFT,
          version: nextFormVersion(latestVersion),
        },
      });

      await createFormQuestionStructure(tx, draft.id, input.questions);

      const form = await tx.form.findUniqueOrThrow({
        where: { id: draft.id },
        include: { questions: true, categories: true },
      });

      await writeFormMutationAudit(tx, {
        sessionUserId: session.user.id,
        form,
        existing,
        action: "revision_created",
      });
      return form;
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
      existing,
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
  if (!session?.user) throw new Error("No autorizado");

  const form = await prisma.form.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      campaignId: true,
      parentFormId: true,
      parent: { select: { id: true, campaignId: true } },
      status: true,
      version: true,
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
    },
  });
  if (!form) throw new Error("Formulario no encontrado");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canPublishForms");

  if (form.parent && form.parent.campaignId !== form.campaignId) {
    throw new Error("La revision no pertenece a la misma campana que su formulario base");
  }

  if (form.status === FORM_STATUS.ARCHIVED) {
    throw new Error("No se puede publicar un formulario archivado");
  }
  if (form.status === FORM_STATUS.PUBLISHED) {
    return form;
  }

  validatePublishableForm(form.questions);

  const now = new Date();
  const rootFormId = form.parentFormId ?? form.id;
  const published = await prisma.$transaction(async (tx) => {
    await lockFormFamily(tx, rootFormId);
    await tx.form.updateMany({
      where: {
        campaignId: form.campaignId,
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
        campaignId: form.campaignId,
        module: "forms",
        action: "published",
        entityType: "form",
        entityId: form.id,
        beforeValue: { id: form.id, status: form.status, version: form.version },
        afterValue: {
          id: published.id,
          status: published.status,
          version: published.version,
          parentFormId: published.parentFormId,
        },
        impact:
          "Formulario publicado para evaluaciones; versiones publicadas previas se archivaron.",
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
  if (!session?.user) throw new Error("No autorizado");

  const form = await prisma.form.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      campaignId: true,
      status: true,
      version: true,
    },
  });
  if (!form) throw new Error("Formulario no encontrado");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canPublishForms");

  if (form.status !== FORM_STATUS.PUBLISHED) {
    throw new Error("Solo se pueden archivar formularios publicados");
  }

  const archived = await prisma.$transaction(async (tx) => {
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
        campaignId: form.campaignId,
        module: "forms",
        action: "archived",
        entityType: "form",
        entityId: form.id,
        beforeValue: form,
        afterValue: {
          id: archived.id,
          status: archived.status,
          version: archived.version,
          archivedAt: archived.archivedAt,
        },
        impact:
          "Formulario retirado de evaluaciones futuras; evaluaciones historicas se conservan.",
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
  if (!session?.user) throw new Error("No autorizado");

  const form = await prisma.form.findUnique({
    where: { id },
    select: { id: true, title: true, description: true, campaignId: true, status: true },
  });
  if (!form) throw new Error("Formulario no encontrado");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canEditForms");

  if (form.status !== FORM_STATUS.DRAFT) {
    throw new Error("Solo se pueden eliminar borradores; archiva formularios publicados");
  }

  const responseCount = await prisma.response.count({ where: { formId: id } });
  if (responseCount > 0) {
    throw new Error("No se puede eliminar un formulario que tiene evaluaciones registradas");
  }

  await prisma.$transaction(async (tx) => {
    await tx.form.delete({ where: { id } });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: form.campaignId,
        module: "forms",
        action: "deleted",
        entityType: "form",
        entityId: id,
        beforeValue: form,
        impact: "Formulario eliminado sin evaluaciones registradas.",
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

function nextFormVersion(version: string) {
  const [major = 1, minor = 0] = version
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));

  return `${major}.${minor + 1}.0`;
}

function compareFormVersions(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
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
      version: string;
      parentFormId: string | null;
      questions: unknown[];
      categories: unknown[];
    };
    existing: unknown;
    action: "revision_created" | "updated";
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
        version: input.form.version,
        parentFormId: input.form.parentFormId,
      },
      impact:
        input.action === "revision_created"
          ? "Se creo un borrador de nueva version; el formulario publicado sigue vigente."
          : "Formulario actualizado; afecta evaluaciones futuras si se publica.",
    },
    tx,
  );
}

function validatePublishableForm(questions: PublishableQuestion[]) {
  if (questions.length === 0) {
    throw new Error("Agrega al menos una pregunta antes de publicar");
  }

  if (questions.some((question) => !question.formCategoryId)) {
    throw new Error("Todas las preguntas deben tener categoria QA antes de publicar");
  }

  const invalidFatalOptionQuestion = questions.some((question) => {
    if (!question.fatal || !isOptionQuestion(question.type)) return false;
    const options = getStringOptions(question.options);
    const fatalOptions = getStringOptions(question.fatalOptions);
    return fatalOptions.length === 0 || fatalOptions.some((option) => !options.includes(option));
  });
  if (invalidFatalOptionQuestion) {
    throw new Error("Selecciona al menos una opcion fatal valida antes de publicar");
  }

  const scoredQuestions = questions.filter((question) => isScoredQuestionType(question.type));
  if (scoredQuestions.length === 0) return;

  const scoredWeightTotal = scoredQuestions.reduce((sum, question) => sum + question.weight, 0);
  if (scoredWeightTotal !== 100) {
    throw new Error("Los pesos de las preguntas puntuables deben sumar 100% antes de publicar");
  }
}

async function parseFormInput(data: unknown): Promise<FormMutationInput> {
  const parsed = formMutationSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Datos del formulario invalidos");
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
    throw new Error("Una o mas categorias QA no estan disponibles");
  }

  for (const question of input.questions) {
    const category = categoriesById.get(question.qaCategoryId);
    if (question.fatal && !category?.canBeFatal) {
      throw new Error("La categoria seleccionada no permite fallas fatales");
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
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter(Boolean)
    : [];
}
