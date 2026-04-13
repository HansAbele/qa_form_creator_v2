"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label as RechartsLabel,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { AnimatePresence, motion } from "motion/react";
import {
  Award,
  Calendar,
  ClipboardCheck,
  FileText,
  Sparkles,
  Tag,
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
import {
  getDashboardStats,
  getDispositionAnalytics,
  getEvaluationsPerAgent,
  getEvaluatorActivity,
  getResponseTrends,
  getScoreDistribution,
  getTeamPerformance,
  getTopBottomPerformers,
} from "@/server/queries/analytics";
import type { AppSettings } from "@/lib/settings";

// ─── Chart configs (theme-aware via CSS vars) ─────────────────────────────────
const trendsConfig = {
  count: { label: "Evaluaciones", color: "#ff6600" },
  avgScore: { label: "Score Promedio", color: "#1a2b45" },
} satisfies ChartConfig;

const distConfig = {
  count: { label: "Evaluaciones", color: "#ff6600" },
} satisfies ChartConfig;

const passFailConfig = {
  pass: { label: "Pass", color: "#10b981" },
  fail: { label: "Fail", color: "#f43f5e" },
} satisfies ChartConfig;

const performerConfig = {
  avgScore: { label: "Score Promedio", color: "#10b981" },
} satisfies ChartConfig;

const volumeConfig = {
  count: { label: "Evaluaciones", color: "#ff6600" },
} satisfies ChartConfig;

const teamConfig = {
  avgScore: { label: "Score Promedio", color: "#8b5cf6" },
} satisfies ChartConfig;

const dispConfig = {
  totalEvaluations: { label: "Evaluaciones", color: "#06b6d4" },
  avgScore: { label: "Score Promedio", color: "#ff6600" },
} satisfies ChartConfig;

const BAR_COLORS = [
  "#ff6600",
  "#1a2b45",
  "#8b5cf6",
  "#06b6d4",
  "#f59e0b",
  "#10b981",
];

interface DashboardStats {
  formCount: number;
  responseCount: number;
  avgScore: number;
  passRate: number;
  passCount: number;
  failCount: number;
  recentResponses: {
    id: string;
    formTitle: string;
    agentName: string;
    evaluatorName: string;
    score: number;
    createdAt: string;
  }[];
}

// Fade + slide wrapper for sections
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

export function DashboardClient({
  userName,
  settings,
}: {
  userName: string;
  settings: AppSettings;
}) {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<
    { date: string; count: number; avgScore: number }[]
  >([]);
  const [distribution, setDistribution] = useState<
    { range: string; count: number }[]
  >([]);
  const [topBottom, setTopBottom] = useState<{
    top10: {
      id: string;
      name: string;
      avgScore: number;
      totalEvaluations: number;
    }[];
    bottom5: {
      id: string;
      name: string;
      avgScore: number;
      totalEvaluations: number;
    }[];
  }>({ top10: [], bottom5: [] });
  const [evaluators, setEvaluators] = useState<
    {
      id: string;
      name: string;
      totalEvaluations: number;
      avgScore: number;
      stdDev: number;
    }[]
  >([]);
  const [evalsPerAgent, setEvalsPerAgent] = useState<
    { name: string; count: number }[]
  >([]);
  const [teamPerf, setTeamPerf] = useState<
    {
      id: string;
      name: string;
      campaignName: string;
      agentCount: number;
      totalEvaluations: number;
      avgScore: number;
      passRate: number;
    }[]
  >([]);
  const [dispAnalytics, setDispAnalytics] = useState<
    {
      id: string;
      name: string;
      totalEvaluations: number;
      avgScore: number;
      passRate: number;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, d, tb, ev, ea, tp, da] = await Promise.all([
        getDashboardStats(dateFrom || undefined, dateTo || undefined),
        getResponseTrends(dateFrom || undefined, dateTo || undefined),
        getScoreDistribution(
          undefined,
          dateFrom || undefined,
          dateTo || undefined,
        ),
        getTopBottomPerformers(dateFrom || undefined, dateTo || undefined),
        getEvaluatorActivity(dateFrom || undefined, dateTo || undefined),
        getEvaluationsPerAgent(dateFrom || undefined, dateTo || undefined),
        getTeamPerformance(dateFrom || undefined, dateTo || undefined),
        getDispositionAnalytics(
          undefined,
          dateFrom || undefined,
          dateTo || undefined,
        ),
      ]);
      setStats(s);
      setTrends(t);
      setDistribution(d);
      setTopBottom(tb);
      setEvaluators(ev);
      setEvalsPerAgent(ea);
      setTeamPerf(tp);
      setDispAnalytics(da);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

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

  if (loading && !stats) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          className="h-8 w-8 rounded-full border-2 border-orange-500/30 border-t-orange-500"
        />
      </div>
    );
  }

  if (!stats) return null;

  const passFail = [
    { name: "Pass", value: stats.passCount, fill: "#10b981" },
    { name: "Fail", value: stats.failCount, fill: "#f43f5e" },
  ];

  // Mini trend series for KPI sparklines
  const countTrend = trends.map((t) => ({ value: t.count }));
  const scoreTrend = trends.map((t) => ({ value: t.avgScore }));

  return (
    <div className="space-y-6">
      {/* ─── Header + Date Filter ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-orange-500" />
            <h1 className="font-heading text-3xl font-bold tracking-tight">
              Dashboard
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Bienvenido de vuelta, <span className="font-medium text-foreground">{userName}</span>
          </p>
        </div>
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
      </motion.div>

      {/* ─── KPI Cards (animated, with sparklines) ─────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Formularios"
          value={stats.formCount}
          icon={FileText}
          tone="navy"
          index={0}
        />
        <KpiCard
          label="Total Evaluaciones"
          value={stats.responseCount}
          icon={ClipboardCheck}
          tone="orange"
          trend={countTrend}
          index={1}
        />
        <KpiCard
          label="Score Promedio"
          value={stats.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={stats.avgScore >= settings.passThreshold ? "emerald" : "amber"}
          trend={scoreTrend}
          index={2}
        />
        <KpiCard
          label={`Pass Rate (≥${settings.passThreshold}%)`}
          value={stats.passRate}
          suffix="%"
          icon={Award}
          tone={
            stats.passRate >= settings.targetPassRate
              ? "emerald"
              : stats.passRate >= settings.passThreshold
                ? "amber"
                : "rose"
          }
          index={3}
        />
      </div>

      {/* ─── Row 1: Trends ─────────────────────────────────────────────── */}
      <Section delay={0.1}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Responses Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calendar className="h-4 w-4 text-orange-500" />
                Tendencia de Evaluaciones
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trends.length > 0 ? (
                <ChartContainer config={trendsConfig} className="h-[250px] w-full">
                  <AreaChart data={trends}>
                    <defs>
                      <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff6600" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#ff6600" stopOpacity={0} />
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
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      className="text-xs"
                    />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#ff6600"
                      strokeWidth={2}
                      fill="url(#fillCount)"
                      animationDuration={1000}
                    />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>

          {/* Score Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                Tendencia de Score Promedio
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trends.length > 0 ? (
                <ChartContainer config={trendsConfig} className="h-[250px] w-full">
                  <LineChart data={trends}>
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
                <EmptyState />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Row 2: Distribution + Pass/Fail ───────────────────────────── */}
      <Section delay={0.15}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Distribución de Scores</CardTitle>
            </CardHeader>
            <CardContent>
              {distribution.some((d) => d.count > 0) ? (
                <ChartContainer config={distConfig} className="h-[250px] w-full">
                  <BarChart data={distribution}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="range"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      className="text-xs"
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      className="text-xs"
                    />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="count"
                      fill="#ff6600"
                      radius={[6, 6, 0, 0]}
                      animationDuration={900}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Pass / Fail (≥{settings.passThreshold}%)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats.passCount + stats.failCount > 0 ? (
                <div className="flex flex-col items-center">
                  <ChartContainer
                    config={passFailConfig}
                    className="mx-auto h-[220px] w-full max-w-[260px]"
                  >
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                      <Pie
                        data={passFail}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={62}
                        outerRadius={92}
                        strokeWidth={4}
                        paddingAngle={2}
                        animationDuration={900}
                      >
                        {passFail.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                        <RechartsLabel
                          content={({ viewBox }) => {
                            if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                              const cx = viewBox.cx ?? 0;
                              const cy = viewBox.cy ?? 0;
                              return (
                                <text
                                  x={cx}
                                  y={cy}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                >
                                  <tspan
                                    x={cx}
                                    y={cy - 6}
                                    className="fill-foreground text-2xl font-bold"
                                  >
                                    {stats.passRate.toFixed(0)}%
                                  </tspan>
                                  <tspan
                                    x={cx}
                                    y={cy + 14}
                                    className="fill-muted-foreground text-[11px]"
                                  >
                                    Pass rate
                                  </tspan>
                                </text>
                              );
                            }
                            return null;
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  {/* Custom legend */}
                  <div className="mt-2 flex items-center justify-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      <span className="text-muted-foreground">Pass</span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {stats.passCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                      <span className="text-muted-foreground">Fail</span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {stats.failCount}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Row 3: Score por Equipo + Score por Disposición ──────────── */}
      <Section delay={0.2}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Team Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersRound className="h-4 w-4 text-violet-500" />
                Score por Equipo
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teamPerf.length > 0 ? (
                <ChartContainer config={teamConfig} className="h-[300px] w-full">
                  <BarChart
                    data={teamPerf}
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
                          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgScore"
                      fill="#8b5cf6"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      className="cursor-pointer"
                      onClick={(data) => {
                        if (data?.id) router.push(`/analytics/teams/${data.id}`);
                      }}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin equipos configurados" />
              )}
            </CardContent>
          </Card>

          {/* Disposition Analytics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Tag className="h-4 w-4 text-cyan-500" />
                Score por Disposición (Top 10)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dispAnalytics.length > 0 ? (
                <ChartContainer config={dispConfig} className="h-[300px] w-full">
                  <BarChart
                    data={dispAnalytics.slice(0, 10)}
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
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={100}
                      className="text-xs"
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(6,182,212,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgScore"
                      fill="#06b6d4"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      className="cursor-pointer"
                      onClick={() => router.push("/analytics/dispositions")}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin disposiciones registradas" />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Row 4: Top 10 + Bottom 5 (clickable drill-down) ─────────── */}
      <Section delay={0.25}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4 text-emerald-500" />
                Top 10 Performers
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topBottom.top10.length > 0 ? (
                <ChartContainer config={performerConfig} className="h-[300px] w-full">
                  <BarChart
                    data={topBottom.top10}
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
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={85}
                      className="text-xs"
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(16,185,129,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgScore"
                      fill="#10b981"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      className="cursor-pointer"
                      onClick={(data) => {
                        if (data?.id) router.push(`/analytics/agents/${data.id}`);
                      }}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 rotate-180 text-rose-500" />
                Bottom 5 (Requieren Coaching)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topBottom.bottom5.length > 0 ? (
                <ChartContainer config={performerConfig} className="h-[300px] w-full">
                  <BarChart
                    data={topBottom.bottom5}
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
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={85}
                      className="text-xs"
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(244,63,94,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgScore"
                      fill="#f43f5e"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      className="cursor-pointer"
                      onClick={(data) => {
                        if (data?.id) router.push(`/analytics/agents/${data.id}`);
                      }}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Row 4: Evaluations per Agent ──────────────────────────────── */}
      <Section delay={0.25}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Evaluaciones por Agente (Top 10 por volumen)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {evalsPerAgent.length > 0 ? (
              <ChartContainer config={volumeConfig} className="h-[300px] w-full">
                <BarChart data={evalsPerAgent}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="name"
                    angle={-25}
                    textAnchor="end"
                    height={70}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                  />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} animationDuration={900}>
                    {evalsPerAgent.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState />
            )}
          </CardContent>
        </Card>
      </Section>

      {/* ─── Row 5: Evaluator Activity + Recent ────────────────────────── */}
      <Section delay={0.3}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Evaluator Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-orange-500" />
                Actividad de Evaluadores
              </CardTitle>
            </CardHeader>
            <CardContent>
              {evaluators.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-4 border-b pb-2 text-xs font-medium text-muted-foreground">
                    <span>Evaluador</span>
                    <span className="text-center">Evals</span>
                    <span className="text-center">Avg Score</span>
                    <span className="text-center">Consistencia</span>
                  </div>
                  <AnimatePresence>
                    {evaluators.slice(0, 10).map((ev, i) => (
                      <motion.div
                        key={ev.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.3 }}
                        className="grid cursor-pointer grid-cols-4 items-center rounded-lg border border-border/60 px-3 py-2 text-sm transition-colors hover:bg-muted/40"
                        onClick={() => router.push(`/analytics/evaluators/${ev.id}`)}
                      >
                        <span className="truncate font-medium">{ev.name}</span>
                        <span className="text-center tabular-nums">
                          {ev.totalEvaluations}
                        </span>
                        <div className="flex justify-center">
                          <Badge
                            variant={
                              ev.avgScore >= settings.passThreshold
                                ? "default"
                                : "destructive"
                            }
                            className="tabular-nums"
                          >
                            {ev.avgScore.toFixed(1)}%
                          </Badge>
                        </div>
                        <span
                          className="text-center text-xs tabular-nums text-muted-foreground"
                          title="Desviación estándar (menor = más consistente)"
                        >
                          ±{ev.stdDev.toFixed(1)}
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>

          {/* Recent Evaluations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evaluaciones Recientes</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.recentResponses.length > 0 ? (
                <div className="space-y-2">
                  <AnimatePresence>
                    {stats.recentResponses.map((r, i) => (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.3 }}
                        className="flex items-center justify-between rounded-lg border border-border/60 p-3 transition-colors hover:bg-muted/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{r.agentName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {r.formTitle} — por {r.evaluatorName}
                          </p>
                        </div>
                        <div className="ml-3 flex items-center gap-2">
                          <Badge
                            variant={
                              r.score >= settings.passThreshold
                                ? "default"
                                : "destructive"
                            }
                            className="tabular-nums"
                          >
                            {r.score.toFixed(1)}%
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(r.createdAt).toLocaleDateString("es-ES")}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : (
                <EmptyState label="Sin evaluaciones" />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>
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
