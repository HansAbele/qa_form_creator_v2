"use server";

import type { Prisma, QuestionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveResponseScoringPolicy } from "@/lib/response-scoring-policy";
import type { ResponseStatus } from "@/lib/response-status";
import { RESPONSE_STATUS, submittedResponseWhere } from "@/lib/response-status";
import { computeScore, type ScoringQuestion, type WeightedOption } from "@/lib/scoring";
import { getCampaignScoringSettings } from "@/lib/settings";
import { writeAuditLog } from "@/server/audit-log";
import { emitNotification } from "@/server/notifications";
import {
  getCampaignFilterForPermission,
  hasCampaignPermissionForUser,
} from "@/server/queries/campaign-filter";

const MAX_ANSWERS_PER_SUBMISSION = 500;
const MAX_ANSWER_LENGTH = 10_000;
const CONCURRENT_RESPONSE_CHANGE_ERROR =
  "La evaluacion fue modificada por otra sesion. Recarga la pagina e intenta nuevamente";
const RESPONSE_UNAVAILABLE_MESSAGE = "Evaluacion no disponible";
const FORM_UNAVAILABLE_MESSAGE = "Formulario no disponible";

type ResponseActionErrorCode = "CONFLICT" | "VALIDATION" | "NOT_FOUND" | "INVALID_STATE";

class ExpectedResponseActionError extends Error {
  constructor(
    readonly code: ResponseActionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExpectedResponseActionError";
  }
}

function failResponseAction(code: ResponseActionErrorCode, message: string): never {
  throw new ExpectedResponseActionError(code, message);
}

function failResponseUnavailable(): never {
  failResponseAction("NOT_FOUND", RESPONSE_UNAVAILABLE_MESSAGE);
}

function failFormUnavailable(): never {
  failResponseAction("NOT_FOUND", FORM_UNAVAILABLE_MESSAGE);
}

type ResponseActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ResponseActionErrorCode; message: string } };

async function toResponseActionResult<T>(
  operation: () => Promise<T>,
): Promise<ResponseActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof ExpectedResponseActionError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        error: { code: "VALIDATION", message: "Datos de evaluacion invalidos" },
      };
    }
    throw error;
  }
}

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
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
    clientResponseId: z.string().uuid().optional(),
    formId: z.string().trim().min(1),
    agentId: z.string().trim().min(1),
    dispositionId: z.string().trim().min(1).nullable(),
    answers: z.array(responseAnswerSchema).max(MAX_ANSWERS_PER_SUBMISSION),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.responseId && !input.expectedUpdatedAt) {
      context.addIssue({
        code: "custom",
        path: ["expectedUpdatedAt"],
        message: "expectedUpdatedAt es requerido al actualizar una evaluacion",
      });
    }
    if (!input.responseId && !input.clientResponseId) {
      context.addIssue({
        code: "custom",
        path: ["clientResponseId"],
        message: "clientResponseId es requerido al crear una evaluacion",
      });
    }
  });

const cancelResponseSchema = z
  .object({
    id: z.string().trim().min(1),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
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
  ratingFailThreshold: number | null;
  ratingMax: number | null;
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
  formVersion: string | null;
  scoringSnapshot: Prisma.JsonValue | null;
  settingsSnapshot: Prisma.JsonValue | null;
  formSnapshot: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
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
    question: { formId: string };
  }[];
};

type ResponseLookupMode = "READ_OR_MUTATE" | "CANCEL" | "CREATE_REPLAY";

type EvaluationPermission = "canEvaluate" | "canEditEvaluations";

function formPermissionScope(
  user: Session["user"],
  permission: EvaluationPermission,
): Prisma.FormWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "SUPERVISOR") return { id: { in: [] } };

  return {
    campaignId: { in: user.campaignIds },
    campaign: {
      users: {
        some: {
          userId: user.id,
          ...(permission === "canEvaluate" ? { canEvaluate: true } : { canEditEvaluations: true }),
        },
      },
    },
  };
}

