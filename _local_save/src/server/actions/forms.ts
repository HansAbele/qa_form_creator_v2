"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getCampaignFilter } from "@/server/queries/campaign-filter";
import type { QuestionType } from "@prisma/client";

export async function getForms() {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();

  return prisma.form.findMany({
    where: campaignFilter,
    include: {
      campaign: { select: { name: true } },
      _count: { select: { questions: true, responses: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getFormById(id: string) {
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

  // Verify campaign access for QA users
  if (session.user.role !== "ADMIN") {
    if (!session.user.campaignIds.includes(form.campaignId)) {
      throw new Error("No autorizado para ver este formulario");
    }
  }

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

  // QA users can only create forms in their assigned campaigns
  if (session.user.role !== "ADMIN") {
    if (!session.user.campaignIds.includes(data.campaignId)) {
      throw new Error("No autorizado para esta campaña");
    }
  }

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

  // QA users can only edit forms in their assigned campaigns
  if (session.user.role !== "ADMIN") {
    if (!session.user.campaignIds.includes(data.campaignId)) {
      throw new Error("No autorizado para esta campaña");
    }
  }

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

  const responseCount = await prisma.response.count({ where: { formId: id } });
  if (responseCount > 0) {
    throw new Error(
      "No se puede eliminar un formulario que tiene evaluaciones registradas",
    );
  }

  await prisma.form.delete({ where: { id } });
  revalidatePath("/forms");
}
