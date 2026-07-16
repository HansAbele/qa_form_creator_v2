"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Award,
  Calendar,
  ClipboardCheck,
  ShieldAlert,
  Tag,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { CeaGauges, type CeaFamily } from "@/components/dashboard/cea-gauges";
import { NeedsAttentionStrip } from "@/components/dashboard/needs-attention-strip";
import { AgentsToCoach } from "@/components/dashboard/agents-to-coach";
import {
  EvaluatorCalibrationTable,
  type EvaluatorRow,
} from "@/components/dashboard/evaluator-calibration-table";
import {
  getCriticalErrorAccuracy,
  getDashboardCampaignKpis,
  getDashboardCoachingInsights,
  getDashboardDispositionAnalytics,
  getDashboardEvaluatorActivity,
  getDashboardOutcomeKpis,
  getDashboardStats,
  getResponseTrends,
  getScoreDistribution,
} from "@/server/queries/analytics";
import type { UiAccess } from "@/server/queries/ui-access";

type Stats = Awaited<ReturnType<typeof getDashboardStats>>;
type Insights = Awaited<ReturnType<typeof getDashboardCoachingInsights>>;
type CampaignPerf = Awaited<ReturnType<typeof getDashboardCampaignKpis>>;
type DispAnalytics = Awaited<ReturnType<typeof getDashboardDispositionAnalytics>>;
type OutcomeKpis = Awaited<ReturnType<typeof getDashboardOutcomeKpis>>;

