"use client";

import {
  Award,
  Calendar,
  ClipboardCheck,
  ShieldAlert,
  Tag,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentsToCoach } from "@/components/dashboard/agents-to-coach";
import { type CeaFamily, CeaGauges } from "@/components/dashboard/cea-gauges";
import {
  BAR_COLORS,
  ContextBar,
  DashboardSpinner,
  DistributionCard,
  EmptyState,
  ScoreTrendCard,
  Section,
  VolumeTrendCard,
} from "@/components/dashboard/dashboard-shared";
import {
  DataLoadError,
  type DataLoadStatus,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
import {
  EvaluatorCalibrationTable,
  type EvaluatorRow,
} from "@/components/dashboard/evaluator-calibration-table";
import { NeedsAttentionStrip } from "@/components/dashboard/needs-attention-strip";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { getMetricDisplay } from "@/lib/metric-display";
import { getDashboardManagerBundle } from "@/server/queries/analytics";
import type { UiAccess } from "@/server/queries/ui-access";

type DashboardBundle = Awaited<ReturnType<typeof getDashboardManagerBundle>>;
type Stats = DashboardBundle["stats"];
type Insights = DashboardBundle["coachingInsights"];
type CampaignPerf = DashboardBundle["campaignKpis"];
type DispAnalytics = DashboardBundle["dispositionAnalytics"];
type OutcomeKpis = DashboardBundle["outcomeKpis"];

export function DashboardManager({
  userName,
  access,
  campaigns,
}: {
  userName: string;
  access: UiAccess;
  campaigns: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [campaignId, setCampaignId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const requestGeneration = useRef(0);

  const [stats, setStats] = useState<Stats | null>(null);
  const [trends, setTrends] = useState<{ date: string; count: number; avgScore: number }[]>([]);
  const [distribution, setDistribution] = useState<{ range: string; count: number }[]>([]);
  const [cea, setCea] = useState<CeaFamily[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [evaluators, setEvaluators] = useState<EvaluatorRow[]>([]);
  const [campaignPerf, setCampaignPerf] = useState<CampaignPerf>([]);
  const [dispAnalytics, setDispAnalytics] = useState<DispAnalytics>([]);
  const [outcomeKpis, setOutcomeKpis] = useState<OutcomeKpis>({
    classifiedTotal: 0,
    resolved: 0,
    escalated: 0,
    resolutionRate: 0,
    escalationRate: 0,
  });

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    try {
      const cid = campaignId || undefined;
      const df = dateFrom || undefined;
      const dt = dateTo || undefined;
      const data = await getDashboardManagerBundle(cid, df, dt);
      if (requestId !== requestGeneration.current) return;
      setStats(data.stats);
      setTrends(data.trends);
      setDistribution(data.distribution);
      setCea(data.criticalErrorAccuracy);
      setInsights(data.coachingInsights);
      setEvaluators(data.evaluatorActivity);
      setCampaignPerf(data.campaignKpis);
      setDispAnalytics(data.dispositionAnalytics);
      setOutcomeKpis(data.outcomeKpis);
      setLoadStatus(data.stats.responseCount === 0 ? "empty" : "success");
    } catch (e) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(e, "dashboard-manager");
      setLoadStatus("error");
    }
  }, [campaignId, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  if (loadStatus === "loading" && !stats) return <DashboardSpinner />;
  if (loadStatus === "error") {
    return <DataLoadError onRetry={() => void loadData()} title={t("Unable to load dashboard")} />;
  }
  if (!stats) {
    return <DataLoadError onRetry={() => void loadData()} title={t("Unable to load dashboard")} />;
  }

  const canOpenKpiDetails = access.canViewKPIs;
  const countTrend = trends.map((t) => ({ value: t.count }));
  const scoreTrend = trends.map((t) => ({ value: t.avgScore }));
  const hasData = stats.responseCount > 0;
  const responseCountDisplay = getMetricDisplay({
    kind: "count",
    value: stats.responseCount,
    hasData,
    status: loadStatus,
  });
  const averageScoreDisplay = getMetricDisplay({
    kind: "measure",
    value: stats.avgScore,
    hasData,
    status: loadStatus,
    decimals: 1,
    suffix: "%",
  });
  const passRateDisplay = getMetricDisplay({
    kind: "measure",
    value: stats.passRate,
    hasData,
    status: loadStatus,
    suffix: "%",
  });
  const dailyRateDisplay = getMetricDisplay({
    kind: "measure",
    value: stats.dailyRate,
    hasData,
    status: loadStatus,
    decimals: 1,
  });
  const criticalFailuresDisplay = getMetricDisplay({
    kind: "count",
    value: stats.fatalFailCount,
    hasData,
    status: loadStatus,
  });
  const metricStatusLabel = loadStatus === "empty" ? t("No data") : undefined;

  const sortedCampaignPerf = [...campaignPerf].sort((a, b) => {
    const aActive = a.totalEvaluations > 0;
    const bActive = b.totalEvaluations > 0;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return b.avgScore - a.avgScore;
  });
  const activeCampaignCount = sortedCampaignPerf.filter((e) => e.totalEvaluations > 0).length;
  const topDispositions = dispAnalytics.slice(0, 8);
  const maxDispositionTotal = Math.max(1, ...topDispositions.map((e) => e.totalEvaluations));
  const totalDispositionEvaluations = dispAnalytics.reduce((sum, e) => sum + e.totalEvaluations, 0);

  function viewComplianceIncidents() {
    const params = new URLSearchParams({ status: "fail", scope: "managed" });
    if (campaignId) params.set("campaignId", campaignId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    router.push(`/evaluations?${params}`);
  }

  const rootCauseCategories = (insights?.categoryOpportunities ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <ContextBar
        title={t("Dashboard")}
        subtitle={
          <>
            {t("Welcome back,")} <span className="font-medium text-foreground">{userName}</span>
          </>
        }
        campaigns={campaigns}
        campaignId={campaignId}
        onCampaignChange={setCampaignId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onApplyDates={(f, t) => {
          setDateFrom(f);
          setDateTo(t);
        }}
      />

      {loadStatus === "empty" ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
        >
          {t("No evaluations match the selected filters. Count metrics are shown as zero.")}
        </div>
      ) : null}

      {/* KPI row — program health (no "Total Formularios"); columns match card count so the row fills evenly */}
      <div
        className={`grid gap-4 sm:grid-cols-2 ${
          outcomeKpis.classifiedTotal > 0 ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-5"
        }`}
      >
        <KpiCard
          label={t("Evaluated Calls")}
          value={stats.responseCount}
          display={responseCountDisplay}
          statusLabel={metricStatusLabel}
          icon={ClipboardCheck}
          tone="orange"
          trend={countTrend}
          index={0}
        />
        <KpiCard
          label={t("Average Score (target {target}%)", { target: stats.targetAvgScore })}
          value={stats.avgScore}
          display={averageScoreDisplay}
          statusLabel={metricStatusLabel}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={hasData ? (stats.avgScore >= stats.targetAvgScore ? "emerald" : "rose") : "navy"}
          trend={scoreTrend}
          index={1}
        />
        <KpiCard
          label={t("Pass Rate (target {target}%)", { target: stats.targetPassRate })}
          value={stats.passRate}
          display={passRateDisplay}
          statusLabel={metricStatusLabel}
          suffix="%"
          icon={Award}
          tone={
            !hasData
              ? "navy"
              : stats.passRate >= stats.targetPassRate
                ? "emerald"
                : stats.passRate >= stats.passThreshold
                  ? "amber"
                  : "rose"
          }
          index={2}
        />
        <KpiCard
          label={t("Daily Rate (target {target}/day)", { target: stats.targetDailyRate })}
          value={stats.dailyRate}
          display={dailyRateDisplay}
          statusLabel={metricStatusLabel}
          decimals={1}
          icon={Calendar}
          tone={hasData ? (stats.dailyRate >= stats.targetDailyRate ? "emerald" : "amber") : "navy"}
          index={3}
        />
        <KpiCard
          label={t("Critical Failures (allowed {allowed})", {
            allowed: stats.fatalFailuresAllowed,
          })}
          value={stats.fatalFailCount}
          display={criticalFailuresDisplay}
          statusLabel={metricStatusLabel}
          icon={ShieldAlert}
          tone={
            hasData
              ? stats.fatalFailCount <= stats.fatalFailuresAllowed
                ? "emerald"
                : "rose"
              : "navy"
          }
          index={4}
        />
        {outcomeKpis.classifiedTotal > 0 ? (
          <KpiCard
            label={t("Resolution (FCR) · monitoring-derived")}
            value={outcomeKpis.resolutionRate}
            decimals={1}
            suffix="%"
            icon={Award}
            tone={
              outcomeKpis.resolutionRate >= 80
                ? "emerald"
                : outcomeKpis.resolutionRate >= 70
                  ? "amber"
                  : "rose"
            }
            index={5}
          />
        ) : null}
      </div>

      {/* CEA — the COPC differentiator */}
      <Section delay={0.08}>
        <CeaGauges
          data={cea}
          onViewIncidents={canOpenKpiDetails ? viewComplianceIncidents : undefined}
        />
      </Section>

      {/* Distribution + volume trend (coverage signals) */}
      <Section delay={0.12}>
        <div className="grid gap-6 lg:grid-cols-2">
          <DistributionCard title={t("Score distribution")} data={distribution} />
          <VolumeTrendCard trends={trends} icon={Calendar} />
        </div>
      </Section>

      {/* Trend + root cause */}
      <Section delay={0.16}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ScoreTrendCard trends={trends} targetAvgScore={stats.targetAvgScore} icon={TrendingUp} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Errors by QA category")}</CardTitle>
            </CardHeader>
            <CardContent>
              {rootCauseCategories.length > 0 ? (
                <div className="space-y-2">
                  {rootCauseCategories.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color ?? "#94a3b8" }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                      {c.fatalFailCount > 0 && (
                        <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-600 tabular-nums dark:text-rose-400">
                          {t(
                            c.fatalFailCount === 1
                              ? "{count} critical failure"
                              : "{count} critical failures",
                            { count: c.fatalFailCount },
                          )}
                        </span>
                      )}
                      <Badge variant="destructive" className="tabular-nums">
                        {c.avgScore.toFixed(1)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState label={t("All categories are on target")} />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Coaching + evaluator governance */}
      <Section delay={0.2}>
        <div className="grid gap-6 lg:grid-cols-2">
          <AgentsToCoach
            agents={insights?.agentRisks ?? []}
            targetAvgScore={stats.targetAvgScore}
            interactive={canOpenKpiDetails}
            onNavigate={(href) => router.push(href)}
          />
          <EvaluatorCalibrationTable
            evaluators={evaluators}
            teamAvg={stats.avgScore}
            interactive={canOpenKpiDetails}
            onNavigate={(href) => router.push(href)}
          />
        </div>
      </Section>

      {/* Campaigns + dispositions (summary → drill-down) */}
      <Section delay={0.24}>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
          <Card className="flex overflow-hidden lg:h-[clamp(460px,55vh,620px)] lg:flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <UsersRound className="h-4 w-4 text-violet-500" />
                {t("Campaign performance")}
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {t("Click to filter")}
                </span>
              </CardTitle>
              {campaignPerf.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="secondary" className="font-normal">
                    {activeCampaignCount} {t("with data")}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {campaignPerf.length - activeCampaignCount} {t("without data")}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {campaignPerf.length} {t("campaigns")}
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
                          onClick={() => setCampaignId(isSelected ? "" : entry.id)}
                          title={t("{name} · {count} evaluations", {
                            name: entry.name,
                            count: entry.totalEvaluations,
                          })}
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
                                !hasData
                                  ? "outline"
                                  : entry.avgScore >= entry.targetAvgScore
                                    ? "default"
                                    : "destructive"
                              }
                              className="tabular-nums"
                            >
                              {hasData
                                ? `${entry.avgScore.toFixed(1)}/${entry.targetAvgScore}%`
                                : "—"}
                            </Badge>
                            <Badge
                              variant={
                                !hasData || entry.passRate >= entry.targetPassRate
                                  ? "outline"
                                  : "destructive"
                              }
                              className="tabular-nums"
                            >
                              PR {hasData ? `${entry.passRate}%` : "—"}
                            </Badge>
                            <Badge
                              variant={
                                entry.fatalFailCount <= entry.fatalFailuresAllowed
                                  ? "outline"
                                  : "destructive"
                              }
                              className="tabular-nums"
                              title={t("Critical Failures")}
                            >
                              CF {entry.fatalFailCount}/{entry.fatalFailuresAllowed}
                            </Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <EmptyState label={t("No campaigns with evaluations")} />
              )}
            </CardContent>
          </Card>

          <Card className="flex self-start lg:h-[clamp(460px,55vh,620px)] lg:flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Tag className="h-4 w-4 text-cyan-500" />
                {t("Frequent Dispositions")}
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  {t("monitoring-derived")}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              {dispAnalytics.length > 0 ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      {t("Top {shown} of {total}", {
                        shown: topDispositions.length,
                        total: dispAnalytics.length,
                      })}
                    </span>
                    <span className="tabular-nums">
                      {t("{count} evaluations", { count: totalDispositionEvaluations })}
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
                              ? () => router.push(`/analytics/dispositions/${entry.id}`)
                              : undefined
                          }
                          title={t("{name} · {count} evaluations", {
                            name: entry.name,
                            count: entry.totalEvaluations,
                          })}
                        >
                          <div className="mb-2 flex items-center gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{entry.name}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {entry.categoryName ?? entry.code ?? t("Uncategorized")}
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
                                width: `${Math.max(4, (entry.totalEvaluations / maxDispositionTotal) * 100)}%`,
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
                <EmptyState label={t("No Dispositions with evaluations")} />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* Needs attention */}
      {insights && (
        <Section delay={0.28}>
          <NeedsAttentionStrip
            insights={insights}
            onNavigate={(href) => router.push(href)}
            onSelectCampaign={(id) => setCampaignId(id)}
          />
        </Section>
      )}
    </div>
  );
}
