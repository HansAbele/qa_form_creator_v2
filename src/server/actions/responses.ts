"use server";

import type { Prisma, QuestionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveScorecardBand } from "@/lib/official-form-templates";
import { elapsedSeconds } from "@/lib/performance-management";
import { prisma } from "@/lib/prisma";
import { resolveResponseScoringPolicy } from "@/lib/response-scoring-policy";
import type { ResponseStatus } from "@/lib/response-status";
import { RESPONSE_STATUS, submittedResponseWhere } from "@/lib/response-status";
import { computeScore, type ScoringQuestion, type WeightedOption } from "@/lib/scoring";
import { getCampaignScoringSettings } from "@/lib/settings";
import { writeAuditLog } from "@/server/audit-log";
import {
  getCampaignFilterForPermission,
  hasCampaignPermissionForUser,
} from "@/server/queries/campaign-filter";

const MAX_ANSWERS_PER_SUBMISSION = 500;
const MAX_ANSWER_LENGTH = 10_000;
const CONCURRENT_RESPONSE_CHANGE_ERROR =
  "The evaluation was modified in another session. Reload the page and try again";
const RESPONSE_UNAVAILABLE_MESSAGE = "Evaluation unavailable";
const FORM_UNAVAILABLE_MESSAGE = "Form unavailable";

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
        error: { code: "VALIDATION", message: "Invalid evaluation data" },
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
    // Accepted only for a short rolling-deploy compatibility window. Qore no
    // longer assigns evaluation dispositions and never persists this value.
    dispositionId: z.string().trim().min(1).nullable().optional(),
    interactionId: z.string().trim().min(1).nullable().optional(),
    evaluationActivityId: z.string().trim().min(1).max(100).optional(),
    answers: z.array(responseAnswerSchema).max(MAX_ANSWERS_PER_SUBMISSION),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.responseId && !input.expectedUpdatedAt) {
      context.addIssue({
        code: "custom",
        path: ["expectedUpdatedAt"],
        message: "expectedUpdatedAt is required when updating an evaluation",
      });
    }
    if (!input.responseId && !input.clientResponseId) {
      context.addIssue({
        code: "custom",
        path: ["clientResponseId"],
        message: "clientResponseId is required when creating an evaluation",
      });
    }
  });

const cancelResponseSchema = z
  .object({
    id: z.string().trim().min(1),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(3, "A cancellation reason is required").max(1000),
  })
  .strict();

type ResponseMutationInput = z.infer<typeof responseMutationSchema>;
type ResponseAnswerInput = z.infer<typeof responseAnswerSchema>;

