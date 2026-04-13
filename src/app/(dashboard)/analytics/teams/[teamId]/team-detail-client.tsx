"use client";

import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
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
import { KpiCard } from "@/components/ui/kpi-card";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentRank {
  id: string;
  name: string;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
}

interface ScoreTrendPoint {
  date: string;
  avgScore: number;
  count: number;
}

interface TeamDetailData {
  id: string;
  name: string;
  campaignName: string;
  campaignId: string;
  agentCount: number;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
  passThreshold: number;
  agentRanking: AgentRank[];
  scoreTrend: ScoreTrendPoint[];
}

// ─── Chart configs ───────────────────────────────────────────────────────────

const trendConfig = {
  avgScore: { label: "Score Promedio", color: "#ff6600" },
} satisfies ChartConfig;

const comparisonConfig = {
  avgScore: { label: "Score Promedio", color: "#8b5cf6" },
} satisfies ChartConfig;

const BAR_COLORS = ["#ff6600", "#1a2b45", "#10b981", "#f43f5e", "#8b5cf6"];

const MEDAL_COLORS = ["text-yellow-500", "text-gray-400", "text-amber-700"];
const MEDAL_BG = [
  "bg-yellow-500/10 border-yellow-500/30",
  "bg-gray-400/10 border-gray-400/30",
  "bg-amber-700/10 border-amber-700/30",
];

// ─── Section animation wrapper ──────────────────────────────────────────────

function Section({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ label = "Sin datos" }: { label?: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function TeamDetailClient({ data }: { data: TeamDetailData }) {
  const router = useRouter();

  const scoreTrend = data.scoreTrend.map((t) => ({ value: t.avgScore }));

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

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
          <Badge variant="outline" className="self-start text-xs">
            Umbral de aprobacion: {data.passThreshold}%
          </Badge>
        </div>
      </motion.div>

      {/* ─── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Score Promedio"
          value={data.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={data.avgScore >= data.passThreshold ? "emerald" : "amber"}
          trend={scoreTrend}
          index={0}
        />
        <KpiCard
          label="Tasa de Aprobacion"
          value={data.passRate}
          suffix="%"
          icon={Award}
          tone={data.passRate >= 80 ? "emerald" : data.passRate >= 50 ? "amber" : "rose"}
          index={1}
        />
        <KpiCard
          label="Total Evaluaciones"
          value={data.totalEvaluations}
          icon={ClipboardCheck}
          tone="orange"
          index={2}
        />
        <KpiCard
          label="Agentes"
          value={data.agentCount}
          icon={Users}
          tone="violet"
          index={3}
        />
      </div>

      {/* ─── Team Score Trend ────────────────────────────────────────────── */}
      <Section delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              Tendencia de Score del Equipo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreTrend.length > 1 ? (
              <ChartContainer config={trendConfig} className="h-[300px] w-full">
                <LineChart data={data.scoreTrend}>
                  <defs>
                    <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
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
      </Section>

      {/* ─── Agent Ranking + Agent Comparison ────────────────────────────── */}
      <Section delay={0.2}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Agent Ranking */}
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
                            <Medal
                              className={`h-5 w-5 ${MEDAL_COLORS[i]}`}
                            />
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
                            variant={
                              agent.avgScore >= data.passThreshold
                                ? "default"
                                : "destructive"
                            }
                            className="tabular-nums text-xs"
                          >
                            {agent.avgScore.toFixed(1)}%
                          </Badge>
                        </div>

                        {/* Pass Rate */}
                        <span className="text-center text-xs tabular-nums text-muted-foreground">
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

          {/* Agent Comparison Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4 text-violet-500" />
                Comparacion de Agentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.agentRanking.length > 0 ? (
                <ChartContainer
                  config={comparisonConfig}
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
      </Section>
    </div>
  );
}
