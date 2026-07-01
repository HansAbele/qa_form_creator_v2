"use client";

import { agentTint, getInitials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

export interface AgentLeaderboardRow {
  id: string;
  name: string;
  count: number;
}

interface AgentLeaderboardProps {
  rows: AgentLeaderboardRow[];
  interactive?: boolean;
  onRowClick?: (id: string) => void;
}

/**
 * Horizontal ranking (leaderboard) for "Evaluaciones por Agente".
 * Single brand accent on the data bar; color variety lives on the avatars
 * (identity, not data). Rows sorted by volume desc by the caller.
 */
export function AgentLeaderboard({ rows, interactive = false, onRowClick }: AgentLeaderboardProps) {
  if (rows.length === 0) return <LeaderboardSkeleton />;

  const max = Math.max(...rows.map((r) => r.count), 1);
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Top {rows.length} por volumen ·{" "}
        <span className="font-heading font-bold tabular-nums text-foreground">{total}</span>{" "}
        evaluaciones
      </p>
      <ul className="space-y-1.5">
        {rows.map((row, i) => {
          const tint = agentTint(row.id || row.name);
          const pct = Math.max((row.count / max) * 100, 4);
          const isTop = i === 0;
          return (
            <li key={row.id}>
              <button
                type="button"
                disabled={!interactive}
                onClick={interactive ? () => onRowClick?.(row.id) : undefined}
                aria-label={`${row.name}: ${row.count} evaluaciones`}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors",
                  interactive ? "cursor-pointer hover:bg-muted/60" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "w-6 shrink-0 text-right font-heading text-[13px] font-bold tabular-nums",
                    isTop ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  #{i + 1}
                </span>
                <span
                  className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] font-heading text-[12.5px] font-extrabold"
                  style={{ backgroundColor: tint.bg, color: tint.fg }}
                  aria-hidden
                >
                  {getInitials(row.name)}
                </span>
                <span className="w-[132px] shrink-0 truncate text-[13.5px] font-semibold text-foreground">
                  {row.name}
                </span>
                <span className="relative h-[26px] flex-1 overflow-hidden rounded-lg bg-muted">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-lg transition-[filter]",
                      isTop ? "bg-gradient-to-r from-brand-strong to-primary" : "bg-primary",
                      interactive && "group-hover:brightness-110",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="shrink-0 whitespace-nowrap font-heading text-[15px] font-bold tabular-nums text-foreground">
                  {row.count}
                  <span className="ml-1 text-[11px] font-medium text-muted-foreground">evals</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 8 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={i} className="flex items-center gap-3 px-2 py-1.5">
          <span className="w-6 shrink-0" />
          <span className="h-[34px] w-[34px] shrink-0 animate-pulse rounded-[10px] bg-muted" />
          <span className="h-3 w-[132px] shrink-0 animate-pulse rounded bg-muted" />
          <span className="h-[26px] flex-1 animate-pulse rounded-lg bg-muted" />
          <span className="h-4 w-12 shrink-0 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
