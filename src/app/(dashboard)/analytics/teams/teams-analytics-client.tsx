"use client";

import { ArrowLeft, Award, Target, TrendingUp, UsersRound } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  DataLoadError,
  type DataLoadStatus,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
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
import { useChartAnimation } from "@/components/ui/use-chart-animation";
import { summarizeChartData } from "@/lib/chart-accessibility";
import { getMetricDisplay } from "@/lib/metric-display";
import type { AppSettings } from "@/lib/settings";
import { getTeamPerformance } from "@/server/queries/analytics";

const scoreConfig = {
  avgScore: { label: "Average Score", color: "#8b5cf6" },
} satisfies ChartConfig;

const BAR_COLORS = ["#8b5cf6", "#ff6600", "#10b981", "#06b6d4", "#f59e0b", "#1a2b45"];

type TeamPerf = Awaited<ReturnType<typeof getTeamPerformance>>[number];

function Section({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
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

export function TeamsAnalyticsClient({ settings }: { settings: AppSettings }) {
  const { locale, t } = useI18n();
  const localizedScoreConfig = {
    ...scoreConfig,
    avgScore: { ...scoreConfig.avgScore, label: t("Average Score") },
  } satisfies ChartConfig;
  const chartAnimation = useChartAnimation();
  const router = useRouter();
  const [teams, setTeams] = useState<TeamPerf[]>([]);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const requestGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    try {
      const data = await getTeamPerformance();
      if (requestId !== requestGeneration.current) return;
      setTeams(data);
      setLoadStatus(data.length === 0 ? "empty" : "success");
    } catch (error) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(error, "teams-analytics");
      setLoadStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  if (loadStatus === "loading") {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          className="h-8 w-8 rounded-full border-2 border-violet-500/30 border-t-violet-500"
        />
      </div>
    );
  }

  if (loadStatus === "error") {
    return <DataLoadError onRetry={() => void loadData()} title={t("Unable to load teams")} />;
  }

  const evaluatedTeams = teams.filter((team) => team.evalCount > 0);
  const evaluationCount = evaluatedTeams.reduce((sum, team) => sum + team.evalCount, 0);
  const avgAll =
    evaluationCount > 0
      ? evaluatedTeams.reduce((sum, team) => sum + team.avgScore * team.evalCount, 0) /
        evaluationCount
      : 0;
  const averageScoreDisplay = getMetricDisplay({
    kind: "measure",
    value: avgAll,
    hasData: evaluationCount > 0,
    status: evaluationCount > 0 ? "success" : "empty",
    decimals: 1,
    suffix: "%",
  });
  const chartTeams = evaluatedTeams.map((team) => ({
    ...team,
    displayName: `${team.name} \u00b7 ${team.campaignName}`,
  }));

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <Button variant="ghost" size="icon-xs" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <UsersRound className="h-7 w-7 text-violet-500" />
            {t("Team performance")}
          </h1>
        </div>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label={t("Teams")}
          value={teams.length}
          statusLabel={teams.length > 0 ? undefined : t("No data")}
          icon={UsersRound}
          tone="violet"
          index={0}
        />
        <KpiCard
          label={t("Overall Average Score")}
          value={avgAll}
          display={averageScoreDisplay}
          statusLabel={evaluationCount > 0 ? undefined : t("No data")}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={
            evaluationCount > 0 ? (avgAll >= settings.passThreshold ? "emerald" : "amber") : "navy"
          }
          index={1}
        />
        <KpiCard
          label={t("Target Pass Rate")}
          value={settings.targetPassRate}
          suffix="%"
          icon={Target}
          tone="orange"
          index={2}
        />
      </div>

      <Section delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4 text-violet-500" />
              {t("Team ranking")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartTeams.length > 0 ? (
              <ChartContainer
                config={localizedScoreConfig}
                accessibilityLabel={t("Team comparison by Average Score")}
                accessibilityDescription={summarizeChartData(
                  chartTeams.map((team) =>
                    t("{name}: score {score}%, {count} evaluations", {
                      name: team.displayName,
                      score: team.avgScore.toFixed(1),
                      count: team.evalCount,
                    }),
                  ),
                  10,
                  locale,
                )}
                className="h-[400px] w-full"
              >
                <BarChart data={chartTeams} layout="vertical" margin={{ left: 20, right: 12 }}>
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
                    dataKey="displayName"
                    tickLine={false}
                    axisLine={false}
                    width={120}
                    className="text-xs"
                  />
                  <ChartTooltip
                    cursor={{ fill: "rgba(139,92,246,0.08)" }}
                    content={
                      <ChartTooltipContent
                        formatter={(v) => [`${Number(v).toFixed(1)}%`, "Score"]}
                      />
                    }
                  />
                  <Bar
                    dataKey="avgScore"
                    radius={[0, 6, 6, 0]}
                    animationDuration={900}
                    isAnimationActive={chartAnimation}
                    className="cursor-pointer"
                    onClick={(data) => {
                      const entry = data as unknown as { payload?: { id?: string } };
                      if (entry?.payload?.id) router.push(`/analytics/teams/${entry.payload.id}`);
                    }}
                  >
                    {chartTeams.map((team, i) => (
                      <Cell key={team.id} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
                {t("No teams with evaluations")}
              </div>
            )}
          </CardContent>
        </Card>
      </Section>

      <Section delay={0.2}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Team details")}</CardTitle>
          </CardHeader>
          <CardContent>
            {teams.length > 0 ? (
              <div className="space-y-2">
                {teams.map((team, i) => (
                  <motion.button
                    key={team.id}
                    type="button"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.3 }}
                    className="grid w-full cursor-pointer grid-cols-2 items-center gap-2 rounded-lg border border-border/60 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40 sm:grid-cols-5"
                    onClick={() => router.push(`/analytics/teams/${team.id}`)}
                  >
                    <span className="font-medium">{team.name}</span>
                    <Badge variant="outline" className="w-fit">
                      {team.campaignName}
                    </Badge>
                    <span className="text-center">
                      {t("{count} agents", { count: team.agentCount })}
                    </span>
                    <div className="flex justify-center">
                      <Badge
                        variant={
                          team.evalCount === 0
                            ? "outline"
                            : team.avgScore >= settings.passThreshold
                              ? "default"
                              : "destructive"
                        }
                      >
                        {team.evalCount > 0 ? `${team.avgScore.toFixed(1)}%` : "—"}
                      </Badge>
                    </div>
                    <span className="text-right text-muted-foreground">
                      {t("{count} evals", { count: team.evalCount })}
                    </span>
                  </motion.button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
                {t("No teams available")}
              </div>
            )}
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
