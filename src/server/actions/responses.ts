"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getPassThresholdForCampaign } from "@/lib/settings";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
} from "@/server/queries/campaign-filter";
import type { QuestionType } from "@prisma/client";
import { z } from "zod";

const MAX_ANSWERS_PER_SUBMISSION = 500;
const MAX_ANSWER_LENGTH = 10_000;

const submitResponseSchema = z
  .object({
    formId: z.string().trim().min(1),
    agentId: z.string().trim().min(1),
    dispositionId: z.string().trim().min(1),
    answers: z
      .array(
        z
          .object({
            questionId: z.string().trim().min(1),
            value: z
              .string()
              .max(MAX_ANSWER_LENGTH)
              .transform((value) => value.trim()),
            comment: z
              .string()
              .max(MAX_ANSWER_LENGTH)
              .optional()
              .transform((value) => value?.trim() ?? ""),
          })
          .strict(),
      )
      .max(MAX_ANSWERS_PER_SUBMISSION),
  })
  .strict();

type SubmitResponseInput = z.infer<typeof submitResponseSchema>;

export async function getResponses(formId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission("canViewReports");

  const where = {
    ...(formId ? { formId } : {}),
    form: campaignFilter,
  };

  const responses = await prisma.response.findMany({
    where,
    include: {
      form: { select: { title: true, campaignId: true } },
      agent: { select: { name: true } },
      evaluator: { select: { name: true } },
      disposition: { select: { id: true, name: true, code: true } },
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
      form: { select: { title: true, campaignId: true } },
      agent: { select: { name: true } },
      evaluator: { select: { name: true } },
      disposition: { select: { id: true, name: true, code: true } },
      answers: {
        include: {
          question: {
            select: {
              label: true,
              type: true,
              options: true,
              weight: true,
              fatal: true,
              fatalOptions: true,
              requiresCommentOnFail: true,
              formCategory: {
                select: {
                  qaCategory: { select: { id: true, name: true } },
                },
              },
            },
          },
          category: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!response) throw new Error("Evaluación no encontrada");

  await assertCampaignPermissionForUser(session.user, response.form.campaignId, "canViewReports");

  return {
    ...response,
    score: Number(response.score),
  };
}

function parseSubmitResponseInput(data: unknown): SubmitResponseInput {
  const result = submitResponseSchema.safeParse(data);
  if (!result.success) {
    throw new Error("Datos de evaluacion invalidos");
  }

  return result.data;
}

function getQuestionOptions(options: unknown) {
  return Array.isArray(options)
    ? options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter(Boolean)
    : [];
}

function validateAnswerValue(
  question: { type: QuestionType; options: unknown; required: boolean },
  value: string,
) {
  if (question.required && !value) {
    throw new Error("Hay preguntas requeridas sin responder");
  }

  if (!value) return;

  switch (question.type) {
    case "TEXT":
      return;
    case "RATING": {
      const numericValue = Number(value);
      if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 5) {
        throw new Error("Respuesta de rating fuera de rango");
      }
      return;
    }
    case "SELECT":
    case "RADIO": {
      const options = getQuestionOptions(question.options);
      if (!options.includes(value)) {
        throw new Error("Respuesta no pertenece a las opciones del formulario");
      }
      return;
    }
  }
}

function getRatingScore(value: string) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 5) {
    return null;
  }
  return (numericValue / 5) * 100;
}

function isFailedAnswer(question: { type: QuestionType; fatalOptions?: unknown }, value: string) {
  if (!value) return false;
  if (question.type === "SELECT" || question.type === "RADIO") {
    return getQuestionOptions(question.fatalOptions).includes(value);
  }
  if (question.type !== "RATING") return false;
  const ratingScore = getRatingScore(value);
  return ratingScore !== null && ratingScore < 100;
}

function calculateResponseScore(
  ratingQuestions: { id: string; weight: number }[],
  answersByQuestionId: Map<string, string>,
) {
  if (ratingQuestions.length === 0) return 0;

  const totalWeight = ratingQuestions.reduce((sum, question) => sum + question.weight, 0);

  if (totalWeight > 0) {
    return ratingQuestions.reduce((sum, question) => {
      const ratingScore = getRatingScore(answersByQuestionId.get(question.id) ?? "") ?? 0;
      return sum + ratingScore * (question.weight / totalWeight);
    }, 0);
  }

  const totalValue = ratingQuestions.reduce(
    (sum, question) => sum + (Number(answersByQuestionId.get(question.id)) || 0),
    0,
  );
  const maxPossible = ratingQuestions.length * 5;
  return (totalValue / maxPossible) * 100;
}

export async function submitResponse(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  const input = parseSubmitResponseInput(data);

  const form = await prisma.form.findUnique({
    where: { id: input.formId },
    include: {
      questions: {
        orderBy: { order: "asc" },
        include: {
          formCategory: {
            select: {
              qaCategoryId: true,
            },
          },
        },
      },
    },
  });

  if (!form) throw new Error("Formulario no encontrado");
  await assertCampaignPermissionForUser(session.user, form.campaignId, "canEvaluate");

  if (input.answers.length > form.questions.length) {
    throw new Error("La evaluacion contiene respuestas no validas");
  }

  const [agent, disposition] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { campaignId: true, active: true },
    }),
    prisma.disposition.findUnique({
      where: { id: input.dispositionId },
      select: { campaignId: true, active: true },
    }),
  ]);

  if (!agent?.active || agent.campaignId !== form.campaignId) {
    throw new Error("Agente invalido para esta campana");
  }

  if (!disposition?.active || disposition.campaignId !== form.campaignId) {
    throw new Error("Disposicion invalida para esta campana");
  }

  const questionsById = new Map(form.questions.map((question) => [question.id, question]));
  const seenQuestionIds = new Set<string>();
  const sanitizedAnswers = input.answers.map((answer) => {
    const question = questionsById.get(answer.questionId);
    if (!question) {
      throw new Error("Respuesta no pertenece al formulario");
    }
    if (seenQuestionIds.has(answer.questionId)) {
      throw new Error("Respuesta duplicada para una pregunta");
    }

    validateAnswerValue(question, answer.value);
    seenQuestionIds.add(answer.questionId);

    if (
      question.requiresCommentOnFail &&
      isFailedAnswer(question, answer.value) &&
      !answer.comment
    ) {
      throw new Error("Hay preguntas que requieren comentario al fallar");
    }

    const ratingScore = question.type === "RATING" ? getRatingScore(answer.value) : null;
    const isFatalFail = question.fatal && isFailedAnswer(question, answer.value);

    return {
      questionId: answer.questionId,
      value: answer.value,
      comment: answer.comment || undefined,
      categoryId: question.formCategory?.qaCategoryId ?? undefined,
      score: ratingScore ?? undefined,
      isFatalFail,
    };
  });

  for (const question of form.questions) {
    const answer = sanitizedAnswers.find((item) => item.questionId === question.id);
    validateAnswerValue(question, answer?.value ?? "");
  }

  const ratingQuestions = form.questions.filter((q) => q.type === "RATING");
  const answersByQuestionId = new Map(
    sanitizedAnswers.map((answer) => [answer.questionId, answer.value]),
  );
  const score = calculateResponseScore(ratingQuestions, answersByQuestionId);
  const hasFatalFail = sanitizedAnswers.some((answer) => answer.isFatalFail);
  const passThreshold = await getPassThresholdForCampaign(form.campaignId);
  const result = hasFatalFail || score < passThreshold ? "FAIL" : "PASS";

  const response = await prisma.$transaction(async (tx) => {
    const newResponse = await tx.response.create({
      data: {
        formId: input.formId,
        agentId: input.agentId,
        evaluatorId: session.user.id,
        dispositionId: input.dispositionId,
        score,
        formVersion: form.version,
        result,
        hasFatalFail,
        answers: {
          create: sanitizedAnswers.map((a) => ({
            questionId: a.questionId,
            value: a.value,
            categoryId: a.categoryId,
            score: a.score,
            comment: a.comment,
            isFatalFail: a.isFatalFail,
          })),
        },
      },
    });

    return newResponse;
  });

  await writeAuditLog({
    userId: session.user.id,
    campaignId: form.campaignId,
    module: "evaluations",
    action: "created",
    entityType: "response",
    entityId: response.id,
    afterValue: {
      id: response.id,
      formId: input.formId,
      agentId: input.agentId,
      dispositionId: input.dispositionId,
      score,
      result,
      hasFatalFail,
      answerCount: sanitizedAnswers.length,
      fatalAnswerCount: sanitizedAnswers.filter((answer) => answer.isFatalFail).length,
    },
    impact: "Nueva evaluacion incluida en Dashboard, KPIs, reportes y exportaciones.",
  });

  revalidatePath("/forms");
  revalidatePath("/reports");
  revalidatePath("/kpis");
  revalidatePath("/analytics/responses");
  revalidatePath("/");
  return { ...response, score: Number(response.score) };
}
