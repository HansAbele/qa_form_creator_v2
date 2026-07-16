"use client";

import {
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  Shield,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  DataLoadError,
  type DataLoadStatus,
  RestrictedResourceState,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
import {
  addOperationalCalendarDays,
  formatOperationalDate,
  useOperationalTimeZone,
} from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/ui/kpi-card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartAnimation } from "@/components/ui/use-chart-animation";
import { summarizeChartData } from "@/lib/chart-accessibility";
import { formatDateOnlyForDisplay } from "@/lib/date-display";
import { getEvaluatorDetail } from "@/server/queries/analytics";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActivityDay {
  date: string;
  count: number;
}

interface AgentEvaluated {
  id: string;
  name: string;
  count: number;
  totalScore: number;
  avgScore: number;
}

interface DispositionFreq {
  name: string;
  count: number;
}

interface EvaluatorDetailData {
  name: string;
  email: string | null;
  role: string;
  totalEvaluations: number;
  avgScore: number;
  globalAvgScore: number;
  calibrationDelta: number;
  activityByDay: ActivityDay[];
  agentsEvaluated: AgentEvaluated[];
  dispositionFrequency: DispositionFreq[];
}

// ─── Chart configs ───────────────────────────────────────────────────────────

const activityConfig = {
  count: { label: "Evaluaciones", color: "#ff6600" },
} satisfies ChartConfig;

const agentConfig = {
  count: { label: "Evaluaciones", color: "#8b5cf6" },
} satisfies ChartConfig;

const dispositionConfig = {
  count: { label: "Evaluaciones", color: "#06b6d4" },
} satisfies ChartConfig;

// ─── Skeleton ────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-20" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[340px] rounded-xl" />
        <Skeleton className="h-[340px] rounded-xl" />
      </div>
      <Skeleton className="h-[340px] rounded-xl" />
    </div>
  );
}

