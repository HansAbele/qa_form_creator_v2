"use client";

import { AlertTriangle, CheckCircle2, Send, XCircle } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { resolveScorecardBand } from "@/lib/official-form-templates";
import type { ScoreResult } from "@/lib/scoring";
import { cn } from "@/lib/utils";

interface CategoryInfo {
  id: string;
  name: string;
  color: string | null;
}

interface EvaluationSummaryProps {
  scoreResult: ScoreResult;
  gradingScale?: unknown;
  categories: CategoryInfo[];
  totalQuestions: number;
  answeredQuestions: number;
  submitting: boolean;
  savingDraft: boolean;
  isEditing: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function EvaluationSummary({
  scoreResult,
  gradingScale,
  categories,
  totalQuestions,
  answeredQuestions,
  submitting,
  savingDraft,
  isEditing,
  onSubmit,
  onCancel,
}: EvaluationSummaryProps) {
  const { t } = useI18n();
  const { score, result, passThreshold, blockers, perCategory } = scoreResult;
  const pass = result === "PASS";
  const fatalCount = scoreResult.questions.filter((q) => q.isFatalFail).length;
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const totalWeight = perCategory.reduce((sum, c) => sum + c.weight, 0);
  const dashOffset = RING_CIRCUMFERENCE * (1 - Math.min(Math.max(score, 0), 100) / 100);
  const scoreLabel = score.toFixed(2);
  const gradingBand = resolveScorecardBand(gradingScale, score, scoreResult.hasFatalFail);

  const rules: { tone: "rose"; title: string; desc: string }[] = [];
  if (fatalCount > 0) {
    rules.push({
      tone: "rose",
      title: t("Critical Failure"),
      desc:
        fatalCount === 1
          ? t("1 critical question failed")
          : t("{count} critical questions failed", { count: fatalCount }),
    });
  }
  if (!scoreResult.hasFatalFail && score < passThreshold) {
    rules.push({
      tone: "rose",
      title: t("Score Below Threshold"),
      desc: t("{score}% is below the {threshold}% threshold", {
        score: scoreLabel,
        threshold: passThreshold,
      }),
    });
  }

  const progressPct = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Score ring */}
      <div className="flex flex-col items-center rounded-xl border border-border bg-card p-5">
        <div className="relative grid place-items-center">
          <svg
            width="128"
            height="128"
            viewBox="0 0 128 128"
            className="-rotate-90"
            role="img"
            aria-label={t("Score {score} percent", { score: scoreLabel })}
          >
            <title>{`Score ${scoreLabel}%`}</title>
            <circle
              cx="64"
              cy="64"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="12"
              className="stroke-muted"
            />
            <circle
              cx="64"
              cy="64"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className={cn(
                "transition-all duration-500",
                pass ? "stroke-success" : "stroke-destructive",
              )}
            />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="font-heading text-3xl font-extrabold tabular-nums tracking-tight">
              {scoreLabel}
              <span className="text-lg">%</span>
            </span>
          </div>
        </div>
        <div
          className={cn(
            "mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold",
            pass ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
          )}
        >
          {pass ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {pass ? "PASS" : "FAIL"}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("PASS threshold: {threshold}%", { threshold: passThreshold })}
        </p>
        {gradingBand && (
          <p className="mt-2 rounded-md bg-muted px-2.5 py-1 text-center text-xs font-semibold text-foreground">
            {t(gradingBand.label)}
          </p>
        )}
      </div>

      {/* Per-category scores */}
      {perCategory.length > 0 && (
        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("Score by Category")}
          </p>
          {perCategory.map((cat) => {
            const info = cat.categoryId ? categoryById.get(cat.categoryId) : null;
            const weightPct = totalWeight > 0 ? (cat.weight / totalWeight) * 100 : 0;
            const earnedPct = totalWeight > 0 ? (cat.earned / totalWeight) * 100 : 0;
            const fillPct = cat.weight > 0 ? (cat.earned / cat.weight) * 100 : 0;
            const color = info?.color ?? undefined;
            return (
              <div key={cat.categoryId ?? "none"} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: color ?? "hsl(var(--primary))" }}
                    />
                    {info?.name ?? t("No category")}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {earnedPct.toFixed(0)}% / {weightPct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(fillPct, 100)}%`,
                      backgroundColor: color ?? "hsl(var(--primary))",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Activated rules */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Triggered Rules")}
        </p>
        {rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("No rules triggered.")}</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li key={rule.title} className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-destructive" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{rule.title}</p>
                  <p className="text-xs text-muted-foreground">{rule.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Progress */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">
            {t("Progress")}
          </span>
          <span className="tabular-nums font-medium text-foreground">
            {answeredQuestions} / {totalQuestions}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {blockers > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            {blockers === 1
              ? t("1 required comment")
              : t("{count} required comments", { count: blockers })}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <Button
          onClick={onSubmit}
          disabled={submitting || savingDraft || blockers > 0}
          className={cn("w-full gap-2", !pass && "bg-destructive hover:bg-destructive/90")}
        >
          <Send className="h-4 w-4" />
          {savingDraft
            ? t("Saving draft...")
            : submitting
              ? t("Saving...")
              : isEditing
                ? t("Save changes")
                : pass
                  ? t("Submit evaluation")
                  : t("Submit as FAIL")}
        </Button>
        <Button
          variant="outline"
          onClick={onCancel}
          className="w-full"
          disabled={submitting || savingDraft}
        >
          {t("Cancel")}
        </Button>
      </div>
    </div>
  );
}
