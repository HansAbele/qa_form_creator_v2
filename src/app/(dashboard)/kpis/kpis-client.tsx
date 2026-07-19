"use client";

import { Activity, AlertTriangle, CheckCircle2, ShieldAlert, TrendingDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CeaDetail } from "@/components/dashboard/cea-detail";
import {
  DataEmptyState,
  DataLoadError,
  type DataLoadStatus,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
import { EvaluatorCalibrationTable } from "@/components/dashboard/evaluator-calibration-table";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { useI18n } from "@/components/providers/i18n-provider";
import { AccessibleChart } from "@/components/ui/accessible-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getMetricDisplay } from "@/lib/metric-display";
import type { AppSettings } from "@/lib/settings";
import { getKpiBundle } from "@/server/queries/analytics";

interface CampaignKpi {
  id: string;
  name: string;
  totalForms: number;
  totalAgents: number;
  totalEvaluators: number;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
  dailyRate: number;
  fatalFailCount: number;
  passThreshold: number;
  targetPassRate: number;
  targetAvgScore: number;
  targetDailyRate: number;
  fatalFailuresAllowed: number;
}

interface QuestionScore {
  question: string;
  avgScore: number;
  totalAnswers: number;
}

interface EvaluatorData {
  id: string;
  name: string;
  totalEvaluations: number;
  avgScore: number;
  stdDev: number;
}

interface QACategoryMetric {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  totalAnswers: number;
  totalEvaluations: number;
  avgScore: number;
  failedAnswers: number;
  failRate: number;
  fatalFailCount: number;
  commentCount: number;
}

// Brand-aligned palette: TNO orange + navy + supporting hues
const COLORS = ["#ff6600", "#1a2b45", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

function weightedTarget(
  kpis: CampaignKpi[],
  key: "passThreshold" | "targetPassRate" | "targetAvgScore",
  fallback: number,
) {
  if (kpis.length === 0) return fallback;
  const totalEvaluations = kpis.reduce((sum, kpi) => sum + kpi.totalEvaluations, 0);
  const denominator = totalEvaluations > 0 ? totalEvaluations : kpis.length;
  const total = kpis.reduce((sum, kpi) => {
    const weight = totalEvaluations > 0 ? kpi.totalEvaluations : 1;
    return sum + kpi[key] * weight;
  }, 0);
  return Math.round((total / denominator) * 100) / 100;
}

function targetVariant(isMet: boolean): "default" | "destructive" {
  return isMet ? "default" : "destructive";
}

function RecapItem({
  label,
  value,
  target,
  met,
}: {
  label: string;
  value: string;
  target: string;
  met: boolean | null;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-semibold tabular-nums ${
          met === null
            ? "text-muted-foreground"
            : met
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">/ {target}</span>
    </span>
  );
}

function KpisLoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-label={label} aria-busy="true">
      <div className="flex items-end justify-between gap-4">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-10 w-48" />
      </div>
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-52 w-full rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[360px] rounded-xl" />
        <Skeleton className="h-[360px] rounded-xl" />
      </div>
    </div>
  );
}

export function KpisClient({ settings }: { settings: AppSettings }) {
  const { t } = useI18n();
  const chartAnimation = useChartAnimation();
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [kpis, setKpis] = useState<CampaignKpi[]>([]);
  const [questionScores, setQuestionScores] = useState<QuestionScore[]>([]);
  const [evaluators, setEvaluators] = useState<EvaluatorData[]>([]);
  const [qaCategoryMetrics, setQACategoryMetrics] = useState<QACategoryMetric[]>([]);
  const [ceaDetail, setCeaDetail] = useState<
    Awaited<ReturnType<typeof getKpiBundle>>["ceaDetail"] | null
  >(null);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const requestGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    setKpis([]);
    setQuestionScores([]);
    setEvaluators([]);
    setQACategoryMetrics([]);
    setCeaDetail(null);
    try {
      const data = await getKpiBundle(dateFrom || undefined, dateTo || undefined);
      if (requestId !== requestGeneration.current) return;
      setKpis(data.campaignKpis);
      setQuestionScores(data.scoreByQuestion);
      setEvaluators(data.evaluatorActivity);
      setQACategoryMetrics(data.qaCategoryMetrics);
      setCeaDetail(data.ceaDetail);
      setLoadStatus(data.campaignKpis.length === 0 ? "empty" : "success");
    } catch (e) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(e, "kpis");
      setLoadStatus("error");
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  if (loadStatus === "loading" && kpis.length === 0) {
    return <KpisLoadingSkeleton label={t("Loading KPIs...")} />;
  }
  if (loadStatus === "error") {
    return <DataLoadError onRetry={() => void loadData()} title={t("Unable to load KPIs")} />;
  }
  if (loadStatus === "empty") {
    return <DataEmptyState title={t("No KPIs available")} />;
  }

  const totalEvaluations = kpis.reduce((sum, k) => sum + k.totalEvaluations, 0);
  const overallAvg =
    totalEvaluations > 0
      ? kpis.reduce((sum, k) => sum + k.avgScore * k.totalEvaluations, 0) / totalEvaluations
      : 0;
  const overallPassRate =
    totalEvaluations > 0
      ? Math.round(
          (kpis.reduce((sum, k) => sum + (k.passRate / 100) * k.totalEvaluations, 0) /
            totalEvaluations) *
            100,
        )
      : 0;
  const overallDailyRate = kpis.reduce((sum, k) => sum + k.dailyRate, 0);
  const totalFatalFailures = kpis.reduce((sum, k) => sum + k.fatalFailCount, 0);
  const hasEvaluationData = totalEvaluations > 0;
  const metricStatus = hasEvaluationData ? "success" : "empty";
  const averageScoreMetric = getMetricDisplay({
    kind: "measure",
    value: overallAvg,
    hasData: hasEvaluationData,
    status: metricStatus,
    decimals: 1,
    suffix: "%",
  });
  const passRateMetric = getMetricDisplay({
    kind: "measure",
    value: overallPassRate,
    hasData: hasEvaluationData,
    status: metricStatus,
    suffix: "%",
  });
  const dailyRateMetric = getMetricDisplay({
    kind: "measure",
    value: overallDailyRate,
    hasData: hasEvaluationData,
    status: metricStatus,
    decimals: 1,
  });
  const targets = {
    passThreshold: weightedTarget(kpis, "passThreshold", settings.passThreshold),
    passRate: weightedTarget(kpis, "targetPassRate", settings.targetPassRate),
    avgScore: weightedTarget(kpis, "targetAvgScore", settings.targetAvgScore),
    dailyRate:
      kpis.length > 0
        ? Math.round(kpis.reduce((sum, k) => sum + k.targetDailyRate, 0) * 100) / 100
        : settings.targetDailyRate,
    fatalFailuresAllowed: kpis.reduce((sum, k) => sum + k.fatalFailuresAllowed, 0),
  };

  // Alerts
  const alerts: { type: "warning" | "success"; msg: string }[] = [];
  if (hasEvaluationData && overallPassRate < targets.passRate)
    alerts.push({
      type: "warning",
      msg: t("Pass Rate ({value}%) is below target ({target}%)", {
        value: overallPassRate,
        target: targets.passRate,
      }),
    });
  else if (hasEvaluationData)
    alerts.push({
      type: "success",
      msg: t("Pass Rate ({value}%) meets target ({target}%)", {
        value: overallPassRate,
        target: targets.passRate,
      }),
    });

  if (hasEvaluationData && overallAvg < targets.avgScore)
    alerts.push({
      type: "warning",
      msg: t("Average Score ({value}%) is below target ({target}%)", {
        value: overallAvg.toFixed(1),
        target: targets.avgScore,
      }),
    });
  else if (hasEvaluationData)
    alerts.push({
      type: "success",
      msg: t("Average Score ({value}%) meets target ({target}%)", {
        value: overallAvg.toFixed(1),
        target: targets.avgScore,
      }),
    });

  if (hasEvaluationData && overallDailyRate < targets.dailyRate)
    alerts.push({
      type: "warning",
      msg: t("Daily Rate ({value}/day) is below target ({target}/day)", {
        value: overallDailyRate.toFixed(1),
        target: targets.dailyRate,
      }),
    });
  else if (hasEvaluationData)
    alerts.push({
      type: "success",
      msg: t("Daily Rate ({value}/day) meets target ({target}/day)", {
        value: overallDailyRate.toFixed(1),
        target: targets.dailyRate,
      }),
    });

  if (hasEvaluationData) {
    if (totalFatalFailures > targets.fatalFailuresAllowed)
      alerts.push({
        type: "warning",
        msg: t("Critical Failures ({value}) exceed the allowed limit ({allowed})", {
          value: totalFatalFailures,
          allowed: targets.fatalFailuresAllowed,
        }),
      });
    else
      alerts.push({
        type: "success",
        msg: t("Critical Failures ({value}) are within the allowed limit ({allowed})", {
          value: totalFatalFailures,
          allowed: targets.fatalFailuresAllowed,
        }),
      });
  }

  // Evaluator consistency alerts
  const inconsistentEvaluators = evaluators.filter((e) => e.stdDev > 20 && e.totalEvaluations >= 5);
  if (inconsistentEvaluators.length > 0) {
    alerts.push({
      type: "warning",
      msg: t("{count} evaluator(s) with high variability (±>20): {names}", {
        count: inconsistentEvaluators.length,
        names: inconsistentEvaluators.map((e) => e.name).join(", "),
      }),
    });
  }

  const qaCategoriesAtRisk = qaCategoryMetrics.filter(
    (category) => category.fatalFailCount > 0 || category.failRate >= 20,
  );
  if (qaCategoriesAtRisk.length > 0) {
    alerts.push({
      type: "warning",
      msg: t("{count} QA category/categories with below-threshold or critical failures", {
        count: qaCategoriesAtRisk.length,
      }),
    });
  }

  // CEA below benchmark (COPC 2.7.1.d)
  if (ceaDetail?.configured) {
    const CEA_LABEL: Record<string, string> = {
      CUSTOMER: "Customer",
      BUSINESS: "Business",
      COMPLIANCE: "Compliance",
    };
    for (const fam of ceaDetail.overall) {
      if (fam.configured && fam.accuracy !== null && fam.accuracy < fam.target) {
        alerts.push({
          type: "warning",
          msg: t("{family} CEA ({value}%) is below benchmark ({target}%)", {
            family: CEA_LABEL[fam.family],
            value: fam.accuracy.toFixed(1),
            target: fam.target,
          }),
        });
      }
    }
  }

  const pieData = kpis
    .filter((k) => k.totalEvaluations > 0)
    .map((k) => ({ name: k.name, value: k.totalEvaluations }));
  const qaCategoryChartData = [...qaCategoryMetrics].sort((a, b) => a.avgScore - b.avgScore);

  return (
    <div className="space-y-6">
      {/* Header + Date Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("Campaign KPIs")}</h1>
        <DateRangeFilter
          id="kpi-period"
          label={t("Period")}
          from={dateFrom}
          to={dateTo}
          onApply={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
          className="w-full sm:w-auto"
          triggerClassName="sm:min-w-48"
        />
      </div>

      {/* Compact target recap — the hero KPI cards live on the Dashboard; KPIs leads with diagnostics */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
        {!hasEvaluationData ? <Badge variant="outline">{t("No data")}</Badge> : null}
        <span className="flex items-center gap-1.5">
          <span className="font-semibold tabular-nums">{totalEvaluations}</span>
          <span className="text-muted-foreground">{t("evaluations")}</span>
        </span>
        <RecapItem
          label={t("Score")}
          value={averageScoreMetric.text ?? "—"}
          target={`${targets.avgScore}%`}
          met={hasEvaluationData ? overallAvg >= targets.avgScore : null}
        />
        <RecapItem
          label={t("Pass Rate")}
          value={passRateMetric.text ?? "—"}
          target={`${targets.passRate}%`}
          met={hasEvaluationData ? overallPassRate >= targets.passRate : null}
        />
        <RecapItem
          label={t("Daily Rate")}
          value={dailyRateMetric.text ?? "—"}
          target={`${targets.dailyRate}/d`}
          met={hasEvaluationData ? overallDailyRate >= targets.dailyRate : null}
        />
        <RecapItem
          label={t("Critical Failures")}
          value={String(totalFatalFailures)}
          target={String(targets.fatalFailuresAllowed)}
          met={hasEvaluationData ? totalFatalFailures <= targets.fatalFailuresAllowed : null}
        />
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> {t("Alerts")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((a) => (
              <div
                key={`${a.type}-${a.msg}`}
                className={`flex items-center gap-2 rounded-lg p-2 text-sm ${a.type === "warning" ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"}`}
              >
                {a.type === "warning" ? (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                )}
                {a.msg}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* CEA deep-dive (COPC 2.7.1.d) — the KPIs protagonist */}
      {ceaDetail && <CeaDetail data={ceaDetail} />}

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Average Score by Campaign")}</CardTitle>
          </CardHeader>
          <CardContent>
            {kpis.some((kpi) => kpi.totalEvaluations > 0) ? (
              (() => {
                const sorted = kpis
                  .filter((kpi) => kpi.totalEvaluations > 0)
                  .sort((a, b) => b.avgScore - a.avgScore);
                return (
                  <AccessibleChart
                    label={t("Average Score by Campaign")}
                    description={sorted
                      .map((item) => `${item.name}: ${item.avgScore.toFixed(1)}%`)
                      .join("; ")}
                  >
                    <ResponsiveContainer width="100%" height={Math.max(320, sorted.length * 32)}>
                      <BarChart data={sorted} layout="vertical" margin={{ right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis type="number" domain={[0, 100]} />
                        <YAxis
                          dataKey="name"
                          type="category"
                          width={160}
                          className="text-xs"
                          tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 18)}…` : v)}
                        />
                        <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]} />
                        <Bar
                          dataKey="avgScore"
                          radius={[0, 4, 4, 0]}
                          isAnimationActive={chartAnimation}
                        >
                          {sorted.map((item, i) => (
                            <Cell key={item.id} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </AccessibleChart>
                );
              })()
            ) : (
              <div className="flex h-[300px] items-center justify-center text-muted-foreground">
                {t("No data")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Evaluation distribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <AccessibleChart
                label={t("Evaluation distribution by campaign")}
                description={pieData
                  .map((item) =>
                    t("{name}: {count} evaluations", {
                      name: item.name,
                      count: item.value,
                    }),
                  )
                  .join("; ")}
              >
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      dataKey="value"
                      label={(props) => `${props.name}: ${props.value}`}
                      isAnimationActive={chartAnimation}
                    >
                      {pieData.map((item, i) => (
                        <Cell key={item.name} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </AccessibleChart>
            ) : (
              <div className="flex h-[300px] items-center justify-center text-muted-foreground">
                {t("No data")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Score by Question */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="h-4 w-4" />
            {t("Score by Question (lowest to highest)")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {questionScores.length > 0 ? (
            <AccessibleChart
              label={t("Score by Question, lowest to highest")}
              description={questionScores
                .map((item) => `${item.question}: ${item.avgScore.toFixed(1)}%`)
                .join("; ")}
            >
              <ResponsiveContainer width="100%" height={Math.max(200, questionScores.length * 40)}>
                <BarChart data={questionScores} layout="vertical" margin={{ left: 150 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis dataKey="question" type="category" width={145} className="text-xs" />
                  <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]} />
                  <Bar dataKey="avgScore" radius={[0, 4, 4, 0]} isAnimationActive={chartAnimation}>
                    {questionScores.map((q) => (
                      <Cell
                        key={q.question}
                        fill={
                          q.avgScore >= targets.avgScore
                            ? "#22c55e"
                            : q.avgScore >= targets.passThreshold
                              ? "#f59e0b"
                              : "#ef4444"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </AccessibleChart>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              {t("No RATING question data")}
            </div>
          )}
        </CardContent>
      </Card>

      {/* QA Category Metrics */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" />
              {t("Score by QA Category")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {qaCategoryChartData.length > 0 ? (
              <AccessibleChart
                label={t("Score by QA Category")}
                description={qaCategoryChartData
                  .map((item) => `${item.name}: ${item.avgScore.toFixed(1)}%`)
                  .join("; ")}
              >
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(240, qaCategoryChartData.length * 42)}
                >
                  <BarChart
                    data={qaCategoryChartData}
                    layout="vertical"
                    margin={{ left: 150, right: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={145}
                      className="text-xs"
                      tickFormatter={(value: string) =>
                        value.length > 20 ? `${value.slice(0, 18)}...` : value
                      }
                    />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]} />
                    <Bar
                      dataKey="avgScore"
                      radius={[0, 4, 4, 0]}
                      isAnimationActive={chartAnimation}
                    >
                      {qaCategoryChartData.map((category, index) => (
                        <Cell
                          key={category.id}
                          fill={
                            category.avgScore >= targets.passThreshold
                              ? (category.color ?? COLORS[index % COLORS.length])
                              : "#ef4444"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </AccessibleChart>
            ) : (
              <div className="flex h-[240px] items-center justify-center text-muted-foreground">
                {t("No QA category data")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Risk by QA Category")}</CardTitle>
          </CardHeader>
          <CardContent>
            {qaCategoryMetrics.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Category")}</TableHead>
                    <TableHead className="text-right">{t("Score")}</TableHead>
                    <TableHead className="text-right">{t("Eval.")}</TableHead>
                    <TableHead className="text-right">{t("Below threshold")}</TableHead>
                    <TableHead className="text-right">{t("Critical")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {qaCategoryMetrics.map((category) => (
                    <TableRow key={category.id}>
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: category.color ?? "#ff6600" }}
                          />
                          <span className="truncate font-medium">{category.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            category.avgScore >= targets.passThreshold ? "default" : "destructive"
                          }
                          className="tabular-nums"
                        >
                          {category.avgScore.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {category.totalEvaluations}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={category.failedAnswers > 0 ? "secondary" : "outline"}
                          className="tabular-nums"
                        >
                          {category.failedAnswers} ({category.failRate}%)
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={category.fatalFailCount > 0 ? "destructive" : "outline"}
                          className="tabular-nums"
                        >
                          {category.fatalFailCount}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex h-[240px] items-center justify-center text-muted-foreground">
                {t("No evaluated QA categories")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Evaluator calibration (full — stdDev + delta vs global) */}
      <EvaluatorCalibrationTable
        evaluators={evaluators}
        teamAvg={overallAvg}
        interactive
        onNavigate={(href) => router.push(href)}
      />

      {/* Campaign Detail Cards */}
      <h2 className="text-xl font-semibold">{t("Campaign details")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <Card
            key={kpi.id}
            className={
              kpi.totalEvaluations > 0 &&
              (kpi.avgScore < kpi.targetAvgScore ||
                kpi.passRate < kpi.targetPassRate ||
                kpi.dailyRate < kpi.targetDailyRate ||
                kpi.fatalFailCount > kpi.fatalFailuresAllowed)
                ? "border-red-200"
                : ""
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{kpi.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">{t("Forms")}</p>
                  <p className="font-medium">{kpi.totalForms}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("Agents")}</p>
                  <p className="font-medium">{kpi.totalAgents}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("Evaluators")}</p>
                  <p className="font-medium">{kpi.totalEvaluators}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("Evaluated Calls")}</p>
                  <p className="font-medium">{kpi.totalEvaluations}</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t("Score")}</p>
                  <Badge
                    variant={
                      kpi.totalEvaluations > 0
                        ? targetVariant(kpi.avgScore >= kpi.targetAvgScore)
                        : "outline"
                    }
                  >
                    {kpi.totalEvaluations > 0
                      ? `${kpi.avgScore.toFixed(1)}% / ${kpi.targetAvgScore}%`
                      : "—"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("Pass Rate")}</p>
                  <Badge
                    variant={
                      kpi.totalEvaluations > 0
                        ? targetVariant(kpi.passRate >= kpi.targetPassRate)
                        : "outline"
                    }
                  >
                    {kpi.totalEvaluations > 0 ? `${kpi.passRate}% / ${kpi.targetPassRate}%` : "—"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("Daily")}</p>
                  <Badge
                    variant={
                      kpi.totalEvaluations === 0 || kpi.dailyRate >= kpi.targetDailyRate
                        ? "outline"
                        : "destructive"
                    }
                  >
                    {kpi.totalEvaluations > 0
                      ? `${kpi.dailyRate.toFixed(1)}/${kpi.targetDailyRate}/d`
                      : "—"}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-muted-foreground">{t("Critical Failures")}</span>
                <Badge
                  variant={
                    kpi.fatalFailCount <= kpi.fatalFailuresAllowed ? "outline" : "destructive"
                  }
                  className="tabular-nums"
                >
                  {kpi.fatalFailCount}/{kpi.fatalFailuresAllowed}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
