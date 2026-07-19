"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Award,
  BarChart3,
  ClipboardCheck,
  Hash,
  Layers,
  Minus,
  Tag,
  TrendingUp,
  Users,
} from "lucide-react";
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
import { useI18n } from "@/components/providers/i18n-provider";
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
import { getMetricDisplay } from "@/lib/metric-display";
import { getDispositionDetail } from "@/server/queries/analytics";

interface ScoreTrendPoint {
  date: string;
  avgScore: number;
  count: number;
}

interface TopEntity {
  id: string;
  name: string;
  count: number;
  avgScore: number;
}

interface QuestionScore {
  question: string;
  avgScore: number;
}

interface SisterDisposition {
  id: string;
  name: string;
  code: string | null;
  totalEvaluations: number;
  avgScore: number;
}

interface RecentResponse {
  id: string;
  agentName: string;
  evaluatorName: string;
  formTitle: string;
  score: number;
  result: "PASS" | "FAIL";
  submittedAt: string;
}

interface DispositionDetailData {
  id: string;
  name: string;
  code: string | null;
  campaignName: string;
  categoryName: string | null;
  active: boolean;
  totalEvaluations: number;
  avgScore: number;
  passThreshold: number;
  globalAvgScore: number;
  scoreDelta: number;
  passRate: number;
  scoreTrend: ScoreTrendPoint[];
  topAgents: TopEntity[];
  topEvaluators: TopEntity[];
  scoreByQuestion: QuestionScore[];
  sisterDispositions: SisterDisposition[];
  recentResponses: RecentResponse[];
}

const scoreTrendConfig = {
  avgScore: { label: "Average Score", color: "#06b6d4" },
} satisfies ChartConfig;

const volumeTrendConfig = {
  count: { label: "Evaluations", color: "#8b5cf6" },
} satisfies ChartConfig;

const questionConfig = {
  avgScore: { label: "Score", color: "#06b6d4" },
} satisfies ChartConfig;

function scoreBadgeVariant(
  score: number,
  passThreshold: number,
): "default" | "secondary" | "destructive" {
  if (score >= passThreshold) return "default";
  if (score >= passThreshold * 0.7) return "secondary";
  return "destructive";
}

function resultBadgeVariant(result: "PASS" | "FAIL"): "default" | "destructive" {
  return result === "PASS" ? "default" : "destructive";
}

