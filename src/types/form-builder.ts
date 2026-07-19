import { z } from "zod";

export const QUESTION_TYPES = ["TEXT", "RATING", "SELECT", "RADIO", "BOOLEAN"] as const;

// Types the builder UI lets you create.
export const SELECTABLE_QUESTION_TYPES = ["TEXT", "RATING", "SELECT", "RADIO", "BOOLEAN"] as const;

// Question types that carry answer options and can define fatal options.
export const OPTION_QUESTION_TYPES: readonly QuestionTypeValue[] = ["SELECT", "RADIO", "BOOLEAN"];

export type QuestionTypeValue = (typeof QUESTION_TYPES)[number];

/** Single source of truth for question-type display labels (all surfaces). */
export const QUESTION_TYPE_LABELS: Record<QuestionTypeValue, string> = {
  TEXT: "Text",
  RATING: "Rating",
  SELECT: "Dropdown",
  RADIO: "Single choice",
  BOOLEAN: "Yes / No",
};

export function questionTypeLabel(type: string): string {
  return QUESTION_TYPE_LABELS[type as QuestionTypeValue] ?? type;
}

export function isOptionQuestionType(type: string): boolean {
  return OPTION_QUESTION_TYPES.includes(type as QuestionTypeValue);
}

/** Question types that carry weight and contribute to the score (everything but TEXT). */
export function isScoredQuestionType(type: string): boolean {
  return type !== "TEXT";
}

export const CRITICAL_TYPES = ["CUSTOMER", "BUSINESS", "COMPLIANCE"] as const;
export type CriticalTypeValue = (typeof CRITICAL_TYPES)[number];

export const RATING_STYLES = ["numeric", "stars"] as const;
export type RatingStyleValue = (typeof RATING_STYLES)[number];
export const DEFAULT_RATING_MAX = 5;

export const formQuestionInputSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    label: z.string().trim().min(1, "Question text is required").max(500),
    options: z.array(z.string().trim().min(1).max(200)).optional(),
    optionPoints: z.array(z.coerce.number().int().min(0).max(100)).optional(),
    required: z.boolean(),
    qaCategoryId: z.string().trim().min(1, "Select a QA category"),
    weight: z.coerce.number().int().min(0).max(100),
    fatal: z.boolean(),
    fatalOptions: z.array(z.string().trim().min(1).max(200)).optional(),
    criticalType: z.enum(CRITICAL_TYPES).nullish(),
    ratingFailThreshold: z.coerce.number().int().min(1).max(10).nullish(),
    ratingMax: z.coerce.number().int().min(2).max(10).nullish(),
    ratingStyle: z.enum(RATING_STYLES).nullish(),
    requiresCommentOnFail: z.boolean(),
  })
  .strict()
  .superRefine((question, ctx) => {
    const isOptionType = isOptionQuestionType(question.type);

    if (isOptionType && (!question.options || question.options.length < 2)) {
      ctx.addIssue({
        code: "custom",
        message: "Choice questions require at least 2 options",
        path: ["options"],
      });
    }

    if (isOptionType) {
      const optionSet = new Set(question.options ?? []);
      const fatalOptions = question.fatalOptions ?? [];
      if (question.fatal && fatalOptions.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Select at least one critical option",
          path: ["fatalOptions"],
        });
      }

      if (fatalOptions.some((option) => !optionSet.has(option))) {
        ctx.addIssue({
          code: "custom",
          message: "Critical options must exist in the answer options",
          path: ["fatalOptions"],
        });
      }
    } else if (question.fatalOptions?.length) {
      ctx.addIssue({
        code: "custom",
        message: "Only choice and Yes/No questions support critical options",
        path: ["fatalOptions"],
      });
    }
  });

export const formMutationSchema = z
  .object({
    title: z.string().trim().min(1, "Form title is required").max(255),
    description: z.string().trim().max(1000).optional(),
    campaignId: z.string().trim().min(1, "Select a campaign"),
    questions: z.array(formQuestionInputSchema).min(1, "Add at least one question"),
  })
  .strict()
  .superRefine((form, ctx) => {
    const scoredQuestions = form.questions.filter((question) =>
      isScoredQuestionType(question.type),
    );
    if (scoredQuestions.length === 0) return;

    const totalWeight = scoredQuestions.reduce((sum, question) => sum + question.weight, 0);

    if (totalWeight !== 100) {
      ctx.addIssue({
        code: "custom",
        message: "Scored question weights must total 100%",
        path: ["questions"],
      });
    }
  });

export type FormMutationInput = z.infer<typeof formMutationSchema>;
