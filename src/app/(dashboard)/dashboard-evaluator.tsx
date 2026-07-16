"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ClipboardCheck, Scale, ShieldAlert, Target, TrendingUp } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ContextBar,
  DashboardSpinner,
  DistributionCard,
  EmptyState,
  Section,
} from "@/components/dashboard/dashboard-shared";
import {
  DataLoadError,
  type DataLoadStatus,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
import { getMyDashboard } from "@/server/queries/analytics";
import type { UiAccess } from "@/server/queries/ui-access";
import { cn } from "@/lib/utils";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { formatOperationalTimestamp } from "@/lib/date-display";

type MyDashboard = Awaited<ReturnType<typeof getMyDashboard>>;

export function DashboardEvaluator({
  userName,
  access,
  campaigns,
}: {
  userName: string;
  access: UiAccess;
  campaigns: { id: string; name: string }[];
}) {
  const operationalTimeZone = useOperationalTimeZone();
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const [data, setData] = useState<MyDashboard | null>(null);
  const requestGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    try {
      const result = await getMyDashboard(dateFrom || undefined, dateTo || undefined);
      if (requestId !== requestGeneration.current) return;
      setData(result);
      setLoadStatus("success");
    } catch (e) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(e, "dashboard-evaluator");
      setLoadStatus("error");
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  if (loadStatus === "loading" && !data) return <DashboardSpinner />;
  if (loadStatus === "error") {
    return <DataLoadError onRetry={() => void loadData()} title="No pudimos cargar tu dashboard" />;
  }
  if (!data) {
    return <DataLoadError onRetry={() => void loadData()} title="No pudimos cargar tu dashboard" />;
  }

  const countTrend = data.trend.map((t) => ({ value: t.count }));
  const canOpenReports = access.canViewReports;

  const consistencyOk = data.stdDev <= data.calibrationTolerance;

  return (
    <div className="space-y-6">
      <ContextBar
        title="Mi trabajo"
        subtitle={
          <>
            Bienvenido de vuelta,{" "}
            <span className="font-medium text-foreground">{userName}</span>
          </>
        }
        icon={ClipboardCheck}
        campaigns={campaigns}
        campaignId=""
        onCampaignChange={() => {}}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onApplyDates={(f, t) => {
          setDateFrom(f);
          setDateTo(t);
        }}
      />

      {/* Self-scoped KPI row (neutral labels — descriptive, not a judgment) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Evaluaciones" value={data.evaluations} icon={ClipboardCheck} tone="orange" trend={countTrend} index={0} />
        <KpiCard label="Tasa diaria" value={data.dailyRate} decimals={1} icon={Calendar} tone="navy" index={1} />
        <KpiCard label="Fatales" value={data.fatalCount} icon={ShieldAlert} tone="navy" index={2} />
        <KpiCard label="Score promedio" value={data.avgScore} decimals={1} suffix="%" icon={TrendingUp} tone="navy" index={3} />
      </div>

      {/* Distribution + personal consistency */}
      <Section delay={0.1}>
        <div className="grid gap-6 lg:grid-cols-2">
          <DistributionCard title="Distribución de scores" data={data.distribution} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-violet-500" />
                Consistencia personal
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.evaluations === 0 ? (
                <EmptyState label="Sin datos para calibrar" />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Muestra personal
                  </p>
                  <p className="mt-1 font-heading text-3xl font-bold tabular-nums">
                    {data.evaluations}
                  </p>
                  <p className="text-sm font-semibold text-foreground">evaluaciones</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Calculado únicamente con tu actividad
                  </p>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Consistencia</p>
                  <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{data.stdDev.toFixed(1)}</p>
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      consistencyOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {consistencyOk ? "Dentro de tolerancia" : "Fuera de tolerancia"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    StdDev · tolerancia &lt; {data.calibrationTolerance}
                  </p>
                </div>
              </div>
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Recent activity + where to focus */}
      <Section delay={0.16}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actividad reciente</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recentActivity.length > 0 ? (
                <div className="space-y-2">
                  {data.recentActivity.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      disabled={!canOpenReports}
                      onClick={canOpenReports ? () => router.push(`/analytics/responses/${r.id}`) : undefined}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 p-3 text-left",
                        canOpenReports ? "cursor-pointer transition-colors hover:bg-muted/40" : "cursor-default",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.agentName}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.formTitle}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={r.result === "PASS" ? "default" : "destructive"} className="tabular-nums">
                          {r.score.toFixed(1)}%
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatOperationalTimestamp(r.createdAt, operationalTimeZone, {
                            dateStyle: "short",
                          })}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState label="Sin evaluaciones en el periodo" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-orange-500" />
                Dónde enfocar según mis evaluaciones
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.agentsBelowTarget.length > 0 ? (
                <div className="space-y-2">
                  {data.agentsBelowTarget.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{a.campaignName}</p>
                      </div>
                      <Badge variant="destructive" className="tabular-nums">
                        {a.avgScore.toFixed(1)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState label="Sin agentes bajo objetivo" />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>
    </div>
  );
}
