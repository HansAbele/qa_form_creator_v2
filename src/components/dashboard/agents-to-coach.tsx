"use client";

import { LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/dashboard-shared";

export type CoachAgent = {
  id: string;
  name: string;
  agentCode: string | null;
  avgScore: number;
  passRate: number;
  fatalFailCount: number;
  href: string;
};

export function AgentsToCoach({
  agents,
  targetAvgScore,
  interactive,
  onNavigate,
  limit = 5,
}: {
  agents: CoachAgent[];
  targetAvgScore: number;
  interactive: boolean;
  onNavigate: (href: string) => void;
  limit?: number;
}) {
  const rows = agents.slice(0, limit);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LifeBuoy className="h-4 w-4 text-rose-500" />
          Agentes a coachear
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <div className="space-y-1.5">
            {rows.map((a) => (
              <button
                type="button"
                key={a.id}
                disabled={!interactive}
                onClick={interactive ? () => onNavigate(a.href) : undefined}
                className={`flex w-full items-center gap-3 rounded-lg border border-border/60 px-3 py-2 text-left ${
                  interactive ? "cursor-pointer transition-colors hover:bg-muted/40" : "cursor-default"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  {a.agentCode && (
                    <p className="truncate text-xs text-muted-foreground">{a.agentCode}</p>
                  )}
                </div>
                <Badge
                  variant={a.avgScore >= targetAvgScore ? "default" : "destructive"}
                  className="tabular-nums"
                >
                  {a.avgScore.toFixed(1)}%
                </Badge>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {a.passRate}% pass
                </span>
                {a.fatalFailCount > 0 && (
                  <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-600 tabular-nums dark:text-rose-400">
                    {a.fatalFailCount} fatal
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <EmptyState label="Sin agentes bajo objetivo" />
        )}
      </CardContent>
    </Card>
  );
}
