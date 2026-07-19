"use client";

import {
  ArrowLeft,
  Award,
  ClipboardCheck,
  Medal,
  TrendingUp,
  Users,
  UsersRound,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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
import { useI18n } from "@/components/providers/i18n-provider";
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
import { useChartAnimation } from "@/components/ui/use-chart-animation";
import { summarizeChartData } from "@/lib/chart-accessibility";
import { formatDateOnlyForDisplay } from "@/lib/date-display";
import { getMetricDisplay } from "@/lib/metric-display";
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
  avgScore: { label: "Average Score", color: "#ff6600" },
} satisfies ChartConfig;

const rankingConfig = {
  avgScore: { label: "Average Score", color: "#8b5cf6" },
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

function EmptyState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label ?? t("No data")}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function TeamDetailClient({ teamId }: { teamId: string }) {
  const { locale, t } = useI18n();
  const localizedTrendConfig = {
    ...trendConfig,
    avgScore: { ...trendConfig.avgScore, label: t("Average Score") },
  } satisfies ChartConfig;
  const localizedRankingConfig = {
    ...rankingConfig,
    avgScore: { ...rankingConfig.avgScore, label: t("Average Score") },
  } satisfies ChartConfig;
  const displayLocale = locale === "es" ? "es" : "en";
  const chartAnimation = useChartAnimation();
  const router = useRouter();
  const [data, setData] = useState<TeamDetailData | null>(null);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const requestGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    try {
      const result = await getTeamDetail(teamId, dateFrom || undefined, dateTo || undefined);
      if (requestId !== requestGeneration.current) return;
      setData(result);
      setLoadStatus(result ? "success" : "empty");
    } catch (e) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(e, "team-detail");
      setLoadStatus("error");
    }
  }, [teamId, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  if (loadStatus === "loading" && !data) return <LoadingSkeleton />;
  if (loadStatus === "error") {
    return <DataLoadError onRetry={() => void loadData()} title={t("Unable to load team")} />;
  }
  if (loadStatus === "empty" || !data) {
    return <RestrictedResourceState resourceLabel={t("The team")} />;
  }

  const scoreTrendSpark = data.scoreTrend.map((t) => ({ value: t.avgScore }));
  const evaluatedAgentRanking = data.agentRanking.filter((agent) => agent.totalEvaluations > 0);
  const hasData = data.totalEvaluations > 0;
  const metricStatus = loadStatus === "loading" ? "loading" : hasData ? "success" : "empty";
  const metricStatusLabel = metricStatus === "empty" ? t("No data") : undefined;
  const evaluationCountDisplay = getMetricDisplay({
    kind: "count",
    value: data.totalEvaluations,
    hasData,
    status: metricStatus,
  });
  const averageScoreDisplay = getMetricDisplay({
    kind: "measure",
    value: data.avgScore,
    hasData,
    status: metricStatus,
    decimals: 1,
    suffix: "%",
  });

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
          {t("Back")}
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <UsersRound className="h-5 w-5 text-violet-500" />
              <h1 className="font-heading text-3xl font-bold tracking-tight">{data.name}</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Campaign")}:{" "}
              <span className="font-medium text-foreground">{data.campaignName}</span>
            </p>
          </div>

          {/* Date range filters */}
          <DateRangeFilter
            id="team-detail-date-range"
            label={t("Period")}
            from={dateFrom}
            to={dateTo}
            onApply={(from, to) => {
              setDateFrom(from);
              setDateTo(to);
            }}
            className="w-full sm:w-56"
          />
        </div>
      </motion.div>

      {/* ─── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label={t("Agents")} value={data.agentCount} icon={Users} tone="violet" index={0} />
        <KpiCard
          label={t("Evaluated Calls")}
          value={data.totalEvaluations}
          display={evaluationCountDisplay}
          statusLabel={metricStatusLabel}
          icon={ClipboardCheck}
          tone="orange"
          trend={scoreTrendSpark}
          index={1}
        />
        <KpiCard
          label={t("Average Score")}
          value={data.avgScore}
          display={averageScoreDisplay}
          statusLabel={metricStatusLabel}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={
            !hasData
              ? "navy"
              : data.avgScore >= 70
                ? "emerald"
                : data.avgScore >= 50
                  ? "amber"
                  : "rose"
          }
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
              {t("Team Score trend")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreTrend.length > 1 ? (
              <ChartContainer
                config={localizedTrendConfig}
                accessibilityLabel={t("Team Average Score trend by date")}
                accessibilityDescription={summarizeChartData(
                  data.scoreTrend.map(
                    (point) =>
                      `${formatDateOnlyForDisplay(point.date, undefined, displayLocale)}: ${point.avgScore.toFixed(1)}%`,
                  ),
                  10,
                  locale,
                )}
                className="h-[300px] w-full"
              >
                <LineChart data={data.scoreTrend}>
                  <defs>
                    <linearGradient id="teamTrendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ff6600" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ff6600" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(v) =>
                      formatDateOnlyForDisplay(
                        String(v),
                        { day: "2-digit", month: "short" },
                        displayLocale,
                      )
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
                        labelFormatter={(label) =>
                          formatDateOnlyForDisplay(String(label), undefined, displayLocale)
                        }
                        formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
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
                    isAnimationActive={chartAnimation}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <EmptyState label={t("At least 2 data points are required")} />
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
                {t("Agent ranking")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {evaluatedAgentRanking.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[2rem_1fr_4.5rem_4.5rem_4.5rem] gap-2 border-b pb-2 text-xs font-medium text-muted-foreground">
                    <span>#</span>
                    <span>{t("Agent")}</span>
                    <span className="text-center">{t("Score")}</span>
                    <span className="text-center">{t("Pass")}</span>
                    <span className="text-center">{t("Evals")}</span>
                  </div>
                  <AnimatePresence>
                    {evaluatedAgentRanking.map((agent, i) => (
                      <motion.div
                        key={agent.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04, duration: 0.3 }}
                        className={`grid cursor-pointer grid-cols-[2rem_1fr_4.5rem_4.5rem_4.5rem] items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/40 ${
                          i < 3 ? `${MEDAL_BG[i]} border-opacity-60` : "border-border/60"
                        }`}
                        onClick={() => router.push(`/analytics/agents/${agent.id}`)}
                      >
                        {/* Rank */}
                        <div className="flex items-center justify-center">
                          {i < 3 ? (
                            <Medal className={`h-5 w-5 ${MEDAL_COLORS[i]}`} />
                          ) : (
                            <span className="text-xs text-muted-foreground">{i + 1}</span>
                          )}
                        </div>

                        {/* Name */}
                        <span className="truncate font-medium">{agent.name}</span>

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
                        <span
                          className={`text-center text-xs tabular-nums ${passRateBadgeColor(agent.passRate)}`}
                        >
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
                <EmptyState label={t("No agent evaluations")} />
              )}
            </CardContent>
          </Card>

          {/* Ranking Bar Chart (horizontal, clickable) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4 text-violet-500" />
                {t("Agent ranking")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {evaluatedAgentRanking.length > 0 ? (
                <ChartContainer
                  config={localizedRankingConfig}
                  accessibilityLabel={t("Team agent ranking by Average Score")}
                  accessibilityDescription={summarizeChartData(
                    evaluatedAgentRanking.map((agent) =>
                      t("{name}: score {score}%, Pass Rate {passRate}%, {count} evaluations", {
                        name: agent.name,
                        score: agent.avgScore.toFixed(1),
                        passRate: agent.passRate,
                        count: agent.totalEvaluations,
                      }),
                    ),
                    10,
                    locale,
                  )}
                  className="h-[300px] w-full"
                >
                  <BarChart
                    data={evaluatedAgentRanking}
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
                          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgScore"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                      isAnimationActive={chartAnimation}
                      className="cursor-pointer"
                      onClick={(barData) => {
                        if (barData?.id) router.push(`/analytics/agents/${barData.id}`);
                      }}
                    >
                      {evaluatedAgentRanking.map((agent, i) => (
                        <Cell key={agent.id} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label={t("No agents with evaluations")} />
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
