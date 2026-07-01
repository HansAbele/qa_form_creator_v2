"use client";

import { QuestionRenderer } from "./question-renderer";
import type { QuestionData } from "./question-panel";

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
  if (!title && questions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Completa el formulario para ver la vista previa
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-1">
        <h2 className="font-heading text-2xl font-bold tracking-tight">{title || "Sin titulo"}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {questions.length === 0 ? (
        <p className="text-center text-muted-foreground">No hay preguntas agregadas</p>
      ) : (
        <div className="pointer-events-none space-y-3 select-none">
          {questions.map((q, i) => (
            <QuestionRenderer
              key={q.id}
              question={{
                id: q.id,
                type: q.type,
                label: q.label || `Pregunta ${i + 1}`,
                options: q.options,
                required: q.required,
                weight: q.weight,
                fatal: q.fatal,
                fatalOptions: q.fatalOptions,
                requiresCommentOnFail: q.requiresCommentOnFail,
              }}
              index={`${i + 1}`}
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
