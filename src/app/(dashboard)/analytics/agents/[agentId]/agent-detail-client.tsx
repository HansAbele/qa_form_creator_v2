"use client";

import { ArrowLeft, BarChart3, ClipboardCheck, Hash, TrendingUp, User, Users } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  DataLoadError,
  type DataLoadStatus,
  RestrictedResourceState,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { KpiCard } from "@/components/ui/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useChartAnimation } from "@/components/ui/use-chart-animation";
import { summarizeChartData } from "@/lib/chart-accessibility";
import { formatDateOnlyForDisplay, formatOperationalTimestamp } from "@/lib/date-display";
import { getAgentDetail } from "@/server/queries/analytics";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScoreTrendPoint {
  date: string;
  avgScore: number;
}

interface QuestionScore {
  question: string;
  avgScore: number;
}

interface DispositionBreakdown {
  name: string;
  count: number;
  avgScore: number;
}

interface EvaluatorEntry {
  id: string;
  name: string;
  count: number;
  avgScore: number;
}

interface RecentResponse {
  id: string;
  formTitle: string;
  evaluatorName: string;
  dispositionName: string | null;
  score: number;
  result: "PASS" | "FAIL";
  submittedAt: string;
}

interface AgentDetailData {
  name: string;
  agentCode: string | null;
  campaignName: string;
  teamName: string | null;
  totalEvaluations: number;
  avgScore: number;
  passThreshold: number;
  scoreTrend: ScoreTrendPoint[];
  scoreByQuestion: QuestionScore[];
  dispositionBreakdown: DispositionBreakdown[];
  evaluators: EvaluatorEntry[];
  recentResponses: RecentResponse[];
}

// ─── Chart configs ───────────────────────────────────────────────────────────

const trendConfig = {
  avgScore: { label: "Score Promedio", color: "#1a2b45" },
} satisfies ChartConfig;

const questionConfig = {
  avgScore: { label: "Score Promedio", color: "#ff6600" },
} satisfies ChartConfig;

const dispositionConfig = {
  count: { label: "Evaluaciones", color: "#06b6d4" },
} satisfies ChartConfig;

const evaluatorConfig = {
  count: { label: "Evaluaciones", color: "#8b5cf6" },
} satisfies ChartConfig;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resultBadgeVariant(result: "PASS" | "FAIL"): "default" | "destructive" {
  return result === "PASS" ? "default" : "destructive";
}

function getQuestionBarColor(score: number, passThreshold: number): string {
  if (score >= passThreshold) return "#10b981";
  if (score >= passThreshold * 0.7) return "#f59e0b";
  return "#f43f5e";
}

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
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[340px] rounded-xl" />
        <Skeleton className="h-[340px] rounded-xl" />
      </div>
      <Skeleton className="h-[300px] rounded-xl" />
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