export function DashboardManager({
  userName,
  access,
  campaigns,
}: {
  userName: string;
  access: UiAccess;
  campaigns: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);

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
    setLoading(true);
    try {
      const cid = campaignId || undefined;
      const df = dateFrom || undefined;
      const dt = dateTo || undefined;
      const [s, t, d, ceaData, ins, ev, cp, da, oc] = await Promise.all([
        getDashboardStats(cid, df, dt),
        getResponseTrends(cid, df, dt),
        getScoreDistribution(cid, df, dt),
        getCriticalErrorAccuracy(cid, df, dt),
        getDashboardCoachingInsights(cid, df, dt),
        getDashboardEvaluatorActivity(cid, df, dt),
        getDashboardCampaignKpis(cid, df, dt),
        getDashboardDispositionAnalytics(cid, df, dt),
        getDashboardOutcomeKpis(cid, df, dt),
      ]);
      setStats(s);
      setTrends(t);
      setDistribution(d);
      setCea(ceaData);
      setInsights(ins);
      setEvaluators(ev);
      setCampaignPerf(cp);
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

  if (loading && !stats) return <DashboardSpinner />;
  if (!stats) return null;

  const canOpenKpiDetails = access.canViewKPIs;
  const countTrend = trends.map((t) => ({ value: t.count }));
  const scoreTrend = trends.map((t) => ({ value: t.avgScore }));

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
    const params = new URLSearchParams({ status: "fail" });
    if (campaignId) params.set("campaignId", campaignId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    router.push(`/analytics/responses?${params}`);
  }

  const rootCauseCategories = (insights?.categoryOpportunities ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <ContextBar
        title="Dashboard"
        subtitle={
          <>
            Bienvenido de vuelta,{" "}
            <span className="font-medium text-foreground">{userName}</span>
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

      {/* KPI row — program health (no "Total Formularios"); columns match card count so the row fills evenly */}
      <div
        className={`grid gap-4 sm:grid-cols-2 ${
          outcomeKpis.classifiedTotal > 0 ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-5"
        }`}
      >
        <KpiCard
          label="Evaluaciones"
          value={stats.responseCount}
          icon={ClipboardCheck}
          tone="orange"
          trend={countTrend}
          index={0}
        />
        <KpiCard
          label={`Score promedio (target ${stats.targetAvgScore}%)`}
          value={stats.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={stats.avgScore >= stats.targetAvgScore ? "emerald" : "rose"}
          trend={scoreTrend}
          index={1}
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
          index={2}
        />
        <KpiCard
          label={`Tasa diaria (target ${stats.targetDailyRate}/d)`}
          value={stats.dailyRate}
          decimals={1}
          icon={Calendar}
          tone={stats.dailyRate >= stats.targetDailyRate ? "emerald" : "amber"}
          index={3}
        />
        <KpiCard
          label={`Fatales permitidas ${stats.fatalFailuresAllowed}`}
          value={stats.fatalFailCount}
          icon={ShieldAlert}
          tone={stats.fatalFailCount <= stats.fatalFailuresAllowed ? "emerald" : "rose"}
          index={4}
        />
        {outcomeKpis.classifiedTotal > 0 ? (
          <KpiCard
            label="Resolución (FCR) · derivado de monitoreo"
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
        <CeaGauges data={cea} onViewIncidents={canOpenKpiDetails ? viewComplianceIncidents : undefined} />
      </Section>

      {/* Distribution + volume trend (coverage signals) */}
      <Section delay={0.12}>
        <div className="grid gap-6 lg:grid-cols-2">
          <DistributionCard title="Distribución de scores" data={distribution} />
          <VolumeTrendCard trends={trends} icon={Calendar} />
        </div>
      </Section>

      {/* Trend + root cause */}
      <Section delay={0.16}>
        <div className="grid gap-6 lg:grid-cols-2">
          <ScoreTrendCard trends={trends} targetAvgScore={stats.targetAvgScore} icon={TrendingUp} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Errores por categoría QA</CardTitle>
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
                          {c.fatalFailCount} fatal
                        </span>
                      )}
                      <Badge variant="destructive" className="tabular-nums">
                        {c.avgScore.toFixed(1)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState label="Todas las categorías en target" />
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
                Rendimiento por campaña
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  Click para filtrar
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
                            isSelected ? "bg-violet-500/10 ring-1 ring-violet-500/30" : "hover:bg-muted/40"
                          }`}
                          onClick={() => setCampaignId(isSelected ? "" : entry.id)}
                          title={`${entry.name} · ${entry.totalEvaluations} evaluaciones`}
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
                                  entry.avgScore >= entry.targetAvgScore ? "bg-emerald-500" : "bg-rose-500"
                                }`}
                                style={{ width: `${Math.min(100, entry.avgScore)}%` }}
                              />
                            )}
                          </div>
                          <div className="flex w-[190px] shrink-0 items-center justify-end gap-1.5">
                            <Badge
                              variant={entry.avgScore >= entry.targetAvgScore ? "default" : "destructive"}
                              className="tabular-nums"
                            >
                              {hasData ? `${entry.avgScore.toFixed(1)}/${entry.targetAvgScore}%` : "-"}
                            </Badge>
                            <Badge
                              variant={entry.passRate >= entry.targetPassRate ? "outline" : "destructive"}
                              className="tabular-nums"
                            >
                              PR {entry.passRate}%
                            </Badge>
                            <Badge
                              variant={
                                entry.fatalFailCount <= entry.fatalFailuresAllowed ? "outline" : "destructive"
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

          <Card className="flex self-start lg:h-[clamp(460px,55vh,620px)] lg:flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Tag className="h-4 w-4 text-cyan-500" />
                Disposiciones frecuentes
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  derivado de monitoreo
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
                    <span className="tabular-nums">{totalDispositionEvaluations} evaluaciones</span>
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
                            canOpenKpiDetails ? "cursor-pointer hover:bg-muted/40" : "cursor-default"
                          }`}
                          onClick={
                            canOpenKpiDetails
                              ? () => router.push(`/analytics/dispositions/${entry.id}`)
                              : undefined
                          }
                          title={`${entry.name} · ${entry.totalEvaluations} evaluaciones`}
                        >
                          <div className="mb-2 flex items-center gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                              {i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{entry.name}</div>
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
                <EmptyState label="Sin disposiciones con evaluaciones" />
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