function responsePermissionScope(
  user: Session["user"],
  mode: ResponseLookupMode,
): Prisma.ResponseWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "SUPERVISOR") return { id: { in: [] } };

  if (mode === "CANCEL") {
    return { form: formPermissionScope(user, "canEditEvaluations") };
  }
  if (mode === "CREATE_REPLAY") {
    return {
      evaluatorId: user.id,
      form: formPermissionScope(user, "canEvaluate"),
    };
  }

  return {
    OR: [
      {
        status: RESPONSE_STATUS.DRAFT,
        evaluatorId: user.id,
        form: formPermissionScope(user, "canEvaluate"),
      },
      {
        NOT: { status: RESPONSE_STATUS.DRAFT, evaluatorId: user.id },
        form: formPermissionScope(user, "canEditEvaluations"),
      },
    ],
  };
}

async function assertResponsePermissionOrUnavailable(
  user: Session["user"],
  response: Pick<ExistingResponseForMutation, "evaluatorId" | "status" | "form">,
  mode: ResponseLookupMode,
) {
  if (mode === "CREATE_REPLAY" && response.evaluatorId !== user.id) {
    failResponseUnavailable();
  }

  const permission =
    mode === "CANCEL"
      ? "canEditEvaluations"
      : mode === "CREATE_REPLAY" ||
          (response.status === RESPONSE_STATUS.DRAFT && response.evaluatorId === user.id)
        ? "canEvaluate"
        : "canEditEvaluations";
  const allowed = await hasCampaignPermissionForUser(user, response.form.campaignId, permission);
  if (!allowed) failResponseUnavailable();
}

function hasMutationResponseIntegrity(response: ExistingResponseForMutation) {
  return response.answers.every((answer) => answer.question.formId === response.formId);
}

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isPrismaRecordConflict(error: unknown) {
  return isPrismaErrorCode(error, "P2025");
}

function isPrismaUniqueConflict(error: unknown) {
  return isPrismaErrorCode(error, "P2002");
}

type ResponseMutationRecord = {
  id: string;
  updatedAt: Date;
  status: string;
  score: Prisma.Decimal | number;
};

