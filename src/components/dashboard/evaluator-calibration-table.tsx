"use client";

import { Scale } from "lucide-react";
import { EmptyState } from "@/components/dashboard/dashboard-shared";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type EvaluatorRow = {
  id: string;
  name: string;
  totalEvaluations: number;
  avgScore: number;
  stdDev: number;
};

const TOLERANCE = 5; // pts vs team average

function calibrationStatus(delta: number) {
  if (delta > TOLERANCE) return { label: "Lenient", cls: "text-amber-600 dark:text-amber-400" };
  if (delta < -TOLERANCE) return { label: "Strict", cls: "text-rose-600 dark:text-rose-400" };
  return { label: "In range", cls: "text-muted-foreground" };
}

export function EvaluatorCalibrationTable({
  evaluators,
  teamAvg,
  interactive,
  onNavigate,
  limit = 10,
}: {
  evaluators: EvaluatorRow[];
  teamAvg: number;
  interactive: boolean;
  onNavigate: (href: string) => void;
  limit?: number;
}) {
  const { t } = useI18n();
  const rows = evaluators.slice(0, limit);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-violet-500" />
          {t("Evaluator calibration")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1.6fr_repeat(4,0.7fr)] border-b pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>{t("Evaluator")}</span>
              <span className="text-center">{t("Evals")}</span>
              <span className="text-center">{t("Score")}</span>
              <span className="text-center">{t("StdDev")}</span>
              <span className="text-center">{t("Delta")}</span>
            </div>
            {rows.map((e) => {
              const delta = Math.round((e.avgScore - teamAvg) * 10) / 10;
              const status = calibrationStatus(delta);
              const hasCalibrationSample = e.totalEvaluations >= 5;
              return (
                <button
                  type="button"
                  key={e.id}
                  disabled={!interactive}
                  onClick={
                    interactive ? () => onNavigate(`/analytics/evaluators/${e.id}`) : undefined
                  }
                  className={cn(
                    "grid w-full grid-cols-[1.6fr_repeat(4,0.7fr)] items-center rounded-lg border border-border/60 px-3 py-2 text-left text-sm",
                    interactive
                      ? "cursor-pointer transition-colors hover:bg-muted/40"
                      : "cursor-default",
                  )}
                >
                  <span className="truncate font-medium">{e.name}</span>
                  <span className="text-center tabular-nums">{e.totalEvaluations}</span>
                  <div className="flex justify-center">
                    <Badge variant="outline" className="tabular-nums">
                      {e.avgScore.toFixed(1)}%
                    </Badge>
                  </div>
                  <span className="text-center text-xs tabular-nums text-muted-foreground">
                    {e.totalEvaluations >= 2 ? e.stdDev.toFixed(1) : "—"}
                  </span>
                  {hasCalibrationSample ? (
                    <span
                      className={cn("text-center text-xs font-semibold tabular-nums", status.cls)}
                    >
                      {delta >= 0 ? "+" : ""}
                      {delta.toFixed(1)}
                      <span className="ml-1 font-normal">{t(status.label)}</span>
                    </span>
                  ) : (
                    <span className="text-center text-xs text-muted-foreground">
                      {t("Insufficient sample")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState label={t("No active evaluators")} />
        )}
      </CardContent>
    </Card>
  );
}
