"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "motion/react";
import {
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  Hash,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/ui/kpi-card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  createdAt: string;
}

interface AgentDetailData {
  name: string;
  agentCode: string | null;
  campaignName: string;
  teamName: string | null;
  totalEvaluations: number;
  avgScore: number;
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

function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

function getQuestionBarColor(score: number): string {
  if (score >= 70) return "#10b981";
  if (score >= 50) return "#f59e0b";
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
  const router = useRouter();
  const [data, setData] = useState<AgentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAgentDetail(
        agentId,
        dateFrom || undefined,
        dateTo || undefined,
      );
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [agentId, dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setQuickRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  };

  if (loading && !data) return <LoadingSkeleton />;
  if (!data) return <EmptyState label="Agente no encontrado" />;

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
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex gap-1">
                  {[7, 30, 90].map((d) => (
                    <Button
                      key={d}
                      variant="outline"
                      size="sm"
                      onClick={() => setQuickRange(d)}
                    >
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
                    <Label className="text-xs">Desde</Label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="h-8 w-36"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Hasta</Label>
                    <Input
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
          tone={data.avgScore >= 70 ? "emerald" : data.avgScore >= 50 ? "amber" : "rose"}
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
                <ChartContainer config={trendConfig} className="h-[280px] w-full">
                  <LineChart data={data.scoreTrend}>
                    <defs>
                      <linearGradient id="agentScoreTrendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1a2b45" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#1a2b45" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(v) => String(v).slice(5)}
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
                          formatter={(value) => [
                            `${Number(value).toFixed(1)}%`,
                            "Score",
                          ]}
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
                <ChartContainer config={questionConfig} className="h-[280px] w-full">
                  <BarChart
                    data={data.scoreByQuestion}
                    layout="vertical"
                    margin={{ left: 20, right: 12 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
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
                    <Bar dataKey="avgScore" radius={[0, 6, 6, 0]} animationDuration={900}>
                      {data.scoreByQuestion.map((item, i) => (
                        <Cell key={i} fill={getQuestionBarColor(item.avgScore)} />
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
                <ChartContainer config={dispositionConfig} className="h-[280px] w-full">
                  <BarChart
                    data={data.dispositionBreakdown}
                    layout="vertical"
                    margin={{ left: 20, right: 12 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
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
                            const payload = item?.payload as
                              | { avgScore?: number }
                              | undefined;
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
                <ChartContainer config={evaluatorConfig} className="h-[280px] w-full">
                  <BarChart
                    data={data.evaluators}
                    layout="vertical"
                    margin={{ left: 20, right: 12 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
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
                            const payload = item?.payload as
                              | { avgScore?: number }
                              | undefined;
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
                          <Badge
                            variant={scoreBadgeVariant(r.score)}
                            className="tabular-nums"
                          >
                            {r.score.toFixed(1)}%
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
                          {new Date(r.createdAt).toLocaleDateString("es-ES", {
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
