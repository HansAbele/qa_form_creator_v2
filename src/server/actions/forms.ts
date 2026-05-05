"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
} from "@/server/queries/campaign-filter";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";
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
      questions: { orderBy: { order: "asc" } },
    },
  });

  if (!form) throw new Error("Formulario no encontrado");

  await assertCampaignPermissionForUser(session.user, form.campaignId, permission);

  return form;
}

export async function createForm(data: {
  title: string;
  description?: string;
  campaignId: string;
  questions: {
    type: QuestionType;
    label: string;
    options?: string[];
    required: boolean;
  }[];
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canCreateForms");

  const form = await prisma.form.create({
    data: {
      title: data.title,
      description: data.description,
      campaignId: data.campaignId,
      createdById: session.user.id,
      questions: {
        create: data.questions.map((q, index) => ({
          type: q.type,
          label: q.label,
          options: q.options ?? undefined,
          required: q.required,
          order: index,
        })),
      },
    },
    include: { questions: true },
  });

  revalidatePath("/forms");
  return form;
}

export async function updateForm(
  id: string,
  data: {
    title: string;
    description?: string;
    campaignId: string;
    questions: {
      type: QuestionType;
      label: string;
      options?: string[];
      required: boolean;
    }[];
  },
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.form.findUnique({
    where: { id },
    select: { campaignId: true },
  });
  if (!existing) throw new Error("Formulario no encontrado");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canEditForms");
  await assertCampaignPermissionForUser(session.user, data.campaignId, "canEditForms");

  const form = await prisma.$transaction(async (tx) => {
    // Delete existing questions
    await tx.question.deleteMany({ where: { formId: id } });

    // Update form and create new questions
    return tx.form.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        campaignId: data.campaignId,
        questions: {
          create: data.questions.map((q, index) => ({
            type: q.type,
            label: q.label,
            options: q.options ?? undefined,
            required: q.required,
            order: index,
          })),
        },
      },
      include: { questions: true },
    });
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
    select: { campaignId: true },
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
  revalidatePath("/forms");
}
