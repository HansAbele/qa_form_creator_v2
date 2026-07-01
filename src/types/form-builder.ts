import { z } from "zod";

export const QUESTION_TYPES = ["TEXT", "RATING", "SELECT", "RADIO", "BOOLEAN"] as const;

// Types the builder UI lets you create.
export const SELECTABLE_QUESTION_TYPES = ["TEXT", "RATING", "SELECT", "RADIO", "BOOLEAN"] as const;

// Question types that carry answer options and can define fatal options.
export const OPTION_QUESTION_TYPES: readonly QuestionTypeValue[] = ["SELECT", "RADIO", "BOOLEAN"];

export type QuestionTypeValue = (typeof QUESTION_TYPES)[number];

export function isOptionQuestionType(type: string): boolean {
  return OPTION_QUESTION_TYPES.includes(type as QuestionTypeValue);
}

export const CRITICAL_TYPES = ["CUSTOMER", "BUSINESS", "COMPLIANCE"] as const;
export type CriticalTypeValue = (typeof CRITICAL_TYPES)[number];

export const formQuestionInputSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    label: z.string().trim().min(1, "La pregunta es obligatoria").max(500),
    options: z.array(z.string().trim().min(1).max(200)).optional(),
    required: z.boolean(),
    qaCategoryId: z.string().trim().min(1, "Selecciona una categoria QA"),
    weight: z.coerce.number().int().min(0).max(100),
    fatal: z.boolean(),
    fatalOptions: z.array(z.string().trim().min(1).max(200)).optional(),
    criticalType: z.enum(CRITICAL_TYPES).nullish(),
    ratingFailThreshold: z.coerce.number().int().min(1).max(5).nullish(),
    requiresCommentOnFail: z.boolean(),
  })
  .strict()
  .superRefine((question, ctx) => {
    const isOptionType = isOptionQuestionType(question.type);

    if (isOptionType && (!question.options || question.options.length < 2)) {
      ctx.addIssue({
        code: "custom",
        message: "Las preguntas de seleccion requieren al menos 2 opciones",
        path: ["options"],
      });
    }

    if (isOptionType) {
      const optionSet = new Set(question.options ?? []);
      const fatalOptions = question.fatalOptions ?? [];
      if (question.fatal && fatalOptions.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Selecciona al menos una opcion fatal",
          path: ["fatalOptions"],
        });
      }

      if (fatalOptions.some((option) => !optionSet.has(option))) {
        ctx.addIssue({
          code: "custom",
          message: "Las opciones fatales deben existir en las opciones de respuesta",
          path: ["fatalOptions"],
        });
      }
    } else if (question.fatalOptions?.length) {
      ctx.addIssue({
        code: "custom",
        message: "Solo seleccion, opcion multiple y Si/No admiten opciones fatales",
        path: ["fatalOptions"],
      });
    }
  });

export const formMutationSchema = z
  .object({
    title: z.string().trim().min(1, "El titulo es obligatorio").max(255),
    description: z.string().trim().max(1000).optional(),
    campaignId: z.string().trim().min(1, "Selecciona una campana"),
    questions: z.array(formQuestionInputSchema).min(1, "Agrega al menos una pregunta"),
  })
  .strict()
  .superRefine((form, ctx) => {
    const ratingQuestions = form.questions.filter((question) => question.type === "RATING");
    if (ratingQuestions.length === 0) return;

    const totalWeight = ratingQuestions.reduce((sum, question) => sum + question.weight, 0);

    if (totalWeight !== 100) {
      ctx.addIssue({
        code: "custom",
        message: "Los pesos de preguntas rating deben sumar 100%",
        path: ["questions"],
      });
    }
  });

export type FormMutationInput = z.infer<typeof formMutationSchema>;
