"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RESPONSE_STATUS, submittedResponseWhere } from "@/lib/response-status";
import type { ResponseStatus } from "@/lib/response-status";
import { getCampaignScoringSettings } from "@/lib/settings";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
} from "@/server/queries/campaign-filter";
import type { Prisma, QuestionType } from "@prisma/client";
import type { Session } from "next-auth";
import { z } from "zod";

const MAX_ANSWERS_PER_SUBMISSION = 500;
const MAX_ANSWER_LENGTH = 10_000;

const responseAnswerSchema = z
  .object({
    questionId: z.string().trim().min(1),
    value: z
      .string()
      .max(MAX_ANSWER_LENGTH)
      .optional()
      .transform((value) => value?.trim() ?? ""),
    comment: z
      .string()
      .max(MAX_ANSWER_LENGTH)
      .optional()
      .transform((value) => value?.trim() ?? ""),
    notApplicable: z.boolean().optional().default(false),
  })
  .strict();

const responseMutationSchema = z
  .object({
    responseId: z.string().trim().min(1).optional(),
    formId: z.string().trim().min(1),
    agentId: z.string().trim().min(1),
    dispositionId: z.string().trim().min(1),
    answers: z.array(responseAnswerSchema).max(MAX_ANSWERS_PER_SUBMISSION),
  })
  .strict();

const cancelResponseSchema = z
  .object({
    id: z.string().trim().min(1),
    reason: z.string().trim().min(3, "La razon de anulacion es requerida").max(1000),
  })
  .strict();

type ResponseMutationInput = z.infer<typeof responseMutationSchema>;
type ResponseAnswerInput = z.infer<typeof responseAnswerSchema>;

type ResponseQuestion = {
  id: string;
  type: QuestionType;
  label: string;
  options: unknown;
  required: boolean;
  weight: number;
  fatal: boolean;
  fatalOptions: unknown;
  requiresCommentOnFail: boolean;
  order: number;
  formCategory?: {
    qaCategoryId: string | null;
    qaCategory?: {
      id: string;
      name: string;
      systemColor: string | null;
      systemIcon: string | null;
    } | null;
  } | null;
};

type SanitizedAnswer = {
  questionId: string;
  value: string;
  comment?: string;
  categoryId?: string;
  score?: number;
  isFatalFail: boolean;
  notApplicable: boolean;
};

type ExistingResponseForMutation = {
  id: string;
  formId: string;
  agentId: string;
  evaluatorId: string;
  dispositionId: string | null;
  score: Prisma.Decimal;
  result: string | null;
  hasFatalFail: boolean;
  status: string;
  createdAt: Date;
  submittedAt: Date | null;
  cancellationReason: string | null;
  form: { campaignId: string };
  answers: {
    questionId: string;
    value: string;
    score: Prisma.Decimal | null;
    comment: string | null;
    isFatalFail: boolean;
    notApplicable: boolean;
  }[];
};

