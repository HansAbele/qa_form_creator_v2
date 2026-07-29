"use client";

import { useI18n } from "@/components/providers/i18n-provider";
import { parseOfficialQuestionLabel } from "@/lib/official-form-templates";
import type { QuestionData } from "./question-panel";
import { QuestionRenderer } from "./question-renderer";

interface FormPreviewProps {
  title: string;
  description?: string;
  questions: QuestionData[];
}

/**
 * Renders the form exactly as an evaluator will see it, reusing the live
 * QuestionRenderer (read-only) so the preview always matches the real
 * evaluation — configurable rating scale/stars, Sí/No, options, fatal badges.
 */
export function FormPreview({ title, description, questions }: FormPreviewProps) {
  const { t } = useI18n();
  const isOfficialScorecard = questions.some(
    (question) => parseOfficialQuestionLabel(question.label).checkpoint,
  );
  if (!title && questions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        {t("Complete the form to see a preview")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-1">
        <h2 className="font-heading text-2xl font-bold tracking-tight">
          {title || t("Untitled form")}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {questions.length === 0 ? (
        <p className="text-center text-muted-foreground">{t("No questions added")}</p>
      ) : (
        <div className="pointer-events-none space-y-3 select-none">
          {questions.map((q, i) => (
            <QuestionRenderer
              key={q.id}
              question={{
                id: q.id,
                type: q.type,
                label: q.label || t("Question {number}", { number: i + 1 }),
                options: q.options.map((value, optionIndex) => ({
                  value,
                  points: q.optionPoints[optionIndex] ?? 0,
                })),
                required: q.required,
                weight: q.weight,
                fatal: q.fatal,
                fatalOptions: q.fatalOptions,
                requiresCommentOnFail: q.requiresCommentOnFail,
              }}
              index={isOfficialScorecard ? undefined : `${i + 1}`}
              value=""
              onChange={() => {}}
              ratingMax={q.ratingMax ?? undefined}
              ratingStyle={q.ratingStyle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
