"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "motion/react";
import { ArrowLeft, Award, Target, TrendingUp, UsersRound } from "lucide-react";
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
import { getTeamPerformance } from "@/server/queries/analytics";
import type { AppSettings } from "@/lib/settings";

const scoreConfig = {
  avgScore: { label: "Score Promedio", color: "#8b5cf6" },
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
  const router = useRouter();
  const [teams, setTeams] = useState<TeamPerf[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTeamPerformance();
      setTeams(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
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

  const avgAll = teams.length > 0
    ? teams.reduce((s, t) => s + t.avgScore, 0) / teams.length
    : 0;

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
            Performance por Equipo
          </h1>
        </div>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Equipos" value={teams.length} icon={UsersRound} tone="violet" index={0} />
        <KpiCard
          label="Score Promedio Global"
          value={avgAll}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={avgAll >= settings.passThreshold ? "emerald" : "amber"}
          index={1}
        />
        <KpiCard
          label="Target Pass Rate"
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
              Ranking de Equipos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {teams.length > 0 ? (
              <ChartContainer config={scoreConfig} className="h-[400px] w-full">
                <BarChart data={teams} layout="vertical" margin={{ left: 20, right: 12 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} className="text-xs" />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={120} className="text-xs" />
                  <ChartTooltip
                    cursor={{ fill: "rgba(139,92,246,0.08)" }}
                    content={<ChartTooltipContent formatter={(v) => [`${Number(v).toFixed(1)}%`, "Score"]} />}
                  />
                  <Bar
                    dataKey="avgScore"
                    radius={[0, 6, 6, 0]}
                    animationDuration={900}
                    className="cursor-pointer"
                    onClick={(data) => {
                      if (data?.id) router.push(`/analytics/teams/${data.id}`);
                    }}
                  >
                    {teams.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
                No hay equipos con evaluaciones
              </div>
            )}
          </CardContent>
        </Card>
      </Section>

      <Section delay={0.2}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detalle por Equipo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {teams.map((t, i) => (
                <motion.button
                  key={t.id}
                  type="button"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.3 }}
                  className="grid w-full cursor-pointer grid-cols-5 items-center rounded-lg border border-border/60 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40"
                  onClick={() => router.push(`/analytics/teams/${t.id}`)}
                >
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="outline">{t.campaignName}</Badge>
                  <span className="text-center">{t.agentCount} agentes</span>
                  <div className="flex justify-center">
                    <Badge variant={t.avgScore >= settings.passThreshold ? "default" : "destructive"}>
                      {t.avgScore.toFixed(1)}%
                    </Badge>
                  </div>
                  <span className="text-right text-muted-foreground">{t.totalEvaluations} evals</span>
                </motion.button>
              ))}
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