export async function getResponses(formId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission("canViewReports");

  const where = {
    ...(formId ? { formId } : {}),
    ...submittedResponseWhere(),
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
      form: { select: { id: true, title: true, campaignId: true } },
      agent: { select: { id: true, name: true } },
      evaluator: { select: { id: true, name: true } },
      disposition: { select: { id: true, name: true, code: true } },
      answers: {
        include: {
          question: {
            select: {
              id: true,
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
        orderBy: { question: { order: "asc" } },
      },
    },
  });

  if (!response) throw new Error("Evaluacion no encontrada");

  await assertCampaignPermissionForUser(session.user, response.form.campaignId, "canViewReports");

  return {
    ...response,
    score: Number(response.score),
    answers: response.answers.map((answer) => ({
      ...answer,
      score: answer.score === null ? null : Number(answer.score),
    })),
  };
}

function parseResponseMutationInput(data: unknown): ResponseMutationInput {
  const result = responseMutationSchema.safeParse(data);
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
  answer: Pick<ResponseAnswerInput, "value" | "notApplicable"> | undefined,
  options: { requireComplete: boolean },
) {
  if (answer?.notApplicable) return;
  const value = answer?.value ?? "";

  if (options.requireComplete && question.required && !value) {
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
      const questionOptions = getQuestionOptions(question.options);
      if (!questionOptions.includes(value)) {
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

function sanitizeAnswers(
  questions: ResponseQuestion[],
  inputAnswers: ResponseAnswerInput[],
  options: { requireComplete: boolean },
) {
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const answersByQuestionId = new Map<string, ResponseAnswerInput>();
  const sanitizedAnswers: SanitizedAnswer[] = [];

  for (const inputAnswer of inputAnswers) {
    const question = questionsById.get(inputAnswer.questionId);
    if (!question) {
      throw new Error("Respuesta no pertenece al formulario");
    }
    if (answersByQuestionId.has(inputAnswer.questionId)) {
      throw new Error("Respuesta duplicada para una pregunta");
    }

    const answer = {
      ...inputAnswer,
      value: inputAnswer.notApplicable ? "" : inputAnswer.value,
      comment: inputAnswer.comment,
    };

    validateAnswerValue(question, answer, options);
    answersByQuestionId.set(inputAnswer.questionId, answer);

    if (
      options.requireComplete &&
      question.requiresCommentOnFail &&
      !answer.notApplicable &&
      isFailedAnswer(question, answer.value) &&
      !answer.comment
    ) {
      throw new Error("Hay preguntas que requieren comentario al fallar");
    }

    const ratingScore =
      !answer.notApplicable && question.type === "RATING" ? getRatingScore(answer.value) : null;
    const isFatalFail =
      !answer.notApplicable && question.fatal && isFailedAnswer(question, answer.value);

    sanitizedAnswers.push({
      questionId: answer.questionId,
      value: answer.value,
      comment: answer.comment || undefined,
      categoryId: question.formCategory?.qaCategoryId ?? undefined,
      score: ratingScore ?? undefined,
      isFatalFail,
      notApplicable: answer.notApplicable,
    });
  }

  if (options.requireComplete) {
    for (const question of questions) {
      validateAnswerValue(question, answersByQuestionId.get(question.id), options);
    }
  }

  return sanitizedAnswers;
}

function calculateResponseScore(
  ratingQuestions: { id: string; weight: number }[],
  answersByQuestionId: Map<string, Pick<SanitizedAnswer, "value" | "notApplicable">>,
) {
  const applicableRatingQuestions = ratingQuestions.filter(
    (question) => !answersByQuestionId.get(question.id)?.notApplicable,
  );

  if (applicableRatingQuestions.length === 0) return 0;

  const totalWeight = applicableRatingQuestions.reduce((sum, question) => sum + question.weight, 0);

  if (totalWeight > 0) {
    return applicableRatingQuestions.reduce((sum, question) => {
      const ratingScore = getRatingScore(answersByQuestionId.get(question.id)?.value ?? "") ?? 0;
      return sum + ratingScore * (question.weight / totalWeight);
    }, 0);
  }

  const totalValue = applicableRatingQuestions.reduce(
    (sum, question) => sum + (Number(answersByQuestionId.get(question.id)?.value) || 0),
    0,
  );
  const maxPossible = applicableRatingQuestions.length * 5;
  return (totalValue / maxPossible) * 100;
}

function buildFormSnapshot(form: {
  id: string;
  title: string;
  description: string | null;
  version: string;
  status: string;
  campaignId: string;
  campaign?: { name: string } | null;
  questions: ResponseQuestion[];
}) {
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    version: form.version,
    status: form.status,
    campaignId: form.campaignId,
    campaignName: form.campaign?.name ?? null,
    questions: form.questions.map((question) => ({
      id: question.id,
      order: question.order,
      label: question.label,
      type: question.type,
      options: question.options,
      required: question.required,
      weight: question.weight,
      fatal: question.fatal,
      fatalOptions: question.fatalOptions,
      requiresCommentOnFail: question.requiresCommentOnFail,
      qaCategory: question.formCategory?.qaCategory
        ? {
            id: question.formCategory.qaCategory.id,
            name: question.formCategory.qaCategory.name,
            color: question.formCategory.qaCategory.systemColor,
            icon: question.formCategory.qaCategory.systemIcon,
          }
        : null,
    })),
  };
}

function buildScoringSnapshot(args: {
  status: ResponseStatus;
  score: number;
  result: string | null;
  hasFatalFail: boolean;
  passThreshold: number;
  sanitizedAnswers: SanitizedAnswer[];
  ratingQuestions: { id: string; weight: number }[];
}) {
  const notApplicableQuestionIds = args.sanitizedAnswers
    .filter((answer) => answer.notApplicable)
    .map((answer) => answer.questionId);
  const applicableRatingQuestionIds = args.ratingQuestions
    .filter((question) => !notApplicableQuestionIds.includes(question.id))
    .map((question) => question.id);

  return {
    status: args.status,
    score: args.score,
    result: args.result,
    hasFatalFail: args.hasFatalFail,
    passThreshold: args.passThreshold,
    scoringMethod: "weighted_rating",
    naHandling: "exclude_from_rating_denominator",
    applicableRatingQuestionIds,
    notApplicableQuestionIds,
    capturedAt: new Date().toISOString(),
  };
}

function answerAuditValue(answers: SanitizedAnswer[]) {
  return answers.map((answer) => ({
    questionId: answer.questionId,
    value: answer.notApplicable ? "N/A" : answer.value,
    score: answer.score ?? null,
    comment: answer.comment ?? null,
    isFatalFail: answer.isFatalFail,
    notApplicable: answer.notApplicable,
  }));
}

function existingResponseAuditValue(response: ExistingResponseForMutation) {
  return {
    id: response.id,
    formId: response.formId,
    agentId: response.agentId,
    dispositionId: response.dispositionId,
    evaluatorId: response.evaluatorId,
    score: Number(response.score),
    result: response.result,
    hasFatalFail: response.hasFatalFail,
    status: response.status,
    submittedAt: response.submittedAt?.toISOString() ?? null,
    cancellationReason: response.cancellationReason,
    answers: response.answers.map((answer) => ({
      questionId: answer.questionId,
      value: answer.notApplicable ? "N/A" : answer.value,
      score: answer.score === null ? null : Number(answer.score),
      comment: answer.comment,
      isFatalFail: answer.isFatalFail,
      notApplicable: answer.notApplicable,
    })),
  };
}

async function loadExistingResponse(responseId?: string) {
  if (!responseId) return null;

  return prisma.response.findUnique({
    where: { id: responseId },
    include: {
      form: { select: { campaignId: true } },
      answers: {
        select: {
          questionId: true,
          value: true,
          score: true,
          comment: true,
          isFatalFail: true,
          notApplicable: true,
        },
      },
    },
  }) as Promise<ExistingResponseForMutation | null>;
}

async function assertMutationPermission(args: {
  user: Session["user"];
  campaignId: string;
  mode: typeof RESPONSE_STATUS.DRAFT | typeof RESPONSE_STATUS.SUBMITTED;
  existing: ExistingResponseForMutation | null;
}) {
  const { user, campaignId, mode, existing } = args;

  if (!existing) {
    await assertCampaignPermissionForUser(user, campaignId, "canEvaluate");
    return;
  }

  if (existing.status === RESPONSE_STATUS.CANCELLED) {
    throw new Error("No se puede modificar una evaluacion anulada");
  }

  if (existing.form.campaignId !== campaignId) {
    throw new Error("Evaluacion no pertenece al formulario indicado");
  }

  if (mode === RESPONSE_STATUS.DRAFT && existing.status !== RESPONSE_STATUS.DRAFT) {
    throw new Error("Solo se pueden guardar borradores sobre evaluaciones en borrador");
  }

  if (existing.status === RESPONSE_STATUS.SUBMITTED) {
    await assertCampaignPermissionForUser(user, campaignId, "canEditEvaluations");
    return;
  }

  if (existing.evaluatorId === user.id) {
    await assertCampaignPermissionForUser(user, campaignId, "canEvaluate");
    return;
  }

  await assertCampaignPermissionForUser(user, campaignId, "canEditEvaluations");
}

async function saveEvaluation(
  data: unknown,
  status: typeof RESPONSE_STATUS.DRAFT | typeof RESPONSE_STATUS.SUBMITTED,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  const input = parseResponseMutationInput(data);

  const [form, existing] = await Promise.all([
    prisma.form.findUnique({
      where: { id: input.formId },
      include: {
        campaign: { select: { name: true } },
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
                    systemColor: true,
                    systemIcon: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    loadExistingResponse(input.responseId),
  ]);

  if (!form) throw new Error("Formulario no encontrado");
  if (existing && existing.formId !== input.formId) {
    throw new Error("Evaluacion no pertenece al formulario indicado");
  }

  await assertMutationPermission({
    user: session.user,
    campaignId: form.campaignId,
    mode: status,
    existing,
  });

  if (input.answers.length > form.questions.length) {
    throw new Error("La evaluacion contiene respuestas no validas");
  }

  const [agent, disposition, scoringSettings] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { campaignId: true, active: true },
    }),
    prisma.disposition.findUnique({
      where: { id: input.dispositionId },
      select: { campaignId: true, active: true },
    }),
    getCampaignScoringSettings(form.campaignId),
  ]);

  if (!agent?.active || agent.campaignId !== form.campaignId) {
    throw new Error("Agente invalido para esta campana");
  }

  if (!disposition?.active || disposition.campaignId !== form.campaignId) {
    throw new Error("Disposicion invalida para esta campana");
  }

  const sanitizedAnswers = sanitizeAnswers(form.questions, input.answers, {
    requireComplete: status === RESPONSE_STATUS.SUBMITTED,
  });

  const ratingQuestions = form.questions.filter((question) => question.type === "RATING");
  const answersByQuestionId = new Map(
    sanitizedAnswers.map((answer) => [
      answer.questionId,
      { value: answer.value, notApplicable: answer.notApplicable },
    ]),
  );
  const score = calculateResponseScore(ratingQuestions, answersByQuestionId);
  const hasFatalFail = sanitizedAnswers.some((answer) => answer.isFatalFail);
  const result =
    status === RESPONSE_STATUS.SUBMITTED
      ? hasFatalFail || score < scoringSettings.passThreshold
        ? "FAIL"
        : "PASS"
      : null;

  const formSnapshot = buildFormSnapshot(form);
  const scoringSnapshot = buildScoringSnapshot({
    status,
    score,
    result,
    hasFatalFail,
    passThreshold: scoringSettings.passThreshold,
    sanitizedAnswers,
    ratingQuestions,
  });
  const settingsSnapshot = {
    ...scoringSettings,
    capturedAt: new Date().toISOString(),
  };

  const response = await prisma.$transaction(async (tx) => {
    const responseData = {
      formId: input.formId,
      agentId: input.agentId,
      evaluatorId: existing?.evaluatorId ?? session.user.id,
      dispositionId: input.dispositionId,
      score,
      formVersion: form.version,
      result,
      hasFatalFail,
      status,
      submittedAt:
        status === RESPONSE_STATUS.SUBMITTED
          ? existing?.status === RESPONSE_STATUS.SUBMITTED
            ? (existing.submittedAt ?? existing.createdAt)
            : new Date()
          : null,
      scoringSnapshot: scoringSnapshot as Prisma.InputJsonValue,
      settingsSnapshot: settingsSnapshot as Prisma.InputJsonValue,
      formSnapshot: formSnapshot as Prisma.InputJsonValue,
    };
    const answerCreateData = sanitizedAnswers.map((answer) => ({
      questionId: answer.questionId,
      value: answer.value,
      categoryId: answer.categoryId,
      score: answer.score,
      comment: answer.comment,
      isFatalFail: answer.isFatalFail,
      notApplicable: answer.notApplicable,
    }));

    if (existing) {
      return tx.response.update({
        where: { id: existing.id },
        data: {
          ...responseData,
          answers: {
            deleteMany: {},
            create: answerCreateData,
          },
        },
      });
    }

    return tx.response.create({
      data: {
        ...responseData,
        answers: {
          create: answerCreateData,
        },
      },
    });
  });

  const isNew = !existing;
  const action =
    status === RESPONSE_STATUS.DRAFT
      ? isNew
        ? "draft_created"
        : null
      : existing?.status === RESPONSE_STATUS.SUBMITTED
        ? "updated"
        : existing?.status === RESPONSE_STATUS.DRAFT
          ? "submitted"
          : "created";

  if (action) {
    await writeAuditLog({
      userId: session.user.id,
      campaignId: form.campaignId,
      module: "evaluations",
      action,
      entityType: "response",
      entityId: response.id,
      beforeValue: existing ? existingResponseAuditValue(existing) : null,
      afterValue: {
        id: response.id,
        formId: input.formId,
        agentId: input.agentId,
        dispositionId: input.dispositionId,
        score,
        result,
        hasFatalFail,
        status,
        answerCount: sanitizedAnswers.length,
        fatalAnswerCount: sanitizedAnswers.filter((answer) => answer.isFatalFail).length,
        notApplicableCount: sanitizedAnswers.filter((answer) => answer.notApplicable).length,
        answers: answerAuditValue(sanitizedAnswers),
      },
      impact:
        status === RESPONSE_STATUS.DRAFT
          ? "Borrador guardado; no impacta Dashboard, KPIs, reportes ni exportaciones."
          : "Evaluacion incluida o actualizada en Dashboard, KPIs, reportes y exportaciones.",
    });
  }

  revalidateEvaluationPaths();
  return { ...response, score: Number(response.score) };
}

export async function saveResponseDraft(data: unknown) {
  return saveEvaluation(data, RESPONSE_STATUS.DRAFT);
}

export async function submitResponse(data: unknown) {
  return saveEvaluation(data, RESPONSE_STATUS.SUBMITTED);
}

export async function cancelResponse(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const input = cancelResponseSchema.parse(data);
  const existing = await loadExistingResponse(input.id);
  if (!existing) throw new Error("Evaluacion no encontrada");
  if (existing.status === RESPONSE_STATUS.CANCELLED) {
    throw new Error("La evaluacion ya esta anulada");
  }

  await assertCampaignPermissionForUser(
    session.user,
    existing.form.campaignId,
    "canEditEvaluations",
  );

  const cancelledAt = new Date();
  const response = await prisma.response.update({
    where: { id: existing.id },
    data: {
      status: RESPONSE_STATUS.CANCELLED,
      cancelledAt,
      cancelledById: session.user.id,
      cancellationReason: input.reason,
    },
  });

  await writeAuditLog({
    userId: session.user.id,
    campaignId: existing.form.campaignId,
    module: "evaluations",
    action: "cancelled",
    entityType: "response",
    entityId: existing.id,
    beforeValue: existingResponseAuditValue(existing),
    afterValue: {
      id: existing.id,
      status: RESPONSE_STATUS.CANCELLED,
      cancelledAt: cancelledAt.toISOString(),
      cancelledById: session.user.id,
      cancellationReason: input.reason,
    },
    impact: "Evaluacion anulada y excluida de Dashboard, KPIs, reportes y exportaciones.",
  });

  revalidateEvaluationPaths();
  return { ...response, score: Number(response.score) };
}

function revalidateEvaluationPaths() {
  revalidatePath("/forms");
  revalidatePath("/reports");
  revalidatePath("/kpis");
  revalidatePath("/analytics/responses");
  revalidatePath("/analytics/agents");
  revalidatePath("/analytics/dispositions");
  revalidatePath("/");
}