const startEvaluationActivitySchema = z
  .object({
    formId: z.string().trim().min(1).max(100),
    responseId: z.string().trim().min(1).max(100).optional(),
    interactionId: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const pauseEvaluationActivitySchema = z
  .object({
    activitySessionId: z.string().trim().min(1).max(100),
  })
  .strict();

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
  interactionId: string | null;
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
  interaction: {
    campaignId: string;
    agentId: string | null;
    dispositionId: string | null;
  } | null;
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

  return { form: formPermissionScope(user, "canEditEvaluations") };
}

async function assertResponsePermissionOrUnavailable(
  user: Session["user"],
  response: Pick<ExistingResponseForMutation, "evaluatorId" | "status" | "form">,
  mode: ResponseLookupMode,
) {
  if (mode === "CREATE_REPLAY" && response.evaluatorId !== user.id) {
    failResponseUnavailable();
  }

  const permission = mode === "CREATE_REPLAY" ? "canEvaluate" : "canEditEvaluations";
  const allowed = await hasCampaignPermissionForUser(user, response.form.campaignId, permission);
  if (!allowed) failResponseUnavailable();
}

function hasMutationResponseIntegrity(response: ExistingResponseForMutation) {
  return (
    response.answers.every((answer) => answer.question.formId === response.formId) &&
    (!response.interaction ||
      (response.interaction.campaignId === response.form.campaignId &&
        (!response.interaction.agentId || response.interaction.agentId === response.agentId)))
  );
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
  if (!session?.user) throw new Error("Unauthorized");

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
  if (!session?.user) throw new Error("Unauthorized");

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
      interaction: {
        select: { campaignId: true, agentId: true, dispositionId: true },
      },
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
    (response.interaction &&
      (response.interaction.campaignId !== response.form.campaignId ||
        (response.interaction.agentId && response.interaction.agentId !== response.agentId))) ||
    response.answers.some((answer) => answer.question.formId !== response.form.id)
  ) {
    failResponseUnavailable();
  }
  if (response.status === RESPONSE_STATUS.CANCELLED) {
    throw new Error("A cancelled evaluation cannot be edited");
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
    failResponseAction("VALIDATION", "Invalid evaluation data");
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
    failResponseAction("VALIDATION", "Some required questions are unanswered");
  }

  if (!value) return;

  switch (question.type) {
    case "TEXT":
      return;
    case "RATING": {
      const max = question.ratingMax && question.ratingMax > 0 ? question.ratingMax : 5;
      const numericValue = Number(value);
      if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > max) {
        failResponseAction("VALIDATION", "Rating answer is outside the allowed range");
      }
      return;
    }
    case "SELECT":
    case "RADIO":
    case "BOOLEAN": {
      const questionOptions = getOptionValues(question.options);
      if (questionOptions.length > 0 && !questionOptions.includes(value)) {
        failResponseAction("VALIDATION", "The answer is not one of the form options");
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
      failResponseAction("VALIDATION", "The answer does not belong to the form");
    }
    if (answersByQuestionId.has(inputAnswer.questionId)) {
      failResponseAction("VALIDATION", "Duplicate answer for a question");
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
  templateKey: string | null;
  templateVersion: string | null;
  passThresholdOverride: number | null;
  gradingScale: Prisma.JsonValue | null;
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
    templateKey: form.templateKey,
    templateVersion: form.templateVersion,
    passThresholdOverride: form.passThresholdOverride,
    gradingScale: form.gradingScale,
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
  gradingScale: unknown;
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
    gradingBand: resolveScorecardBand(args.gradingScale, args.score, args.hasFatalFail),
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
    interactionId: response.interactionId,
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
      interaction: {
        select: { campaignId: true, agentId: true, dispositionId: true },
      },
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

async function closeEvaluationActivityInterval(
  tx: Prisma.TransactionClient,
  activitySessionId: string,
  endedAt: Date,
  stopReason: string,
) {
  const interval = await tx.qaActivityInterval.findFirst({
    where: { activitySessionId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  if (!interval) return 0;

  const durationSeconds = elapsedSeconds(interval.startedAt, endedAt);
  const closed = await tx.qaActivityInterval.updateMany({
    where: { id: interval.id, endedAt: null },
    data: { endedAt, durationSeconds, stopReason },
  });
  return closed.count === 1 ? durationSeconds : 0;
}

export async function startEvaluationActivityAction(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const parsed = startEvaluationActivitySchema.safeParse(data);
  if (!parsed.success) throw new Error("Invalid evaluation timer context");
  const input = parsed.data;
  const existingResponse = input.responseId
    ? await loadExistingResponse(input.responseId, session.user, "READ_OR_MUTATE")
    : null;
  if (input.responseId && !existingResponse) failResponseUnavailable();
  if (existingResponse) {
    await assertResponsePermissionOrUnavailable(session.user, existingResponse, "READ_OR_MUTATE");
    if (existingResponse.formId !== input.formId) failFormUnavailable();
  }

  const form = await loadMutationForm(
    existingResponse?.formId ?? input.formId,
    session.user,
    existingResponse ? "canEditEvaluations" : "canEvaluate",
  );
  if (!form) failFormUnavailable();

  const interaction = input.interactionId
    ? await prisma.interaction.findFirst({
        where: {
          id: input.interactionId,
          campaignId: form.campaignId,
          ...(existingResponse ? { response: { id: existingResponse.id } } : {}),
        },
        select: { id: true, providerInteractionId: true },
      })
    : null;
  if (input.interactionId && !interaction) {
    failResponseAction("VALIDATION", "The selected call is unavailable for this evaluation");
  }

  const marker = existingResponse
    ? `AUTO_EVALUATION:response:${existingResponse.id}`
    : interaction
      ? `AUTO_EVALUATION:interaction:${interaction.id}`
      : `AUTO_EVALUATION:form:${form.id}`;
  const label = [
    "Evaluation",
    form.title,
    interaction ? `Call ${interaction.providerInteractionId}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const now = new Date();

  const activity = await prisma.$transaction(async (tx) => {
    const matching = await tx.qaActivitySession.findFirst({
      where: {
        userId: session.user.id,
        campaignId: form.campaignId,
        activityType: "EVALUATION",
        status: { in: ["ACTIVE", "PAUSED"] },
        OR: [...(existingResponse ? [{ responseId: existingResponse.id }] : []), { notes: marker }],
      },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, totalSeconds: true },
    });
    const current = await tx.qaActivitySession.findFirst({
      where: { userId: session.user.id, status: "ACTIVE" },
      select: { id: true, campaignId: true },
    });

    if (current && current.id !== matching?.id) {
      const addedSeconds = await closeEvaluationActivityInterval(
        tx,
        current.id,
        now,
        "Automatically paused when an evaluation opened",
      );
      await tx.qaActivitySession.update({
        where: { id: current.id },
        data: { status: "PAUSED", totalSeconds: { increment: addedSeconds } },
      });
      await writeAuditLog(
        {
          userId: session.user.id,
          campaignId: current.campaignId,
          module: "performance_management",
          action: "qa_activity_auto_paused",
          entityType: "qa_activity_session",
          entityId: current.id,
          afterValue: { addedSeconds, reason: "evaluation_opened" },
          impact: "The prior activity was paused to prevent overlapping tracked time.",
        },
        tx,
      );
    }

    if (matching) {
      if (matching.status === "PAUSED") {
        await tx.qaActivityInterval.create({
          data: { activitySessionId: matching.id, startedAt: now },
        });
      }
      const updated = await tx.qaActivitySession.update({
        where: { id: matching.id },
        data: {
          status: "ACTIVE",
          label,
          notes: marker,
          ...(existingResponse ? { responseId: existingResponse.id } : {}),
        },
        select: { id: true, status: true, totalSeconds: true },
      });
      const openInterval = await tx.qaActivityInterval.findFirst({
        where: { activitySessionId: updated.id, endedAt: null },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });
      return { ...updated, openIntervalStartedAt: openInterval?.startedAt ?? now };
    }

    const created = await tx.qaActivitySession.create({
      data: {
        userId: session.user.id,
        campaignId: form.campaignId,
        responseId: existingResponse?.id ?? null,
        activityType: "EVALUATION",
        status: "ACTIVE",
        label,
        notes: marker,
        startedAt: now,
        intervals: { create: { startedAt: now } },
      },
      select: { id: true, status: true, totalSeconds: true },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: form.campaignId,
        module: "performance_management",
        action: "evaluation_activity_started",
        entityType: "qa_activity_session",
        entityId: created.id,
        afterValue: {
          formId: form.id,
          responseId: existingResponse?.id ?? null,
          interactionId: interaction?.id ?? null,
        },
        impact: "Server-controlled evaluation timing started when the form opened.",
      },
      tx,
    );
    return { ...created, openIntervalStartedAt: now };
  });

  revalidatePath("/performance");
  return {
    ...activity,
    openIntervalStartedAt: activity.openIntervalStartedAt.toISOString(),
  };
}

export async function pauseEvaluationActivityAction(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const parsed = pauseEvaluationActivitySchema.safeParse(data);
  if (!parsed.success) throw new Error("Invalid evaluation timer");

  const activity = await prisma.qaActivitySession.findFirst({
    where: {
      id: parsed.data.activitySessionId,
      userId: session.user.id,
      activityType: "EVALUATION",
    },
    select: { id: true, campaignId: true, status: true, totalSeconds: true },
  });
  if (!activity) throw new Error("Evaluation timer unavailable");
  if (activity.status !== "ACTIVE") return activity;

  const now = new Date();
  const paused = await prisma.$transaction(async (tx) => {
    const addedSeconds = await closeEvaluationActivityInterval(
      tx,
      activity.id,
      now,
      "Evaluation form cancelled",
    );
    const updated = await tx.qaActivitySession.update({
      where: { id: activity.id },
      data: {
        status: "PAUSED",
        totalSeconds: { increment: addedSeconds },
      },
      select: { id: true, campaignId: true, status: true, totalSeconds: true },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: activity.campaignId,
        module: "performance_management",
        action: "evaluation_activity_paused",
        entityType: "qa_activity_session",
        entityId: activity.id,
        afterValue: {
          addedSeconds,
          totalSeconds: updated.totalSeconds,
          reason: "evaluation_form_cancelled",
        },
        impact: "Evaluation timing was paused when the QA left through Cancel.",
      },
      tx,
    );
    return updated;
  });

  revalidatePath("/performance");
  return paused;
}

function isSameCreateContext(
  response: ExistingResponseForMutation,
  input: ResponseMutationInput,
  evaluatorId: string,
) {
  return (
    response.evaluatorId === evaluatorId &&
    response.formId === input.formId &&
    (response.interactionId ?? null) === (input.interactionId ?? null) &&
    response.status === RESPONSE_STATUS.SUBMITTED &&
    response.agentId === input.agentId
  );
}

async function saveEvaluation(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
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
    if ((existing.interactionId ?? null) !== (input.interactionId ?? null)) {
      failResponseUnavailable();
    }
  }

  const form = await loadMutationForm(
    existing?.formId ?? input.formId,
    session.user,
    existing ? "canEditEvaluations" : "canEvaluate",
  );
  if (!form) failFormUnavailable();

  if (existing?.status === RESPONSE_STATUS.CANCELLED) {
    failResponseAction("INVALID_STATE", "A cancelled evaluation cannot be modified");
  }
  if (existing && existing.status !== RESPONSE_STATUS.SUBMITTED) {
    failResponseAction("INVALID_STATE", "Only submitted evaluations can be corrected");
  }

  if (
    existing &&
    new Date(input.expectedUpdatedAt as string).getTime() !== existing.updatedAt.getTime()
  ) {
    failResponseAction("CONFLICT", CONCURRENT_RESPONSE_CHANGE_ERROR);
  }

  const isHistoricalCorrection = existing?.status === RESPONSE_STATUS.SUBMITTED;

  if (form.status !== "PUBLISHED" && !(isHistoricalCorrection && form.status === "ARCHIVED")) {
    failResponseAction("INVALID_STATE", "Only a published form can be evaluated");
  }
  if (!form.campaign.active && !isHistoricalCorrection) {
    failResponseAction("INVALID_STATE", "An inactive campaign cannot be evaluated");
  }

  if (input.answers.length > form.questions.length) {
    failResponseAction("VALIDATION", "The evaluation contains invalid answers");
  }

  const [agent, interaction, scoringSettings] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { campaignId: true, active: true, name: true, agentCode: true },
    }),
    input.interactionId
      ? prisma.interaction.findUnique({
          where: { id: input.interactionId },
          select: {
            campaignId: true,
            agentId: true,
            dispositionId: true,
            providerInteractionId: true,
            response: { select: { id: true } },
          },
        })
      : Promise.resolve(null),
    getCampaignScoringSettings(form.campaignId),
  ]);

  const keepsHistoricalAgent = isHistoricalCorrection && input.agentId === existing?.agentId;
  if (!agent || agent.campaignId !== form.campaignId || (!agent.active && !keepsHistoricalAgent)) {
    failResponseAction("VALIDATION", "Invalid agent for this campaign");
  }

  if (
    input.interactionId &&
    (!interaction ||
      interaction.campaignId !== form.campaignId ||
      (interaction.agentId !== null && interaction.agentId !== input.agentId) ||
      (interaction.response !== null && interaction.response.id !== existing?.id))
  ) {
    failResponseAction("VALIDATION", "The selected call is unavailable for this evaluation");
  }

  const evaluationActivity = input.evaluationActivityId
    ? await prisma.qaActivitySession.findFirst({
        where: {
          id: input.evaluationActivityId,
          userId: session.user.id,
          campaignId: form.campaignId,
          activityType: "EVALUATION",
          status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] },
        },
        select: { id: true },
      })
    : null;
  if (input.evaluationActivityId && !evaluationActivity) {
    failResponseAction("VALIDATION", "Evaluation timer unavailable");
  }

  const scoringPolicy = resolveResponseScoringPolicy(existing, {
    ...scoringSettings,
    passThreshold: form.passThresholdOverride ?? scoringSettings.passThreshold,
  });

  const sanitizedAnswers = sanitizeAnswers(form.questions, input.answers, {
    requireComplete: true,
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

  if (scoreResult.blockers > 0) {
    failResponseAction("VALIDATION", "Some failed questions require a comment");
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
  const result = scoreResult.result;

  const formSnapshot =
    isHistoricalCorrection && existing?.formSnapshot
      ? existing.formSnapshot
      : buildFormSnapshot(form);
  const scoringSnapshot = buildScoringSnapshot({
    status: RESPONSE_STATUS.SUBMITTED,
    score,
    result,
    hasFatalFail,
    passThreshold: scoringPolicy.passThreshold,
    gradingScale: form.gradingScale,
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
  const action = isNew ? "created" : "updated";

  const persistence = await (async () => {
    try {
      const savedResponse = await prisma.$transaction(async (tx) => {
        const responseData = {
          formId: input.formId,
          agentId: input.agentId,
          evaluatorId: existing?.evaluatorId ?? session.user.id,
          dispositionId: null,
          interactionId: input.interactionId ?? null,
          score,
          formVersion:
            isHistoricalCorrection && existing?.formVersion ? existing.formVersion : form.version,
          result,
          hasFatalFail,
          status: RESPONSE_STATUS.SUBMITTED,
          submittedAt: existing ? (existing.submittedAt ?? existing.createdAt) : new Date(),
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
              interactionId: input.interactionId ?? null,
              score,
              result,
              hasFatalFail,
              status: RESPONSE_STATUS.SUBMITTED,
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
            impact: "Evaluation included or updated in Dashboard, KPIs, reports, and exports.",
          },
          tx,
        );

        if (evaluationActivity) {
          const activity = await tx.qaActivitySession.findFirst({
            where: {
              id: evaluationActivity.id,
              userId: session.user.id,
              campaignId: form.campaignId,
              activityType: "EVALUATION",
            },
            select: { id: true, status: true, totalSeconds: true },
          });
          if (!activity) failResponseAction("VALIDATION", "Evaluation timer unavailable");

          const completedAt = new Date();
          const addedSeconds =
            activity.status === "ACTIVE"
              ? await closeEvaluationActivityInterval(
                  tx,
                  activity.id,
                  completedAt,
                  "Evaluation submitted",
                )
              : 0;
          const activityLabel = [
            "Evaluation",
            agent.name,
            form.title,
            interaction ? `Call ${interaction.providerInteractionId}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          await tx.qaActivitySession.update({
            where: { id: activity.id },
            data: {
              responseId: savedResponse.id,
              label: activityLabel,
              notes: "Automatically measured from evaluation form open to submission.",
              status: "COMPLETED",
              endedAt: completedAt,
              totalSeconds: { increment: addedSeconds },
            },
          });
          if (activity.status !== "COMPLETED") {
            await writeAuditLog(
              {
                userId: session.user.id,
                campaignId: form.campaignId,
                module: "performance_management",
                action: "evaluation_activity_completed",
                entityType: "qa_activity_session",
                entityId: activity.id,
                afterValue: {
                  responseId: savedResponse.id,
                  agentId: input.agentId,
                  agentName: agent.name,
                  interactionId: input.interactionId ?? null,
                  addedSeconds,
                  totalSeconds: activity.totalSeconds + addedSeconds,
                },
                impact: "Evaluation work time was closed and linked to the submitted evaluation.",
              },
              tx,
            );
          }
        }

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
        if (!replayedResponse) {
          if (input.interactionId) {
            failResponseAction("INVALID_STATE", "The selected call already has an evaluation.");
          }
          failResponseUnavailable();
        }
        await assertResponsePermissionOrUnavailable(
          session.user,
          replayedResponse,
          "CREATE_REPLAY",
        );
        if (!hasMutationResponseIntegrity(replayedResponse)) failResponseUnavailable();
        if (!isSameCreateContext(replayedResponse, input, session.user.id)) {
          failResponseAction(
            "INVALID_STATE",
            "The evaluation identifier was already used in another context",
          );
        }
        return { response: replayedResponse, replayed: true };
      }
      throw error;
    }
  })();
  const { response, replayed } = persistence;

  revalidateEvaluationPaths();
  return normalizeResponseMutationResult(response, replayed);
}

export async function submitResponse(data: unknown) {
  return saveEvaluation(data);
}

export async function submitResponseAction(data: unknown) {
  return toResponseActionResult(() => saveEvaluation(data));
}

export async function cancelResponse(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const parsedInput = cancelResponseSchema.safeParse(data);
  if (!parsedInput.success) failResponseAction("VALIDATION", "Invalid cancellation data");
  const input = parsedInput.data;
  const existing = await loadExistingResponse(input.id, session.user, "CANCEL");
  if (!existing) failResponseUnavailable();

  await assertResponsePermissionOrUnavailable(session.user, existing, "CANCEL");
  if (!hasMutationResponseIntegrity(existing)) failResponseUnavailable();
  if (existing.status === RESPONSE_STATUS.CANCELLED) {
    failResponseAction("INVALID_STATE", "The evaluation is already cancelled");
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
            impact: "Evaluation cancelled and excluded from Dashboard, KPIs, reports, and exports.",
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
  revalidatePath("/evaluations");
  revalidatePath("/performance");
  revalidatePath("/analytics/agents");
  revalidatePath("/analytics/dispositions");
  revalidatePath("/");
}
