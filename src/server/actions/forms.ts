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

export async function getForms() {
  return getFormsForPermission("canViewForms");
}

export async function getFormsForPermission(permission: CampaignPermissionKey) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(permission);

  return prisma.form.findMany({
    where: campaignFilter,
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
      questions: {
        orderBy: { order: "asc" },
        include: {
          formCategory: { select: { qaCategoryId: true } },
        },
      },
    },
  });

  if (!form) throw new Error("Formulario no encontrado");

  await assertCampaignPermissionForUser(session.user, form.campaignId, permission);

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
      questionCount: form.questions.length,
      categoryCount: form.categories.length,
    },
    impact: "Formulario disponible para evaluaciones segun permisos.",
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

  const form = await prisma.$transaction(async (tx) => {
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
    action: "updated",
    entityType: "form",
    entityId: id,
    beforeValue: existing,
    afterValue: {
      id: form.id,
      title: form.title,
      description: form.description,
      campaignId: form.campaignId,
      questionCount: form.questions.length,
      categoryCount: form.categories.length,
    },
    impact: "Formulario actualizado; afecta evaluaciones futuras.",
  });

  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
  return form;
}

export async function deleteForm(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const form = await prisma.form.findUnique({
    where: { id },
    select: { id: true, title: true, description: true, campaignId: true },
  });
  if (!form) throw new Error("Formulario no encontrado");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canEditForms");

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
