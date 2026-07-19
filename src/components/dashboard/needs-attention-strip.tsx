"use client";

import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Severity = "CRITICAL" | "WARNING" | "INFO";

export type CoachingInsights = {
  agentRisks: { id: string; name: string; reason: string; severity: Severity; href: string }[];
  categoryOpportunities: { id: string; name: string; reason: string; severity: Severity }[];
  campaignRisks: {
    id: string;
    name: string;
    missedTargets: string[];
    severity: Severity;
  }[];
};

type Chip = {
  key: string;
  type: "CAMPAIGN" | "AGENT" | "CATEGORY";
  text: string;
  severity: Severity;
  onClick?: () => void;
};

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

function localizeSystemReason(reason: string, locale: "en" | "es") {
  if (locale !== "es") return reason;

  return reason
    .split(" · ")
    .map((part) => {
      const criticalFailures = part.match(/^(\d+) critical (failure|failures)$/);
      if (criticalFailures) {
        const count = Number(criticalFailures[1]);
        return `${count} ${count === 1 ? "falla crítica" : "fallas críticas"}`;
      }

      const scoreGap = part.match(/^([\d.]+) pts below the score target$/);
      if (scoreGap) return `${scoreGap[1]} pts por debajo del objetivo de puntuación`;

      const passRateGap = part.match(/^([\d.]+) pts below the pass-rate target$/);
      if (passRateGap) return `${passRateGap[1]} pts por debajo del objetivo de aprobación`;

      const recentTrend = part.match(/^recent trend (-?[\d.]+) pts$/);
      if (recentTrend) return `tendencia reciente ${recentTrend[1]} pts`;

      const categoryGap = part.match(/^([\d.]+) pts below target across (\d+) (agent|agents)$/);
      if (categoryGap) {
        const count = Number(categoryGap[2]);
        return `${categoryGap[1]} pts por debajo del objetivo en ${count} ${count === 1 ? "agente" : "agentes"}`;
      }

      return part === "Within target" ? "Dentro del objetivo" : part;
    })
    .join(" · ");
}

function localizeMissedTarget(target: string, locale: "en" | "es") {
  if (locale !== "es") return target;
  if (target === "daily volume") return "volumen diario";
  if (target === "critical failures") return "fallas críticas";
  if (target === "pass rate") return "tasa de aprobación";
  if (target === "score") return "puntuación";
  return target;
}

export function NeedsAttentionStrip({
  insights,
  onNavigate,
  onSelectCampaign,
  limit = 4,
}: {
  insights: CoachingInsights;
  onNavigate: (href: string) => void;
  onSelectCampaign: (id: string) => void;
  limit?: number;
}) {
  const { locale, t } = useI18n();
  const chips: Chip[] = [
    ...insights.campaignRisks.map((c) => ({
      key: `c-${c.id}`,
      type: "CAMPAIGN" as const,
      text: t("{name} — {targets} below target", {
        name: c.name,
        targets: c.missedTargets.map((target) => localizeMissedTarget(target, locale)).join(", "),
      }),
      severity: c.severity,
      onClick: () => onSelectCampaign(c.id),
    })),
    ...insights.agentRisks.map((a) => ({
      key: `a-${a.id}`,
      type: "AGENT" as const,
      text: `${a.name} — ${localizeSystemReason(a.reason, locale)}`,
      severity: a.severity,
      onClick: () => onNavigate(a.href),
    })),
    ...insights.categoryOpportunities.map((cat) => ({
      key: `cat-${cat.id}`,
      type: "CATEGORY" as const,
      text: `${cat.name} — ${localizeSystemReason(cat.reason, locale)}`,
      severity: cat.severity,
    })),
  ]
    .filter((chip) => chip.severity !== "INFO")
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, limit);

  if (chips.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {t("Needs attention")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          {chips.map((chip) => {
            const critical = chip.severity === "CRITICAL";
            const Comp = chip.onClick ? "button" : "div";
            return (
              <Comp
                key={chip.key}
                type={chip.onClick ? "button" : undefined}
                onClick={chip.onClick}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg border border-l-4 px-3 py-2.5 text-left",
                  critical
                    ? "border-l-rose-500 bg-rose-500/5"
                    : "border-l-amber-500 bg-amber-500/5",
                  chip.onClick && "transition-colors hover:bg-muted/40",
                )}
              >
                <span className="text-sm">{chip.text}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(chip.type)}
                </span>
              </Comp>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
