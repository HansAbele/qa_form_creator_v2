"use client";

import { AlertTriangle } from "lucide-react";
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
  type: "CAMPAÑA" | "AGENTE" | "CATEGORÍA";
  text: string;
  severity: Severity;
  onClick?: () => void;
};

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

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
  const chips: Chip[] = [
    ...insights.campaignRisks.map((c) => ({
      key: `c-${c.id}`,
      type: "CAMPAÑA" as const,
      text: `${c.name} — ${c.missedTargets.join(", ")} bajo objetivo`,
      severity: c.severity,
      onClick: () => onSelectCampaign(c.id),
    })),
    ...insights.agentRisks.map((a) => ({
      key: `a-${a.id}`,
      type: "AGENTE" as const,
      text: `${a.name} — ${a.reason}`,
      severity: a.severity,
      onClick: () => onNavigate(a.href),
    })),
    ...insights.categoryOpportunities.map((cat) => ({
      key: `cat-${cat.id}`,
      type: "CATEGORÍA" as const,
      text: `${cat.name} — ${cat.reason}`,
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
          Necesita atención
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
                  {chip.type}
                </span>
              </Comp>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