function EmptyState({ label = "Sin datos" }: { label?: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function EvaluatorDetailClient({ userId }: { userId: string }) {
  const chartAnimation = useChartAnimation();
  const operationalTimeZone = useOperationalTimeZone();
  const router = useRouter();
  const [data, setData] = useState<EvaluatorDetailData | null>(null);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const requestGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    try {
      const result = await getEvaluatorDetail(userId, dateFrom || undefined, dateTo || undefined);
      if (requestId !== requestGeneration.current) return;
      setData(result);
      setLoadStatus(result ? "success" : "empty");
    } catch (e) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(e, "evaluator-detail");
      setLoadStatus("error");
    }
  }, [userId, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  const setQuickRange = (days: number) => {
    const to = formatOperationalDate(new Date(), operationalTimeZone);
    setDateFrom(addOperationalCalendarDays(to, -(days - 1)));
    setDateTo(to);
  };

  if (loadStatus === "loading" && !data) return <LoadingSkeleton />;
  if (loadStatus === "error") {
    return <DataLoadError onRetry={() => void loadData()} title="No pudimos cargar el evaluador" />;
  }
  if (loadStatus === "empty" || !data) {
    return <RestrictedResourceState resourceLabel="El evaluador" />;
  }

  const activitySpark = data.activityByDay.map((d) => ({ value: d.count }));
  const calibrationDelta = data.calibrationDelta;

  return (
    <div className="space-y-6">
      {/* ─── Back button + Header ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="mb-4 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>

        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 ring-1 ring-orange-500/20">
                  <User className="h-7 w-7 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {data.email ? <span>{data.email}</span> : null}
                    <Badge variant="secondary" className="gap-1">
                      <Shield className="h-3 w-3" />
                      {data.role === "ADMIN" ? "QA Manager" : "QA"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Date range filters */}
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex gap-1">
                  {[7, 30, 90].map((d) => (
                    <Button key={d} variant="outline" size="sm" onClick={() => setQuickRange(d)}>
                      {d}d
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDateFrom("");
                      setDateTo("");
                    }}
                  >
                    Todo
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <Label htmlFor="evaluator-detail-date-from" className="text-xs">
                      Desde
                    </Label>
                    <Input
                      id="evaluator-detail-date-from"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="h-8 w-36"
                    />
                  </div>
                  <div>
                    <Label htmlFor="evaluator-detail-date-to" className="text-xs">
                      Hasta
                    </Label>
                    <Input
                      id="evaluator-detail-date-to"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="h-8 w-36"
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Total Evaluaciones"
          value={data.totalEvaluations}
          icon={ClipboardCheck}
          tone="orange"
          trend={activitySpark}
          index={0}
        />
        <KpiCard
          label="Score Promedio"
          value={data.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={data.avgScore >= 70 ? "emerald" : data.avgScore >= 50 ? "amber" : "rose"}
          index={1}
        />
        <KpiCard
          label="Calibracion"
          value={Math.abs(calibrationDelta)}
          decimals={1}
          prefix={calibrationDelta >= 0 ? "+" : "-"}
          suffix=" pts"
          icon={BarChart3}
          tone={
            Math.abs(calibrationDelta) <= 5
              ? "emerald"
              : Math.abs(calibrationDelta) <= 10
                ? "amber"
                : "rose"
          }
          index={2}
        />
      </div>

      {/* ─── Activity by Day ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4 text-orange-500" />
              Actividad por Dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.activityByDay.length > 0 ? (
              <ChartContainer
                config={activityConfig}
                accessibilityLabel="Actividad del evaluador por día"
                accessibilityDescription={summarizeChartData(
                  data.activityByDay.map(
                    (point) =>
                      `${formatDateOnlyForDisplay(point.date)}: ${point.count} evaluaciones`,
                  ),
                )}
                className="h-[280px] w-full"
              >
                <BarChart data={data.activityByDay}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(v) =>
                      formatDateOnlyForDisplay(String(v), { day: "2-digit", month: "short" })
                    }
                    className="text-xs"
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    className="text-xs"
                  />
                  <ChartTooltip
                    cursor={{ fill: "rgba(255,102,0,0.08)" }}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(label) => formatDateOnlyForDisplay(String(label))}
                        formatter={(value) => [`${value} evaluaciones`, "Cantidad"]}
                      />
                    }
                  />
                  <Bar
                    dataKey="count"
                    fill="#ff6600"
                    radius={[4, 4, 0, 0]}
                    animationDuration={900}
                    isAnimationActive={chartAnimation}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState label="Sin actividad registrada" />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── Agents Evaluated + Disposition Frequency ──────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2 * 0.08 }}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Agents Evaluated (horizontal bar, clickable, top 10) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-violet-500" />
                Agentes Evaluados
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.agentsEvaluated.length > 0 ? (
                <ChartContainer
                  config={agentConfig}
                  accessibilityLabel="Evaluaciones realizadas por agente"
                  accessibilityDescription={summarizeChartData(
                    data.agentsEvaluated
                      .slice(0, 10)
                      .map(
                        (agent) =>
                          `${agent.name}: ${agent.count} evaluaciones, score promedio ${agent.avgScore.toFixed(1)}%`,
                      ),
                  )}
                  className="h-[280px] w-full"
                >
                  <BarChart
                    data={data.agentsEvaluated.slice(0, 10)}
                    layout="vertical"
                    margin={{ left: 20, right: 12 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      className="text-xs"
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={90}
                      className="text-xs"
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(139,92,246,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value, _name, item) => {
                            const payload = item?.payload as { avgScore?: number } | undefined;
                            const avg = payload?.avgScore;
                            return [
                              `${value} evals${avg !== undefined ? ` | Avg: ${avg.toFixed(1)}%` : ""}`,
                              "Agente",
                            ];
                          }}
                        />
                      }
                    />
                    <Bar
                      dataKey="count"
                      fill="#8b5cf6"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      isAnimationActive={chartAnimation}
                    >
                      {data.agentsEvaluated.slice(0, 10).map((entry) => (
                        <Cell
                          key={entry.id}
                          cursor="pointer"
                          onClick={() => router.push(`/analytics/agents/${entry.id}`)}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin agentes evaluados" />
              )}
            </CardContent>
          </Card>

          {/* Disposition Frequency (horizontal bar) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-cyan-500" />
                Disposiciones Frecuentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.dispositionFrequency.length > 0 ? (
                <ChartContainer
                  config={dispositionConfig}
                  accessibilityLabel="Evaluaciones realizadas por disposición"
                  accessibilityDescription={summarizeChartData(
                    data.dispositionFrequency.map(
                      (disposition) => `${disposition.name}: ${disposition.count} evaluaciones`,
                    ),
                  )}
                  className="h-[280px] w-full"
                >
                  <BarChart
                    data={data.dispositionFrequency}
                    layout="vertical"
                    margin={{ left: 20, right: 12 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      className="text-xs"
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={100}
                      className="text-xs"
                      tickFormatter={(v) =>
                        String(v).length > 15 ? `${String(v).slice(0, 15)}...` : String(v)
                      }
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(6,182,212,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${value} evaluaciones`, "Cantidad"]}
                        />
                      }
                    />
                    <Bar
                      dataKey="count"
                      fill="#06b6d4"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      isAnimationActive={chartAnimation}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin disposiciones registradas" />
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