function getQuestionBarColor(score: number, passThreshold: number): string {
  if (score >= passThreshold) return "#10b981";
  if (score >= passThreshold * 0.7) return "#f59e0b";
  return "#f43f5e";
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[320px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[340px] rounded-xl" />
        <Skeleton className="h-[340px] rounded-xl" />
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

export function DispositionDetailClient({ dispositionId }: { dispositionId: string }) {
  const { locale, t } = useI18n();
  const localizedScoreTrendConfig = {
    ...scoreTrendConfig,
    avgScore: { ...scoreTrendConfig.avgScore, label: t("Average Score") },
  } satisfies ChartConfig;
  const localizedVolumeTrendConfig = {
    ...volumeTrendConfig,
    count: { ...volumeTrendConfig.count, label: t("Evaluations") },
  } satisfies ChartConfig;
  const localizedQuestionConfig = {
    ...questionConfig,
    avgScore: { ...questionConfig.avgScore, label: t("Score") },
  } satisfies ChartConfig;
  const displayLocale = locale === "es" ? "es" : "en";
  const chartAnimation = useChartAnimation();
  const operationalTimeZone = useOperationalTimeZone();
  const router = useRouter();
  const [data, setData] = useState<DispositionDetailData | null>(null);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const requestGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    try {
      const result = await getDispositionDetail(
        dispositionId,
        dateFrom || undefined,
        dateTo || undefined,
      );
      if (requestId !== requestGeneration.current) return;
      setData(result);
      setLoadStatus(result ? "success" : "empty");
    } catch (e) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(e, "disposition-detail");
      setLoadStatus("error");
    }
  }, [dispositionId, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  if (loadStatus === "loading" && !data) return <LoadingSkeleton />;
  if (loadStatus === "error") {
    return (
      <DataLoadError onRetry={() => void loadData()} title={t("Unable to load Disposition")} />
    );
  }
  if (loadStatus === "empty" || !data) {
    return <RestrictedResourceState resourceLabel={t("The Disposition")} />;
  }

  const hasData = data.totalEvaluations > 0;
  const deltaIcon = hasData
    ? data.scoreDelta > 0.5
      ? ArrowUp
      : data.scoreDelta < -0.5
        ? ArrowDown
        : Minus
    : Minus;
  const deltaTone: "emerald" | "rose" | "navy" = hasData
    ? data.scoreDelta > 0.5
      ? "emerald"
      : data.scoreDelta < -0.5
        ? "rose"
        : "navy"
    : "navy";
  const deltaLabel = !hasData
    ? t("Overall Average Score")
    : data.scoreDelta > 0
      ? t("+{value}% vs overall", { value: data.scoreDelta.toFixed(1) })
      : data.scoreDelta < 0
        ? t("{value}% vs overall", { value: data.scoreDelta.toFixed(1) })
        : t("= overall");
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
  const overallAverageDisplay = getMetricDisplay({
    kind: "measure",
    value: data.globalAvgScore,
    hasData,
    status: metricStatus,
    decimals: 1,
    suffix: "%",
  });
  const passRateDisplay = getMetricDisplay({
    kind: "measure",
    value: data.passRate,
    hasData,
    status: metricStatus,
    suffix: "%",
  });

  return (
    <div className="space-y-6">
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
          {t("Back")}
        </Button>

        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-500/20">
                  <Tag className="h-7 w-7 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {data.code && (
                      <Badge variant="outline" className="gap-1">
                        <Hash className="h-3 w-3" />
                        {data.code}
                      </Badge>
                    )}
                    <Badge variant="secondary">{data.campaignName}</Badge>
                    {data.categoryName && <Badge variant="secondary">{data.categoryName}</Badge>}
                    {!data.active && <Badge variant="destructive">{t("Inactive")}</Badge>}
                  </div>
                </div>
              </div>

              <DateRangeFilter
                id="disposition-detail-date-range"
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
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("Evaluated Calls")}
          value={data.totalEvaluations}
          display={evaluationCountDisplay}
          statusLabel={metricStatusLabel}
          icon={ClipboardCheck}
          tone="orange"
          index={0}
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
              : data.avgScore >= data.passThreshold
                ? "emerald"
                : data.avgScore >= data.passThreshold * 0.7
                  ? "amber"
                  : "rose"
          }
          index={1}
        />
        <KpiCard
          label={deltaLabel}
          value={data.globalAvgScore}
          display={overallAverageDisplay}
          statusLabel={metricStatusLabel}
          decimals={1}
          suffix="%"
          icon={deltaIcon}
          tone={hasData ? deltaTone : "navy"}
          index={2}
        />
        <KpiCard
          label={t("Pass Rate")}
          value={data.passRate}
          display={passRateDisplay}
          statusLabel={metricStatusLabel}
          suffix="%"
          icon={Award}
          tone={
            !hasData
              ? "navy"
              : data.passRate >= 70
                ? "emerald"
                : data.passRate >= 50
                  ? "amber"
                  : "rose"
          }
          index={3}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-cyan-500" />
              {t("Score trend")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreTrend.length > 0 ? (
              <ChartContainer
                config={localizedScoreTrendConfig}
                accessibilityLabel={t("Disposition Average Score trend")}
                accessibilityDescription={summarizeChartData(
                  data.scoreTrend.map(
                    (point) =>
                      `${formatDateOnlyForDisplay(point.date, undefined, displayLocale)}: ${point.avgScore.toFixed(1)}%`,
                  ),
                  10,
                  locale,
                )}
                className="h-[260px] w-full"
              >
                <LineChart data={data.scoreTrend} margin={{ left: 8, right: 12 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                    tickFormatter={(v) =>
                      formatDateOnlyForDisplay(
                        String(v),
                        { day: "2-digit", month: "short" },
                        displayLocale,
                      )
                    }
                  />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} className="text-xs" />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
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
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    animationDuration={900}
                    isAnimationActive={chartAnimation}
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <EmptyState label={t("No data in this period")} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-violet-500" />
              {t("Volume trend")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreTrend.length > 0 ? (
              <ChartContainer
                config={localizedVolumeTrendConfig}
                accessibilityLabel={t("Disposition evaluation volume by date")}
                accessibilityDescription={summarizeChartData(
                  data.scoreTrend.map((point) =>
                    t("{date}: {count} evaluations", {
                      date: formatDateOnlyForDisplay(point.date, undefined, displayLocale),
                      count: point.count,
                    }),
                  ),
                  10,
                  locale,
                )}
                className="h-[260px] w-full"
              >
                <BarChart data={data.scoreTrend} margin={{ left: 8, right: 12 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                    tickFormatter={(v) =>
                      formatDateOnlyForDisplay(
                        String(v),
                        { day: "2-digit", month: "short" },
                        displayLocale,
                      )
                    }
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(label) =>
                          formatDateOnlyForDisplay(String(label), undefined, displayLocale)
                        }
                      />
                    }
                  />
                  <Bar
                    dataKey="count"
                    fill="#8b5cf6"
                    radius={[6, 6, 0, 0]}
                    animationDuration={900}
                    isAnimationActive={chartAnimation}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState label={t("No data in this period")} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-cyan-500" />
              {t("Score by Question")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreByQuestion.length > 0 ? (
              <ChartContainer
                config={localizedQuestionConfig}
                accessibilityLabel={t("Disposition Average Score by question")}
                accessibilityDescription={summarizeChartData(
                  data.scoreByQuestion
                    .slice(0, 8)
                    .map((question) => `${question.question}: ${question.avgScore.toFixed(1)}%`),
                  10,
                  locale,
                )}
                className="h-[320px] w-full"
              >
                <BarChart
                  data={data.scoreByQuestion.slice(0, 8)}
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
                    width={150}
                    className="text-xs"
                    tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 20)}…` : v)}
                  />
                  <ChartTooltip
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
                    {data.scoreByQuestion.slice(0, 8).map((q) => (
                      <Cell
                        key={q.question}
                        fill={getQuestionBarColor(q.avgScore, data.passThreshold)}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState label={t("No RATING questions")} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-orange-500" />
              {t("Top Evaluators")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topEvaluators.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Evaluator")}</TableHead>
                    <TableHead className="text-center">{t("Evals")}</TableHead>
                    <TableHead className="text-center">{t("Avg")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topEvaluators.map((e) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/analytics/evaluators/${e.id}`)}
                    >
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="text-center tabular-nums">{e.count}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={scoreBadgeVariant(e.avgScore, data.passThreshold)}
                          className="tabular-nums"
                        >
                          {e.avgScore.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState label={t("No evaluators")} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-violet-500" />
              {t("Top Agents")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topAgents.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Agent")}</TableHead>
                    <TableHead className="text-center">{t("Evals")}</TableHead>
                    <TableHead className="text-center">{t("Avg")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topAgents.map((a) => (
                    <TableRow
                      key={a.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/analytics/agents/${a.id}`)}
                    >
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="text-center tabular-nums">{a.count}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={scoreBadgeVariant(a.avgScore, data.passThreshold)}
                          className="tabular-nums"
                        >
                          {a.avgScore.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState label={t("No agents")} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Recent evaluations")}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentResponses.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Agent")}</TableHead>
                    <TableHead>{t("Evaluator")}</TableHead>
                    <TableHead className="text-center">{t("Score")}</TableHead>
                    <TableHead className="text-right">{t("Date")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentResponses.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/evaluations/${r.id}`)}
                    >
                      <TableCell className="font-medium">{r.agentName}</TableCell>
                      <TableCell className="text-muted-foreground">{r.evaluatorName}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={resultBadgeVariant(r.result)} className="tabular-nums">
                          {r.score.toFixed(1)}% · {r.result}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatOperationalTimestamp(
                          r.submittedAt,
                          operationalTimeZone,
                          { dateStyle: "short" },
                          displayLocale,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState label={t("No evaluations")} />
            )}
          </CardContent>
        </Card>
      </div>

      {data.sisterDispositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-cyan-500" />
              {t("Related Dispositions")}
              {data.categoryName && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {data.categoryName}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Disposition")}</TableHead>
                  <TableHead>{t("Code")}</TableHead>
                  <TableHead className="text-center">{t("Evals")}</TableHead>
                  <TableHead className="text-center">{t("Average Score")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sisterDispositions.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/analytics/dispositions/${s.id}`)}
                  >
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.code ?? "—"}</TableCell>
                    <TableCell className="text-center tabular-nums">{s.totalEvaluations}</TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={scoreBadgeVariant(s.avgScore, data.passThreshold)}
                        className="tabular-nums"
                      >
                        {s.avgScore.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