function normalizeResponseMutationResult(response: ResponseMutationRecord, replayed: boolean) {
  return {
    id: response.id,
    updatedAt: response.updatedAt.toISOString(),
    status: response.status,
    score: Number(response.score),
    replayed,
  };
}

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
      agent: { select: { name: true, campaignId: true } },
      evaluator: { select: { name: true } },
      disposition: { select: { id: true, name: true, code: true, campaignId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return responses
    .filter(
      (response) =>
        response.agent.campaignId === response.form.campaignId &&
        (!response.disposition || response.disposition.campaignId === response.form.campaignId),
    )
    .map((response) => ({
      ...response,
      score: Number(response.score),
    }));
}

export async function getResponseById(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const response = await prisma.response.findUnique({
    where: {
      id,
      AND: [responsePermissionScope(session.user, "READ_OR_MUTATE")],
    },
    include: {
      form: { select: { id: true, title: true, campaignId: true } },
      agent: { select: { id: true, name: true, agentCode: true, campaignId: true } },
      evaluator: { select: { id: true, name: true } },
      disposition: { select: { id: true, name: true, code: true, campaignId: true } },
      answers: {
        include: {
          question: {
            select: {
              id: true,
              formId: true,
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

  if (!response) failResponseUnavailable();

  await assertResponsePermissionOrUnavailable(session.user, response, "READ_OR_MUTATE");

  if (
    response.agent.campaignId !== response.form.campaignId ||
    (response.disposition && response.disposition.campaignId !== response.form.campaignId) ||
    response.answers.some((answer) => answer.question.formId !== response.form.id)
  ) {
    failResponseUnavailable();
  }
  if (response.status === RESPONSE_STATUS.CANCELLED) {
    throw new Error("No se puede editar una evaluacion anulada");
  }

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
    failResponseAction("VALIDATION", "Datos de evaluacion invalidos");
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

/** Accepts either plain string options or weighted `{value, points}` options. */
function getOptionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => {
      if (typeof o === "string") return o;
      if (o && typeof o === "object" && "value" in o)
        return String((o as { value: unknown }).value);
      return "";
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extracts weighted options `{value, points}` if configured, else null. */
function getWeightedOptions(options: unknown): WeightedOption[] | null {
  if (!Array.isArray(options)) return null;
  const weighted = options.filter(
    (o): o is { value: unknown; points: unknown } =>
      Boolean(o) && typeof o === "object" && "value" in o && "points" in o,
  );
  if (weighted.length === 0) return null;
  return weighted.map((o) => ({ value: String(o.value), points: Number(o.points) || 0 }));
}

function toScoringQuestion(question: ResponseQuestion): ScoringQuestion {
  return {
    id: question.id,
    type: question.type,
    weight: question.weight,
    fatal: question.fatal,
    fatalOptions: getQuestionOptions(question.fatalOptions),
    requiresCommentOnFail: question.requiresCommentOnFail,
    categoryId: question.formCategory?.qaCategoryId ?? null,
    ratingFailThreshold: question.ratingFailThreshold ?? null,
    ratingMax: question.ratingMax ?? null,
    weightedOptions: getWeightedOptions(question.options),
  };
}

function validateAnswerValue(
  question: { type: QuestionType; options: unknown; required: boolean; ratingMax?: number | null },
  answer: Pick<ResponseAnswerInput, "value" | "notApplicable"> | undefined,
  options: { requireComplete: boolean },
) {
  if (answer?.notApplicable) return;
  const value = answer?.value ?? "";

  if (options.requireComplete && question.required && !value) {
    failResponseAction("VALIDATION", "Hay preguntas requeridas sin responder");
  }

  if (!value) return;

  switch (question.type) {
    case "TEXT":
      return;
    case "RATING": {
      const max = question.ratingMax && question.ratingMax > 0 ? question.ratingMax : 5;
      const numericValue = Number(value);
      if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > max) {
        failResponseAction("VALIDATION", "Respuesta de rating fuera de rango");
      }
      return;
    }
    case "SELECT":
    case "RADIO":
    case "BOOLEAN": {
      const questionOptions = getOptionValues(question.options);
      if (questionOptions.length > 0 && !questionOptions.includes(value)) {
        failResponseAction("VALIDATION", "Respuesta no pertenece a las opciones del formulario");
      }
      return;
    }
  }
}

function sanitizeAnswers(
  questions: ResponseQuestion[],
  inputAnswers: ResponseAnswerInput[],
  options: { requireComplete: boolean },
): SanitizedAnswer[] {
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const answersByQuestionId = new Map<string, ResponseAnswerInput>();
  const sanitizedAnswers: SanitizedAnswer[] = [];

  for (const inputAnswer of inputAnswers) {
    const question = questionsById.get(inputAnswer.questionId);
    if (!question) {
      failResponseAction("VALIDATION", "Respuesta no pertenece al formulario");
    }
    if (answersByQuestionId.has(inputAnswer.questionId)) {
      failResponseAction("VALIDATION", "Respuesta duplicada para una pregunta");
    }

    const answer = {
      ...inputAnswer,
      value: inputAnswer.notApplicable ? "" : inputAnswer.value,
      comment: inputAnswer.comment,
    };

    validateAnswerValue(question, answer, options);
    answersByQuestionId.set(inputAnswer.questionId, answer);

    // Scoring, fatal-fail and comment-required are derived by computeScore()
    // (shared with the client preview); here we only validate and shape.
    sanitizedAnswers.push({
      questionId: answer.questionId,
      value: answer.value,
      comment: answer.comment || undefined,
      categoryId: question.formCategory?.qaCategoryId ?? undefined,
      score: undefined,
      isFatalFail: false,
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
    scoringMethod: "weighted_v2",
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
    formVersion: response.formVersion,
    submittedAt: response.submittedAt?.toISOString() ?? null,
    cancellationReason: response.cancellationReason,
    scoringSnapshot: response.scoringSnapshot,
    settingsSnapshot: response.settingsSnapshot,
    formSnapshot: response.formSnapshot,
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

async function loadExistingResponse(
  responseId: string | undefined,
  user: Session["user"],
  mode: ResponseLookupMode,
) {
  if (!responseId) return null;

  return prisma.response.findUnique({
    where: {
      id: responseId,
      AND: [responsePermissionScope(user, mode)],
    },
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
          question: { select: { formId: true } },
        },
      },
    },
  }) as Promise<ExistingResponseForMutation | null>;
}

function mutationPermissionForResponse(
  user: Session["user"],
  existing: ExistingResponseForMutation,
): EvaluationPermission {
  if (existing.status !== RESPONSE_STATUS.DRAFT) {
    return "canEditEvaluations";
  }

  if (existing.evaluatorId === user.id) {
    return "canEvaluate";
  }

  return "canEditEvaluations";
}

async function loadMutationForm(
  formId: string,
  user: Session["user"],
  permission: EvaluationPermission,
) {
  return prisma.form.findUnique({
    where: {
      id: formId,
      AND: [formPermissionScope(user, permission)],
    },
    include: {
      campaign: { select: { name: true, active: true } },
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
  });
}

function isSameCreateContext(
  response: ExistingResponseForMutation,
  input: ResponseMutationInput,
  evaluatorId: string,
  status: typeof RESPONSE_STATUS.DRAFT | typeof RESPONSE_STATUS.SUBMITTED,
) {
  const sameStableIdentity =
    response.evaluatorId === evaluatorId &&
    response.formId === input.formId &&
    response.status === status;

  if (!sameStableIdentity || status === RESPONSE_STATUS.DRAFT) {
    return sameStableIdentity;
  }

  return response.agentId === input.agentId && response.dispositionId === input.dispositionId;
}

async function saveEvaluation(
  data: unknown,
  status: typeof RESPONSE_STATUS.DRAFT | typeof RESPONSE_STATUS.SUBMITTED,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  const input = parseResponseMutationInput(data);

  const existing = input.responseId
    ? await loadExistingResponse(input.responseId, session.user, "READ_OR_MUTATE")
    : null;

  if (input.responseId && !existing) {
    failResponseUnavailable();
  }
  if (existing) {
    await assertResponsePermissionOrUnavailable(session.user, existing, "READ_OR_MUTATE");
    if (!hasMutationResponseIntegrity(existing)) failResponseUnavailable();
    // Never use the caller-supplied Form ID to hydrate data during an edit. The
    // scoped Response is the authority for the relation and must match first.
    if (existing.formId !== input.formId) failFormUnavailable();
  }

  const form = await loadMutationForm(
    existing?.formId ?? input.formId,
    session.user,
    existing ? mutationPermissionForResponse(session.user, existing) : "canEvaluate",
  );
  if (!form) failFormUnavailable();

  if (existing?.status === RESPONSE_STATUS.CANCELLED) {
    failResponseAction("INVALID_STATE", "No se puede modificar una evaluacion anulada");
  }
  if (existing && status === RESPONSE_STATUS.DRAFT && existing.status !== RESPONSE_STATUS.DRAFT) {
    failResponseAction(
      "INVALID_STATE",
      "Solo se pueden guardar borradores sobre evaluaciones en borrador",
    );
  }

  if (
    existing &&
    new Date(input.expectedUpdatedAt as string).getTime() !== existing.updatedAt.getTime()
  ) {
    failResponseAction("CONFLICT", CONCURRENT_RESPONSE_CHANGE_ERROR);
  }

  const isHistoricalCorrection =
    status === RESPONSE_STATUS.SUBMITTED && existing?.status === RESPONSE_STATUS.SUBMITTED;

  if (form.status !== "PUBLISHED" && !(isHistoricalCorrection && form.status === "ARCHIVED")) {
    failResponseAction("INVALID_STATE", "Solo se puede evaluar un formulario publicado");
  }
  if (!form.campaign.active && !isHistoricalCorrection) {
    failResponseAction("INVALID_STATE", "No se puede evaluar una campana inactiva");
  }

  if (input.answers.length > form.questions.length) {
    failResponseAction("VALIDATION", "La evaluacion contiene respuestas no validas");
  }

  const [agent, disposition, scoringSettings] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { campaignId: true, active: true, name: true, agentCode: true },
    }),
    input.dispositionId
      ? prisma.disposition.findUnique({
          where: { id: input.dispositionId },
          select: { campaignId: true, active: true },
        })
      : Promise.resolve(null),
    getCampaignScoringSettings(form.campaignId),
  ]);

  const keepsHistoricalAgent = isHistoricalCorrection && input.agentId === existing?.agentId;
  if (!agent || agent.campaignId !== form.campaignId || (!agent.active && !keepsHistoricalAgent)) {
    failResponseAction("VALIDATION", "Agente invalido para esta campana");
  }

  const keepsHistoricalDisposition =
    isHistoricalCorrection && input.dispositionId === existing?.dispositionId;
  if (
    (!input.dispositionId && !keepsHistoricalDisposition) ||
    (input.dispositionId &&
      (!disposition ||
        disposition.campaignId !== form.campaignId ||
        (!disposition.active && !keepsHistoricalDisposition)))
  ) {
    failResponseAction("VALIDATION", "Disposicion invalida para esta campana");
  }

  const scoringPolicy = resolveResponseScoringPolicy(existing, scoringSettings);

  const requireComplete = status === RESPONSE_STATUS.SUBMITTED;
  const sanitizedAnswers = sanitizeAnswers(form.questions, input.answers, {
    requireComplete,
  });

  const scoreResult = computeScore(
    form.questions.map(toScoringQuestion),
    new Map(
      sanitizedAnswers.map((answer) => [
        answer.questionId,
        {
          value: answer.value,
          notApplicable: answer.notApplicable,
          comment: answer.comment,
        },
      ]),
    ),
    {
      passThreshold: scoringPolicy.passThreshold,
      fatalZeroesScore: scoringPolicy.fatalZeroesScore,
    },
  );

  if (requireComplete && scoreResult.blockers > 0) {
    failResponseAction("VALIDATION", "Hay preguntas que requieren comentario al fallar");
  }

  // Fold per-question scoring (fatal fail + item score) back into the answers.
  const scoreByQuestionId = new Map(scoreResult.questions.map((q) => [q.questionId, q]));
  for (const answer of sanitizedAnswers) {
    const q = scoreByQuestionId.get(answer.questionId);
    answer.isFatalFail = q?.isFatalFail ?? false;
    answer.score = q?.itemScore ?? undefined;
  }

  const ratingQuestions = form.questions.filter((question) => question.type === "RATING");
  const score = scoreResult.score;
  const hasFatalFail = scoreResult.hasFatalFail;
  const result = requireComplete ? scoreResult.result : null;

  const formSnapshot =
    isHistoricalCorrection && existing?.formSnapshot
      ? existing.formSnapshot
      : buildFormSnapshot(form);
  const scoringSnapshot = buildScoringSnapshot({
    status,
    score,
    result,
    hasFatalFail,
    passThreshold: scoringPolicy.passThreshold,
    sanitizedAnswers,
    ratingQuestions,
  });
  const settingsSnapshot =
    isHistoricalCorrection && existing?.settingsSnapshot
      ? existing.settingsSnapshot
      : {
          ...scoringSettings,
          passThreshold: scoringPolicy.passThreshold,
          fatalZeroesScore: scoringPolicy.fatalZeroesScore,
          capturedAt: new Date().toISOString(),
        };

  const isNew = !existing;
  const action =
    status === RESPONSE_STATUS.DRAFT
      ? isNew
        ? "draft_created"
        : "draft_updated"
      : existing?.status === RESPONSE_STATUS.SUBMITTED
        ? "updated"
        : existing?.status === RESPONSE_STATUS.DRAFT
          ? "submitted"
          : "created";

  const persistence = await (async () => {
    try {
      const savedResponse = await prisma.$transaction(async (tx) => {
        const responseData = {
          formId: input.formId,
          agentId: input.agentId,
          evaluatorId: existing?.evaluatorId ?? session.user.id,
          dispositionId: input.dispositionId,
          score,
          formVersion:
            isHistoricalCorrection && existing?.formVersion ? existing.formVersion : form.version,
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

        const savedResponse = existing
          ? await tx.response.update({
              where: {
                id: existing.id,
                updatedAt: new Date(input.expectedUpdatedAt as string),
                status: existing.status,
              },
              data: {
                ...responseData,
                answers: {
                  deleteMany: {},
                  create: answerCreateData,
                },
              },
            })
          : await tx.response.create({
              data: {
                id: input.clientResponseId as string,
                ...responseData,
                answers: {
                  create: answerCreateData,
                },
              },
            });

        await writeAuditLog(
          {
            userId: session.user.id,
            campaignId: form.campaignId,
            module: "evaluations",
            action,
            entityType: "response",
            entityId: savedResponse.id,
            beforeValue: existing ? existingResponseAuditValue(existing) : null,
            afterValue: {
              id: savedResponse.id,
              formId: input.formId,
              agentId: input.agentId,
              dispositionId: input.dispositionId,
              score,
              result,
              hasFatalFail,
              status,
              formVersion:
                isHistoricalCorrection && existing?.formVersion
                  ? existing.formVersion
                  : form.version,
              answerCount: sanitizedAnswers.length,
              fatalAnswerCount: sanitizedAnswers.filter((answer) => answer.isFatalFail).length,
              notApplicableCount: sanitizedAnswers.filter((answer) => answer.notApplicable).length,
              answers: answerAuditValue(sanitizedAnswers),
              scoringSnapshot,
              settingsSnapshot,
              formSnapshot,
            },
            impact:
              status === RESPONSE_STATUS.DRAFT
                ? "Borrador guardado; no impacta Dashboard, KPIs, reportes ni exportaciones."
                : "Evaluacion incluida o actualizada en Dashboard, KPIs, reportes y exportaciones.",
          },
          tx,
        );

        return savedResponse;
      });
      return { response: savedResponse, replayed: false };
    } catch (error) {
      if (existing && isPrismaRecordConflict(error)) {
        failResponseAction("CONFLICT", CONCURRENT_RESPONSE_CHANGE_ERROR);
      }
      if (!existing && isPrismaUniqueConflict(error)) {
        const replayedResponse = await loadExistingResponse(
          input.clientResponseId,
          session.user,
          "CREATE_REPLAY",
        );
        if (!replayedResponse) failResponseUnavailable();
        await assertResponsePermissionOrUnavailable(
          session.user,
          replayedResponse,
          "CREATE_REPLAY",
        );
        if (!hasMutationResponseIntegrity(replayedResponse)) failResponseUnavailable();
        if (!isSameCreateContext(replayedResponse, input, session.user.id, status)) {
          failResponseAction(
            "INVALID_STATE",
            "El identificador de evaluacion ya fue usado en otro contexto",
          );
        }
        return { response: replayedResponse, replayed: true };
      }
      throw error;
    }
  })();
  const { response, replayed } = persistence;

  const previousWasFailed =
    existing?.status === RESPONSE_STATUS.SUBMITTED &&
    (existing.hasFatalFail ||
      existing.result === "FAIL" ||
      (existing.result !== "PASS" &&
        existing.result !== "FAIL" &&
        Number(existing.score) < scoringPolicy.passThreshold));
  const shouldNotifyFailure =
    !replayed &&
    status === RESPONSE_STATUS.SUBMITTED &&
    (hasFatalFail || result === "FAIL") &&
    (!previousWasFailed || (hasFatalFail && !existing?.hasFatalFail));

  if (shouldNotifyFailure) {
    const fatalAnswerCount = sanitizedAnswers.filter((answer) => answer.isFatalFail).length;
    await emitNotification({
      type: hasFatalFail ? "fatal_evaluation" : "evaluation_failed",
      severity: hasFatalFail ? "CRITICAL" : "WARNING",
      campaignId: form.campaignId,
      permission: "canViewReports",
      title: hasFatalFail ? "Evaluacion con falla fatal" : "Evaluacion bajo umbral",
      body: `${agent.name ?? "Agente"}${agent.agentCode ? ` (${agent.agentCode})` : ""} obtuvo ${score.toFixed(
        1,
      )}% en ${form.title}.`,
      href: `/analytics/responses/${response.id}`,
      entityType: "response",
      entityId: response.id,
      metadata: {
        formId: form.id,
        formTitle: form.title,
        campaignName: form.campaign?.name ?? null,
        score,
        result,
        hasFatalFail,
        fatalAnswerCount,
        passThreshold: scoringPolicy.passThreshold,
      },
    });
  }

  revalidateEvaluationPaths();
  return normalizeResponseMutationResult(response, replayed);
}

export async function saveResponseDraft(data: unknown) {
  return saveEvaluation(data, RESPONSE_STATUS.DRAFT);
}

export async function submitResponse(data: unknown) {
  return saveEvaluation(data, RESPONSE_STATUS.SUBMITTED);
}

export async function saveResponseDraftAction(data: unknown) {
  return toResponseActionResult(() => saveEvaluation(data, RESPONSE_STATUS.DRAFT));
}

export async function submitResponseAction(data: unknown) {
  return toResponseActionResult(() => saveEvaluation(data, RESPONSE_STATUS.SUBMITTED));
}

export async function cancelResponse(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const parsedInput = cancelResponseSchema.safeParse(data);
  if (!parsedInput.success) failResponseAction("VALIDATION", "Datos de anulacion invalidos");
  const input = parsedInput.data;
  const existing = await loadExistingResponse(input.id, session.user, "CANCEL");
  if (!existing) failResponseUnavailable();

  await assertResponsePermissionOrUnavailable(session.user, existing, "CANCEL");
  if (!hasMutationResponseIntegrity(existing)) failResponseUnavailable();
  if (existing.status === RESPONSE_STATUS.CANCELLED) {
    failResponseAction("INVALID_STATE", "La evaluacion ya esta anulada");
  }
  if (new Date(input.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()) {
    failResponseAction("CONFLICT", CONCURRENT_RESPONSE_CHANGE_ERROR);
  }

  const cancelledAt = new Date();
  const response = await (async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const cancelledResponse = await tx.response.update({
          where: {
            id: existing.id,
            updatedAt: new Date(input.expectedUpdatedAt),
            status: existing.status,
          },
          data: {
            status: RESPONSE_STATUS.CANCELLED,
            cancelledAt,
            cancelledById: session.user.id,
            cancellationReason: input.reason,
          },
        });
        await writeAuditLog(
          {
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
          },
          tx,
        );
        return cancelledResponse;
      });
    } catch (error) {
      if (isPrismaRecordConflict(error)) {
        failResponseAction("CONFLICT", CONCURRENT_RESPONSE_CHANGE_ERROR);
      }
      throw error;
    }
  })();

  await emitNotification({
    type: "evaluation_cancelled",
    severity: "WARNING",
    campaignId: existing.form.campaignId,
    permission: "canViewReports",
    title: "Evaluacion anulada",
    body: `Una evaluacion fue anulada: ${input.reason}`,
    href: `/analytics/responses/${existing.id}`,
    entityType: "response",
    entityId: existing.id,
    metadata: {
      reason: input.reason,
      cancelledById: session.user.id,
      cancelledAt: cancelledAt.toISOString(),
    },
  });

  revalidateEvaluationPaths();
  return normalizeResponseMutationResult(response, false);
}

export async function cancelResponseAction(data: unknown) {
  return toResponseActionResult(() => cancelResponse(data));
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