export function AgentDetailClient({ agentId }: { agentId: string }) {
  const chartAnimation = useChartAnimation();
  const operationalTimeZone = useOperationalTimeZone();
  const router = useRouter();
  const [data, setData] = useState<AgentDetailData | null>(null);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const requestGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    try {
      const result = await getAgentDetail(agentId, dateFrom || undefined, dateTo || undefined);
      if (requestId !== requestGeneration.current) return;
      setData(result);
      setLoadStatus(result ? "success" : "empty");
    } catch (e) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(e, "agent-detail");
      setLoadStatus("error");
    }
  }, [agentId, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  if (loadStatus === "loading" && !data) return <LoadingSkeleton />;
  if (loadStatus === "error") {
    return <DataLoadError onRetry={() => void loadData()} title="No pudimos cargar el agente" />;
  }
  if (loadStatus === "empty" || !data) {
    return <RestrictedResourceState resourceLabel="El agente" />;
  }

  const scoreTrendSpark = data.scoreTrend.map((t) => ({ value: t.avgScore }));

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
                    {data.agentCode && (
                      <Badge variant="outline" className="gap-1">
                        <Hash className="h-3 w-3" />
                        {data.agentCode}
                      </Badge>
                    )}
                    <Badge variant="secondary">{data.campaignName}</Badge>
                    {data.teamName && (
                      <Badge variant="secondary" className="gap-1">
                        <Users className="h-3 w-3" />
                        {data.teamName}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Date range filters */}
              <DateRangeFilter
                id="agent-detail-date-range"
                label="Periodo"
                from={dateFrom}
                to={dateTo}
                onApply={(from, to) => {
                  setDateFrom(from);
                  setDateTo(to);
                }}
                className="w-full sm:w-56"
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          label="Total Evaluaciones"
          value={data.totalEvaluations}
          icon={ClipboardCheck}
          tone="orange"
          trend={scoreTrendSpark}
          index={0}
        />
        <KpiCard
          label="Score Promedio"
          value={data.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={
            data.avgScore >= data.passThreshold
              ? "emerald"
              : data.avgScore >= data.passThreshold * 0.7
                ? "amber"
                : "rose"
          }
          index={1}
        />
      </div>

      {/* ─── Score Trend + Score by Question ────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Score Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                Tendencia de Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.scoreTrend.length > 1 ? (
                <ChartContainer
                  config={trendConfig}
                  accessibilityLabel="Tendencia del score promedio del agente por fecha"
                  accessibilityDescription={summarizeChartData(
                    data.scoreTrend.map(
                      (point) =>
                        `${formatDateOnlyForDisplay(point.date)}: ${point.avgScore.toFixed(1)}%`,
                    ),
                  )}
                  className="h-[280px] w-full"
                >
                  <LineChart data={data.scoreTrend}>
                    <defs>
                      <linearGradient id="agentScoreTrendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1a2b45" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#1a2b45" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
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
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      className="text-xs"
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          indicator="line"
                          labelFormatter={(label) => formatDateOnlyForDisplay(String(label))}
                          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                        />
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="avgScore"
                      stroke="#1a2b45"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#1a2b45" }}
                      activeDot={{ r: 5 }}
                      animationDuration={1000}
                      isAnimationActive={chartAnimation}
                    />
                  </LineChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Se necesitan al menos 2 puntos de datos" />
              )}
            </CardContent>
          </Card>

          {/* Score by Question (horizontal bar, weakest first) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-4 w-4 text-orange-500" />
                Score por Pregunta
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.scoreByQuestion.length > 0 ? (
                <ChartContainer
                  config={questionConfig}
                  accessibilityLabel="Score promedio del agente por pregunta"
                  accessibilityDescription={summarizeChartData(
                    data.scoreByQuestion.map(
                      (question) => `${question.question}: ${question.avgScore.toFixed(1)}%`,
                    ),
                  )}
                  className="h-[280px] w-full"
                >
                  <BarChart
                    data={data.scoreByQuestion}
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
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      className="text-xs"
                    />
                    <YAxis
                      type="category"
                      dataKey="question"
                      tickLine={false}
                      axisLine={false}
                      width={120}
                      className="text-xs"
                      tickFormatter={(v) =>
                        String(v).length > 18 ? `${String(v).slice(0, 18)}...` : String(v)
                      }
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(255,102,0,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgScore"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      isAnimationActive={chartAnimation}
                    >
                      {data.scoreByQuestion.map((item) => (
                        <Cell
                          key={item.question}
                          fill={getQuestionBarColor(item.avgScore, data.passThreshold)}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin datos de preguntas" />
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* ─── Dispositions + Evaluators ────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2 * 0.08 }}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Dispositions (horizontal bar) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-cyan-500" />
                Disposiciones
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.dispositionBreakdown.length > 0 ? (
                <ChartContainer
                  config={dispositionConfig}
                  accessibilityLabel="Evaluaciones del agente por disposición"
                  accessibilityDescription={summarizeChartData(
                    data.dispositionBreakdown.map(
                      (disposition) =>
                        `${disposition.name}: ${disposition.count} evaluaciones, score promedio ${disposition.avgScore.toFixed(1)}%`,
                    ),
                  )}
                  className="h-[280px] w-full"
                >
                  <BarChart
                    data={data.dispositionBreakdown}
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
                          formatter={(value, _name, item) => {
                            const payload = item?.payload as { avgScore?: number } | undefined;
                            const avg = payload?.avgScore;
                            return [
                              `${value} evals${avg !== undefined ? ` | Avg: ${avg.toFixed(1)}%` : ""}`,
                              "Disposicion",
                            ];
                          }}
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

          {/* Evaluators (horizontal bar) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-violet-500" />
                Evaluadores
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.evaluators.length > 0 ? (
                <ChartContainer
                  config={evaluatorConfig}
                  accessibilityLabel="Evaluaciones del agente por evaluador"
                  accessibilityDescription={summarizeChartData(
                    data.evaluators.map(
                      (evaluator) =>
                        `${evaluator.name}: ${evaluator.count} evaluaciones, score promedio ${evaluator.avgScore.toFixed(1)}%`,
                    ),
                  )}
                  className="h-[280px] w-full"
                >
                  <BarChart
                    data={data.evaluators}
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
                              "Evaluador",
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
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin datos de evaluadores" />
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* ─── Recent Evaluations Table ──────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 3 * 0.08 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ultimas 10 Evaluaciones</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentResponses.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead>Formulario</TableHead>
                      <TableHead>Evaluador</TableHead>
                      <TableHead>Disposicion</TableHead>
                      <TableHead className="text-right">Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentResponses.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-center">
                          <Badge variant={resultBadgeVariant(r.result)} className="tabular-nums">
                            {r.score.toFixed(1)}% · {r.result}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate font-medium">
                          {r.formTitle}
                        </TableCell>
                        <TableCell>{r.evaluatorName}</TableCell>
                        <TableCell>
                          {r.dispositionName ? (
                            <Badge variant="outline">{r.dispositionName}</Badge>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {formatOperationalTimestamp(r.submittedAt, operationalTimeZone, {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState label="Sin evaluaciones registradas" />
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
