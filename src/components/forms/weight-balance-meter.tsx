"use client";

import { cn } from "@/lib/utils";
import type { QACategoryOption } from "./form-builder";
import type { QuestionData } from "./question-card";

interface WeightBalanceMeterProps {
  questions: QuestionData[];
  qaCategories: QACategoryOption[];
}

/**
 * Live weight-balance meter: guarantees scoring integrity by showing the total
 * RATING weight (must reach 100%) with a per-category segmented bar and a
 * status message.
 */
export function WeightBalanceMeter({ questions, qaCategories }: WeightBalanceMeterProps) {
  const ratingQuestions = questions.filter((q) => q.type === "RATING");
  const total = ratingQuestions.reduce((sum, q) => sum + q.weight, 0);

  const byCategory = new Map<string, number>();
  for (const q of ratingQuestions) {
    byCategory.set(q.qaCategoryId, (byCategory.get(q.qaCategoryId) ?? 0) + q.weight);
  }
  const segments = Array.from(byCategory.entries())
    .filter(([, weight]) => weight > 0)
    .map(([id, weight]) => {
      const cat = qaCategories.find((c) => c.id === id);
      return {
        id,
        name: cat?.name ?? "Sin categoria",
        color: cat?.systemColor ?? null,
        weight,
      };
    });

  const denom = Math.max(total, 100);
  const state = total === 100 ? "ok" : total < 100 ? "under" : "over";
  const stateClass = { ok: "text-success", under: "text-warning", over: "text-destructive" }[state];
  const message =
    state === "ok"
      ? "Balance completo"
      : state === "under"
        ? `Asigna ${100 - total}% mas para llegar al 100%`
        : `Excede en ${total - 100}%`;

  if (ratingQuestions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Agrega preguntas de calificacion para balancear los pesos.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Balance de pesos
        </span>
        <span className={cn("font-heading text-2xl font-extrabold tabular-nums", stateClass)}>
          {total}%
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {segments.map((seg) => (
          <div
            key={seg.id}
            className="h-full border-r border-card last:border-r-0"
            style={{
              width: `${(seg.weight / denom) * 100}%`,
              backgroundColor: seg.color ?? "hsl(var(--primary))",
            }}
          />
        ))}
      </div>
      <p className={cn("text-xs font-medium", stateClass)}>{message}</p>
      {segments.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
          {segments.map((seg) => (
            <span key={seg.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: seg.color ?? "hsl(var(--primary))" }}
              />
              {seg.name}{" "}
              <span className="font-medium tabular-nums text-foreground">{seg.weight}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
