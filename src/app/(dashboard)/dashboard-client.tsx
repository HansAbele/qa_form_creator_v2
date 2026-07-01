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
  Filter,
  PhoneForwarded,
  PhoneOutgoing,
  ShieldAlert,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { AgentLeaderboard } from "@/components/dashboard/agent-leaderboard";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { KpiCard } from "@/components/ui/kpi-card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getDashboardStats,
  getDashboardCampaignKpis,
  getDashboardDispositionAnalytics,
  getDashboardEvaluatorActivity,
  getDashboardOutcomeKpis,
  getEvaluationsPerAgent,
  getResponseTrends,
  getScoreDistribution,
  getTopBottomPerformers,
} from "@/server/queries/analytics";
import type { UiAccess } from "@/server/queries/ui-access";

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

const BAR_COLORS = [
  "#F2621A", // brand orange
  "#0FA3BF", // cyan
  "#12A277", // green
  "#E8931A", // amber
  "#7A5AF8", // purple
  "#0E1A2C", // navy
];

interface DashboardStats {
  formCount: number;
  responseCount: number;
  avgScore: number;
  passRate: number;
  passCount: number;
  failCount: number;
  fatalFailCount: number;
  dailyRate: number;
  passThreshold: number;
  targetPassRate: number;
  targetAvgScore: number;
  targetDailyRate: number;
  fatalFailuresAllowed: number;
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
  access,
  campaigns,
}: {
  userName: string;
  access: UiAccess;
  campaigns: { id: string; name: string }[];
}) {
  const [campaignId, setCampaignId] = useState("");
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
    { id: string; name: string; count: number }[]
  >([]);
  const [campaignPerf, setCampaignPerf] = useState<
    {
      id: string;
      name: string;
      totalAgents: number;
      totalEvaluations: number;
      avgScore: number;
      passRate: number;
      dailyRate: number;
      fatalFailCount: number;
      targetPassRate: number;
      targetAvgScore: number;
      targetDailyRate: number;
      fatalFailuresAllowed: number;
    }[]
  >([]);
  const [dispAnalytics, setDispAnalytics] = useState<
    { id: string; name: string; code: string | null; categoryName: string | null; totalEvaluations: number; avgScore: number; passRate: number }[]
  >([]);
  const [outcomeKpis, setOutcomeKpis] = useState({
    classifiedTotal: 0,
    resolved: 0,
    escalated: 0,
    resolutionRate: 0,
    escalationRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const canOpenKpiDetails = access.canViewKPIs;
  const canOpenReportDetails = access.canViewReports;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const cid = campaignId || undefined;
      const df = dateFrom || undefined;
      const dt = dateTo || undefined;

      const [s, t, d, tb, ev, ea, tp, da, oc] = await Promise.all([
        getDashboardStats(cid, df, dt),
        getResponseTrends(cid, df, dt),
        getScoreDistribution(cid, df, dt),
        getTopBottomPerformers(cid, df, dt),
        getDashboardEvaluatorActivity(cid, df, dt),
        getEvaluationsPerAgent(cid, df, dt),
        getDashboardCampaignKpis(cid, df, dt),
        getDashboardDispositionAnalytics(cid, df, dt),
        getDashboardOutcomeKpis(cid, df, dt),
      ]);
      setStats(s);
      setTrends(t);
      setDistribution(d);
      setTopBottom(tb);
      setEvaluators(ev);
      setEvalsPerAgent(ea);
      setCampaignPerf(tp);
      setDispAnalytics(da);
      setOutcomeKpis(oc);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [campaignId, dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
  const sortedCampaignPerf = [...campaignPerf].sort((a, b) => {
    const aActive = a.totalEvaluations > 0;
    const bActive = b.totalEvaluations > 0;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return b.avgScore - a.avgScore;
  });
  const activeCampaignCount = sortedCampaignPerf.filter(
    (entry) => entry.totalEvaluations > 0,
  ).length;
  const topDispositions = dispAnalytics.slice(0, 8);
  const maxDispositionTotal = Math.max(
    1,
    ...topDispositions.map((entry) => entry.totalEvaluations),
  );
  const totalDispositionEvaluations = dispAnalytics.reduce(
    (sum, entry) => sum + entry.totalEvaluations,
    0,
  );

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
          {campaigns.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">Campaña</Label>
              <Select
                value={campaignId || "all"}
                onValueChange={(v) => setCampaignId(v === "all" || !v ? "" : v)}
              >
                <SelectTrigger className="h-10 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DateRangeFilter
            from={dateFrom}
            to={dateTo}
            onApply={(f, t) => {
              setDateFrom(f);
              setDateTo(t);
            }}
          />
        </div>
      </motion.div>

      {/* ─── Active Campaign Filter Chip ────────────────────────────────── */}
      {campaignId && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => setCampaignId("")}
            className="group inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
          >
            <Filter className="h-3 w-3" />
            <span>
              Filtrando por:{" "}
              <span className="font-semibold">
                {campaigns.find((c) => c.id === campaignId)?.name ?? "Campaña"}
              </span>
            </span>
            <X className="h-3 w-3 transition-transform group-hover:scale-125" />
          </button>
        </motion.div>
      )}

      {/* ─── KPI Cards (animated, with sparklines) ─────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
          label={`Score Promedio (target ${stats.targetAvgScore}%)`}
          value={stats.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={stats.avgScore >= stats.targetAvgScore ? "emerald" : "rose"}
          trend={scoreTrend}
          index={2}
        />
        <KpiCard
          label={`Pass Rate (target ${stats.targetPassRate}%)`}
          value={stats.passRate}
          suffix="%"
          icon={Award}
          tone={
            stats.passRate >= stats.targetPassRate
              ? "emerald"
              : stats.passRate >= stats.passThreshold
                ? "amber"
                : "rose"
          }
          index={3}
        />
        <KpiCard
          label={`Tasa diaria (target ${stats.targetDailyRate}/d)`}
          value={stats.dailyRate}
          decimals={1}
          icon={Calendar}
          tone={stats.dailyRate >= stats.targetDailyRate ? "emerald" : "amber"}
          index={4}
        />
        <KpiCard
          label={`Fatales permitidas ${stats.fatalFailuresAllowed}`}
          value={stats.fatalFailCount}
          icon={ShieldAlert}
          tone={stats.fatalFailCount <= stats.fatalFailuresAllowed ? "emerald" : "rose"}
          index={5}
        />
        {outcomeKpis.classifiedTotal > 0 && (
          <>
            <KpiCard
              label="Resolucion (FCR)"
              value={outcomeKpis.resolutionRate}
              decimals={1}
              suffix="%"
              icon={PhoneOutgoing}
              tone={
                outcomeKpis.resolutionRate >= 80
                  ? "emerald"
                  : outcomeKpis.resolutionRate >= 70
                    ? "amber"
                    : "rose"
              }
              index={6}
            />
            <KpiCard
              label="Tasa de escalacion"
              value={outcomeKpis.escalationRate}
              decimals={1}
              suffix="%"
              icon={PhoneForwarded}
              tone={
                outcomeKpis.escalationRate <= 10
                  ? "emerald"
                  : outcomeKpis.escalationRate <= 20
                    ? "amber"
                    : "rose"
              }
              index={7}
            />
          </>
        )}
      </div>

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
              <CardTitle className="flex items-center gap-2 text-base">
                Pass / Fail (≥{stats.passThreshold}%)
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {canOpenReportDetails ? "Click para ver detalles" : "Resumen"}
                </span>
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
                        {passFail.map((entry) => (
                          <Cell
                            key={entry.name}
                            cursor={canOpenReportDetails ? "pointer" : "default"}
                            fill={entry.fill}
                            onClick={
                              canOpenReportDetails
                                ? () => {
                                    const params = new URLSearchParams();
                                    if (entry.name === "Pass") {
                                      params.set(
                                        "minScore",
                                        String(stats.passThreshold),
                                      );
                                    } else {
                                      params.set(
                                        "maxScore",
                                        String(stats.passThreshold - 0.01),
                                      );
                                    }
                                    if (campaignId) params.set("campaignId", campaignId);
                                    if (dateFrom) params.set("dateFrom", dateFrom);
                                    if (dateTo) params.set("dateTo", dateTo);
                                    router.push(`/analytics/responses?${params}`);
                                  }
                                : undefined
                            }
                          />
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

      {/* ─── Row 3: Top 10 + Bottom 5 ──────────────────────────────────── */}
      <Section delay={0.2}>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4 text-emerald-500" />
                Top 10 Performers
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {canOpenKpiDetails ? "Click para detalles" : "Resumen"}
                </span>
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
                    >
                      {topBottom.top10.map((entry) => (
                        <Cell
                          key={entry.id}
                          cursor={canOpenKpiDetails ? "pointer" : "default"}
                          onClick={
                            canOpenKpiDetails
                              ? () => router.push(`/analytics/agents/${entry.id}`)
                              : undefined
                          }
                        />
                      ))}
                    </Bar>
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
                    >
                      {topBottom.bottom5.map((entry) => (
                        <Cell
                          key={entry.id}
                          cursor={canOpenKpiDetails ? "pointer" : "default"}
                          onClick={
                            canOpenKpiDetails
                              ? () => router.push(`/analytics/agents/${entry.id}`)
                              : undefined
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Row 4: Team Performance + Disposition Analytics ──────────── */}
      <Section delay={0.22}>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
          {/* Team Performance */}
          <Card className="flex overflow-hidden lg:h-[clamp(460px,55vh,620px)] lg:flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <UsersRound className="h-4 w-4 text-violet-500" />
                Rendimiento por Campaña
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  Click para filtrar dashboard
                </span>
              </CardTitle>
              {campaignPerf.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="secondary" className="font-normal">
                    {activeCampaignCount} con datos
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {campaignPerf.length - activeCampaignCount} sin datos
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {campaignPerf.length} campañas
                  </Badge>
                </div>
              )}
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              {campaignPerf.length > 0 ? (
                <div className="scrollbar-reveal h-full overflow-y-auto pr-1">
                  <div className="space-y-0.5 pt-1">
                    {sortedCampaignPerf.map((entry) => {
                      const hasData = entry.totalEvaluations > 0;
                      const isSelected = campaignId === entry.id;
                      return (
                        <button
                          type="button"
                          key={entry.id}
                          className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            isSelected
                              ? "bg-violet-500/10 ring-1 ring-violet-500/30"
                              : "hover:bg-muted/40"
                          }`}
                          onClick={() =>
                            setCampaignId(isSelected ? "" : entry.id)
                          }
                          title={
                            isSelected
                              ? `Click para quitar filtro · ${entry.totalEvaluations} evaluaciones`
                              : `${entry.name} · ${entry.totalEvaluations} evaluaciones`
                          }
                        >
                          <span
                            className={`w-[140px] shrink-0 truncate text-xs ${
                              hasData ? "font-medium" : "text-muted-foreground/60"
                            }`}
                          >
                            {entry.name}
                          </span>
                          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
                            {hasData && (
                              <div
                                className={`h-full rounded-full transition-all ${
                                  entry.avgScore >= entry.targetAvgScore
                                    ? "bg-emerald-500"
                                    : "bg-rose-500"
                                }`}
                                style={{ width: `${Math.min(100, entry.avgScore)}%` }}
                              />
                            )}
                          </div>
                          <div className="flex w-[190px] shrink-0 items-center justify-end gap-1.5">
                            <Badge
                              variant={
                                entry.avgScore >= entry.targetAvgScore ? "default" : "destructive"
                              }
                              className="tabular-nums"
                            >
                              {hasData
                                ? `${entry.avgScore.toFixed(1)}/${entry.targetAvgScore}%`
                                : "-"}
                            </Badge>
                            <Badge
                              variant={
                                entry.passRate >= entry.targetPassRate ? "outline" : "destructive"
                              }
                              className="tabular-nums"
                            >
                              PR {entry.passRate}%
                            </Badge>
                            <Badge
                              variant={
                                entry.fatalFailCount <= entry.fatalFailuresAllowed
                                  ? "outline"
                                  : "destructive"
                              }
                              className="tabular-nums"
                            >
                              F {entry.fatalFailCount}/{entry.fatalFailuresAllowed}
                            </Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <EmptyState label="Sin campañas con evaluaciones" />
              )}
            </CardContent>
          </Card>

          {/* Disposition Analytics */}
          <Card className="flex self-start lg:h-[clamp(460px,55vh,620px)] lg:flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Tag className="h-4 w-4 text-cyan-500" />
                Disposiciones Más Frecuentes
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {canOpenKpiDetails ? "Click para detalles" : "Resumen"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              {dispAnalytics.length > 0 ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      Top {topDispositions.length} de {dispAnalytics.length}
                    </span>
                    <span className="tabular-nums">
                      {totalDispositionEvaluations} evaluaciones
                    </span>
                  </div>
                  <div className="grid min-h-0 flex-1 auto-rows-fr gap-2">
                    {topDispositions.map((entry, i) => {
                      const share =
                        totalDispositionEvaluations > 0
                          ? (entry.totalEvaluations / totalDispositionEvaluations) * 100
                          : 0;
                      return (
                        <button
                          type="button"
                          key={entry.id}
                          aria-disabled={!canOpenKpiDetails}
                          className={`group flex min-h-0 w-full flex-col justify-center rounded-md border bg-card px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            canOpenKpiDetails
                              ? "cursor-pointer hover:bg-muted/40"
                              : "cursor-default"
                          }`}
                          onClick={
                            canOpenKpiDetails
                              ? () =>
                                  router.push(
                                    `/analytics/dispositions/${entry.id}`,
                                  )
                              : undefined
                          }
                          title={`${entry.name} · ${entry.totalEvaluations} evaluaciones`}
                        >
                          <div className="mb-2 flex items-center gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">
                                {entry.name}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {entry.categoryName ?? entry.code ?? "Sin categoría"}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold tabular-nums">
                                {entry.totalEvaluations}
                              </div>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {share.toFixed(0)}%
                              </div>
                            </div>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.max(
                                  4,
                                  (entry.totalEvaluations / maxDispositionTotal) * 100,
                                )}%`,
                                backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                              }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <EmptyState label="Sin disposiciones con evaluaciones" />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Row 5: Evaluations per Agent ──────────────────────────────── */}
      <Section delay={0.25}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Evaluaciones por Agente
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                {canOpenKpiDetails ? "Click para detalles" : "Resumen"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AgentLeaderboard
              rows={evalsPerAgent}
              interactive={canOpenKpiDetails}
              onRowClick={(id) => router.push(`/analytics/agents/${id}`)}
            />
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
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {canOpenKpiDetails ? "Click para detalles" : "Resumen"}
                </span>
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
                        className={`grid grid-cols-4 items-center rounded-lg border border-border/60 px-3 py-2 text-sm transition-colors ${
                          canOpenKpiDetails
                            ? "cursor-pointer hover:bg-muted/40"
                            : "cursor-default"
                        }`}
                        onClick={
                          canOpenKpiDetails
                            ? () => router.push(`/analytics/evaluators/${ev.id}`)
                            : undefined
                        }
                      >
                        <span className="truncate font-medium">{ev.name}</span>
                        <span className="text-center tabular-nums">
                          {ev.totalEvaluations}
                        </span>
                        <div className="flex justify-center">
                          <Badge
                            variant={
                              ev.avgScore >= stats.targetAvgScore
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
              <CardTitle className="flex items-center gap-2 text-base">
                Evaluaciones Recientes
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {canOpenReportDetails ? "Click para detalles" : "Resumen"}
                </span>
              </CardTitle>
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
                        className={`flex items-center justify-between rounded-lg border border-border/60 p-3 transition-colors ${
                          canOpenReportDetails
                            ? "cursor-pointer hover:bg-muted/40"
                            : "cursor-default"
                        }`}
                        onClick={
                          canOpenReportDetails
                            ? () => router.push(`/analytics/responses/${r.id}`)
                            : undefined
                        }
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
                              r.score >= stats.passThreshold
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
