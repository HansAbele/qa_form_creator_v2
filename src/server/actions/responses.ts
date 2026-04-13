"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getCampaignFilter } from "@/server/queries/campaign-filter";

export async function getResponses(formId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();

  const where = {
    ...(formId ? { formId } : {}),
    form: campaignFilter,
  };

  const responses = await prisma.response.findMany({
    where,
    include: {
      form: { select: { title: true } },
      agent: { select: { name: true } },
      evaluator: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return responses.map((r) => ({
    ...r,
    score: Number(r.score),
  }));
}

export async function getResponseById(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const response = await prisma.response.findUnique({
    where: { id },
    include: {
      form: { select: { title: true } },
      agent: { select: { name: true } },
      evaluator: { select: { name: true } },
      answers: {
        include: {
          question: { select: { label: true, type: true, options: true } },
        },
      },
    },
  });

  if (!response) throw new Error("Evaluación no encontrada");

  return {
    ...response,
    score: Number(response.score),
  };
}

export async function submitResponse(data: {
  formId: string;
  agentId: string;
  answers: { questionId: string; value: string }[];
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  // Get form questions to calculate score
  const form = await prisma.form.findUnique({
    where: { id: data.formId },
    include: { questions: true },
  });

  if (!form) throw new Error("Formulario no encontrado");

  // Calculate score from RATING questions
  const ratingQuestions = form.questions.filter((q) => q.type === "RATING");
  let score = 0;

  if (ratingQuestions.length > 0) {
    const ratingAnswers = data.answers.filter((a) =>
      ratingQuestions.some((q) => q.id === a.questionId),
    );
    const totalValue = ratingAnswers.reduce(
      (sum, a) => sum + (Number(a.value) || 0),
      0,
    );
    const maxPossible = ratingQuestions.length * 5;
    score = (totalValue / maxPossible) * 100;
  }

  const response = await prisma.$transaction(async (tx) => {
    const newResponse = await tx.response.create({
      data: {
        formId: data.formId,
        agentId: data.agentId,
        evaluatorId: session.user.id,
        score,
        answers: {
          create: data.answers.map((a) => ({
            questionId: a.questionId,
            value: a.value,
          })),
        },
      },
    });

    return newResponse;
  });

  revalidatePath("/forms");
  revalidatePath("/reports");
  return { ...response, score: Number(response.score) };
}
