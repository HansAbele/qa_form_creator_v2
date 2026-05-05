"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
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
import {
  ArrowLeft,
  Award,
  ClipboardCheck,
  Medal,
  TrendingUp,
  Users,
  UsersRound,
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
import { getTeamDetail } from "@/server/queries/analytics";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentRank {
  id: string;
  name: string;
  agentCode: string | null;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
}

interface ScoreTrendPoint {
  date: string;
  avgScore: number;
}

interface TeamDetailData {
  name: string;
  campaignName: string;
  agentCount: number;
  totalEvaluations: number;
  avgScore: number;
  agentRanking: AgentRank[];
  scoreTrend: ScoreTrendPoint[];
}

// ─── Chart configs ───────────────────────────────────────────────────────────

const trendConfig = {
  avgScore: { label: "Score Promedio", color: "#ff6600" },
} satisfies ChartConfig;

const rankingConfig = {
  avgScore: { label: "Score Promedio", color: "#8b5cf6" },
} satisfies ChartConfig;

const BAR_COLORS = ["#ff6600", "#1a2b45", "#10b981", "#f43f5e", "#8b5cf6"];

const MEDAL_COLORS = ["text-yellow-500", "text-gray-400", "text-amber-700"];
const MEDAL_BG = [
  "bg-yellow-500/10 border-yellow-500/30",
  "bg-gray-400/10 border-gray-400/30",
  "bg-amber-700/10 border-amber-700/30",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

function passRateBadgeColor(rate: number): string {
  if (rate >= 80) return "text-emerald-600";
  if (rate >= 50) return "text-amber-600";
  return "text-rose-600";
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-20" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-[340px] rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[380px] rounded-xl" />
        <Skeleton className="h-[380px] rounded-xl" />
      </div>
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

export function TeamDetailClient({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [data, setData] = useState<TeamDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getTeamDetail(
        teamId,
        dateFrom || undefined,
        dateTo || undefined,
      );
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [teamId, dateFrom, dateTo]);

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
  if (!data) return <EmptyState label="Equipo no encontrado" />;

  const scoreTrendSpark = data.scoreTrend.map((t) => ({ value: t.avgScore }));

  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="mb-3 -ml-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Volver
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <UsersRound className="h-5 w-5 text-violet-500" />
              <h1 className="font-heading text-3xl font-bold tracking-tight">
                {data.name}
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Campana:{" "}
              <span className="font-medium text-foreground">
                {data.campaignName}
              </span>
            </p>
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
      </motion.div>

      {/* ─── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Agentes"
          value={data.agentCount}
          icon={Users}
          tone="violet"
          index={0}
        />
        <KpiCard
          label="Evaluaciones"
          value={data.totalEvaluations}
          icon={ClipboardCheck}
          tone="orange"
          trend={scoreTrendSpark}
          index={1}
        />
        <KpiCard
          label="Score Promedio"
          value={data.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={data.avgScore >= 70 ? "emerald" : data.avgScore >= 50 ? "amber" : "rose"}
          index={2}
        />
      </div>

      {/* ─── Team Score Trend ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              Score Trend del Equipo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreTrend.length > 1 ? (
              <ChartContainer config={trendConfig} className="h-[300px] w-full">
                <LineChart data={data.scoreTrend}>
                  <defs>
                    <linearGradient id="teamTrendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ff6600" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ff6600" stopOpacity={0} />
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
                    stroke="#ff6600"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#ff6600" }}
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
      </motion.div>

      {/* ─── Agent Ranking (table) + Agent Comparison (bar chart) ──────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2 * 0.08 }}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Agent Ranking Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Medal className="h-4 w-4 text-yellow-500" />
                Ranking de Agentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.agentRanking.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[2rem_1fr_4.5rem_4.5rem_4.5rem] gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
                    <span>#</span>
                    <span>Agente</span>
                    <span className="text-center">Score</span>
                    <span className="text-center">Pass</span>
                    <span className="text-center">Evals</span>
                  </div>
                  <AnimatePresence>
                    {data.agentRanking.map((agent, i) => (
                      <motion.div
                        key={agent.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.3 }}
                        className={`grid cursor-pointer grid-cols-[2rem_1fr_4.5rem_4.5rem_4.5rem] items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/40 ${
                          i < 3
                            ? `${MEDAL_BG[i]} border-opacity-60`
                            : "border-border/60"
                        }`}
                        onClick={() =>
                          router.push(`/analytics/agents/${agent.id}`)
                        }
                      >
                        {/* Rank */}
                        <div className="flex items-center justify-center">
                          {i < 3 ? (
                            <Medal className={`h-5 w-5 ${MEDAL_COLORS[i]}`} />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {i + 1}
                            </span>
                          )}
                        </div>

                        {/* Name */}
                        <span className="truncate font-medium">
                          {agent.name}
                        </span>

                        {/* Score */}
                        <div className="flex justify-center">
                          <Badge
                            variant={scoreBadgeVariant(agent.avgScore)}
                            className="tabular-nums text-xs"
                          >
                            {agent.avgScore.toFixed(1)}%
                          </Badge>
                        </div>

                        {/* Pass Rate */}
                        <span className={`text-center text-xs tabular-nums ${passRateBadgeColor(agent.passRate)}`}>
                          {agent.passRate}%
                        </span>

                        {/* Eval Count */}
                        <span className="text-center text-xs tabular-nums text-muted-foreground">
                          {agent.totalEvaluations}
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <EmptyState label="Sin evaluaciones de agentes" />
              )}
            </CardContent>
          </Card>

          {/* Ranking Bar Chart (horizontal, clickable) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4 text-violet-500" />
                Ranking de Agentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.agentRanking.length > 0 ? (
                <ChartContainer
                  config={rankingConfig}
                  className="h-[300px] w-full"
                >
                  <BarChart
                    data={data.agentRanking}
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
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={100}
                      className="text-xs"
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(139,92,246,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [
                            `${Number(value).toFixed(1)}%`,
                            "Score",
                          ]}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgScore"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      className="cursor-pointer"
                      onClick={(barData) => {
                        if (barData?.id)
                          router.push(`/analytics/agents/${barData.id}`);
                      }}
                    >
                      {data.agentRanking.map((_, i) => (
                        <Cell
                          key={`bar-${i}`}
                          fill={BAR_COLORS[i % BAR_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin agentes con evaluaciones" />
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
