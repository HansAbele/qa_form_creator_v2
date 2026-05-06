"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
} from "@/server/queries/campaign-filter";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";
import {
  type FormMutationInput,
  formMutationSchema,
} from "@/types/form-builder";
import type { QuestionType } from "@prisma/client";

const FORM_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
} as const;

export async function getForms() {
  return getFormsForPermission("canViewForms");
}

export async function getFormsForPermission(permission: CampaignPermissionKey) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(permission);

  return prisma.form.findMany({
    where: { ...campaignFilter, status: { not: FORM_STATUS.ARCHIVED } },
    include: {
      campaign: {
        select: {
          name: true,
          users: {
            where: { userId: session.user.id },
            select: {
              canCreateForms: true,
              canEditForms: true,
              canEvaluate: true,
            },
          },
        },
      },
      _count: { select: { questions: true, responses: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getFormById(id: string) {
  return getFormByIdForPermission(id, "canViewForms");
}

export async function getFormByIdForPermission(
  id: string,
  permission: CampaignPermissionKey,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const form = await prisma.form.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true } },
      parent: { select: { id: true, version: true, status: true } },
      revisions: {
        where: { status: { not: FORM_STATUS.ARCHIVED } },
        select: { id: true, version: true, status: true },
        orderBy: { createdAt: "desc" },
      },
      questions: {
        orderBy: { order: "asc" },
        include: {
          formCategory: {
            select: {
              qaCategoryId: true,
              qaCategory: {
                select: {
                  id: true,
                  name: true,
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
  if (permission === "canEvaluate" && form.status !== FORM_STATUS.PUBLISHED) {
    throw new Error("Formulario no publicado");
  }

  return form;
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

    return tx.form.findUniqueOrThrow({
      where: { id: createdForm.id },
      include: { questions: true, categories: true },
    });
  });

  await writeAuditLog({
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
  });

  revalidatePath("/forms");
  return form;
}

export async function updateForm(
  id: string,
  data: FormMutationInput,
) {
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

  if (existing.status === FORM_STATUS.PUBLISHED && input.campaignId !== existing.campaignId) {
    throw new Error("No se puede cambiar la campana de un formulario publicado");
  }

  const isPublishedRevision = existing.status === FORM_STATUS.PUBLISHED;
  const form = await prisma.$transaction(async (tx) => {
    if (isPublishedRevision) {
      const draft = await tx.form.create({
        data: {
          title: input.title,
          description: input.description,
          campaignId: existing.campaignId,
          createdById: session.user.id,
          parentFormId: existing.parentFormId ?? existing.id,
          status: FORM_STATUS.DRAFT,
          version: nextFormVersion(existing.version),
        },
      });

      await createFormQuestionStructure(tx, draft.id, input.questions);

      return tx.form.findUniqueOrThrow({
        where: { id: draft.id },
        include: { questions: true, categories: true },
      });
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

    return tx.form.findUniqueOrThrow({
      where: { id },
      include: { questions: true, categories: true },
    });
  });

  await writeAuditLog({
    userId: session.user.id,
    campaignId: form.campaignId,
    module: "forms",
    action: isPublishedRevision ? "revision_created" : "updated",
    entityType: "form",
    entityId: form.id,
    beforeValue: existing,
    afterValue: {
      id: form.id,
      title: form.title,
      description: form.description,
      campaignId: form.campaignId,
      questionCount: form.questions.length,
      categoryCount: form.categories.length,
      status: form.status,
      version: form.version,
      parentFormId: form.parentFormId,
    },
    impact: isPublishedRevision
      ? "Se creo un borrador de nueva version; el formulario publicado sigue vigente."
      : "Formulario actualizado; afecta evaluaciones futuras si se publica.",
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
      status: true,
      version: true,
      questions: {
        select: {
          id: true,
          type: true,
          weight: true,
          formCategoryId: true,
        },
      },
    },
  });
  if (!form) throw new Error("Formulario no encontrado");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canEditForms");

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
    await tx.form.updateMany({
      where: {
        status: FORM_STATUS.PUBLISHED,
        id: { not: id },
        OR: [{ id: rootFormId }, { parentFormId: rootFormId }],
      },
      data: {
        status: FORM_STATUS.ARCHIVED,
        archivedAt: now,
      },
    });

    return tx.form.update({
      where: { id },
      data: {
        status: FORM_STATUS.PUBLISHED,
        publishedAt: now,
        archivedAt: null,
      },
    });
  });

  await writeAuditLog({
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
    impact: "Formulario publicado para evaluaciones; versiones publicadas previas se archivaron.",
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
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canEditForms");

  if (form.status !== FORM_STATUS.PUBLISHED) {
    throw new Error("Solo se pueden archivar formularios publicados");
  }

  const archived = await prisma.form.update({
    where: { id },
    data: {
      status: FORM_STATUS.ARCHIVED,
      archivedAt: new Date(),
    },
  });

  await writeAuditLog({
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
    impact: "Formulario retirado de evaluaciones futuras; evaluaciones historicas se conservan.",
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
    throw new Error(
      "No se puede eliminar un formulario que tiene evaluaciones registradas",
    );
  }

  await prisma.form.delete({ where: { id } });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: form.campaignId,
    module: "forms",
    action: "deleted",
    entityType: "form",
    entityId: id,
    beforeValue: form,
    impact: "Formulario eliminado sin evaluaciones registradas.",
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
  weight: number;
  formCategoryId: string | null;
};

function nextFormVersion(version: string) {
  const [major = 1, minor = 0] = version
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));

  return `${major}.${minor + 1}.0`;
}

function validatePublishableForm(questions: PublishableQuestion[]) {
  if (questions.length === 0) {
    throw new Error("Agrega al menos una pregunta antes de publicar");
  }

  if (questions.some((question) => !question.formCategoryId)) {
    throw new Error("Todas las preguntas deben tener categoria QA antes de publicar");
  }

  const ratingQuestions = questions.filter((question) => question.type === "RATING");
  if (ratingQuestions.length === 0) return;

  const ratingWeightTotal = ratingQuestions.reduce(
    (sum, question) => sum + question.weight,
    0,
  );
  if (ratingWeightTotal !== 100) {
    throw new Error("Los pesos de preguntas rating deben sumar 100% antes de publicar");
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
        requiresCommentOnFail:
          question.requiresCommentOnFail ||
          Boolean(category?.requiresCommentOnFail),
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
      (sum, question) => sum + (question.type === "RATING" ? question.weight : 0),
      0,
    );

    const formCategory = await tx.formCategory.create({
      data: {
        formId,
        qaCategoryId,
        weight,
        fatalIfFailed: categoryQuestions.some((question) => question.fatal),
        requiresComment: categoryQuestions.some(
          (question) => question.requiresCommentOnFail,
        ),
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
      options: question.options ?? undefined,
      required: question.required,
      weight: question.type === "RATING" ? question.weight : 0,
      fatal: question.fatal,
      requiresCommentOnFail: question.requiresCommentOnFail,
      order: index,
    })),
  });
}
