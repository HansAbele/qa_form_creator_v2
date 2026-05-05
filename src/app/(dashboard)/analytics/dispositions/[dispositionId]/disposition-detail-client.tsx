"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { motion } from "motion/react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  createdAt: string;
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
  avgScore: { label: "Score Promedio", color: "#06b6d4" },
} satisfies ChartConfig;

const volumeTrendConfig = {
  count: { label: "Evaluaciones", color: "#8b5cf6" },
} satisfies ChartConfig;

const questionConfig = {
  avgScore: { label: "Score", color: "#06b6d4" },
} satisfies ChartConfig;

function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

function getQuestionBarColor(score: number): string {
  if (score >= 70) return "#10b981";
  if (score >= 50) return "#f59e0b";
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

function EmptyState({ label = "Sin datos" }: { label?: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function DispositionDetailClient({
  dispositionId,
}: {
  dispositionId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<DispositionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getDispositionDetail(
        dispositionId,
        dateFrom || undefined,
        dateTo || undefined,
      );
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dispositionId, dateFrom, dateTo]);

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

  if (loading && !data) return <LoadingSkeleton />;
  if (!data) return <EmptyState label="Disposición no encontrada" />;

  const deltaIcon =
    data.scoreDelta > 0.5 ? ArrowUp : data.scoreDelta < -0.5 ? ArrowDown : Minus;
  const deltaTone: "emerald" | "rose" | "navy" =
    data.scoreDelta > 0.5 ? "emerald" : data.scoreDelta < -0.5 ? "rose" : "navy";
  const deltaLabel =
    data.scoreDelta > 0
      ? `+${data.scoreDelta.toFixed(1)}% vs global`
      : data.scoreDelta < 0
        ? `${data.scoreDelta.toFixed(1)}% vs global`
        : "= global";

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
          Volver
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
                    {data.categoryName && (
                      <Badge variant="secondary">{data.categoryName}</Badge>
                    )}
                    {!data.active && <Badge variant="destructive">Inactiva</Badge>}
                  </div>
                </div>
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
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Evaluaciones"
          value={data.totalEvaluations}
          icon={ClipboardCheck}
          tone="orange"
          index={0}
        />
        <KpiCard
          label="Score Promedio"
          value={data.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={data.avgScore >= 70 ? "emerald" : data.avgScore >= 50 ? "amber" : "rose"}
          index={1}
        />
        <KpiCard
          label={deltaLabel}
          value={data.globalAvgScore}
          decimals={1}
          suffix="%"
          icon={deltaIcon}
          tone={deltaTone}
          index={2}
        />
        <KpiCard
          label="Pass Rate"
          value={data.passRate}
          suffix="%"
          icon={Award}
          tone={data.passRate >= 70 ? "emerald" : data.passRate >= 50 ? "amber" : "rose"}
          index={3}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-cyan-500" />
              Tendencia de Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreTrend.length > 0 ? (
              <ChartContainer config={scoreTrendConfig} className="h-[260px] w-full">
                <LineChart data={data.scoreTrend} margin={{ left: 8, right: 12 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                    tickFormatter={(v) => new Date(v).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
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
                  />
                </LineChart>
              </ChartContainer>
            ) : (
              <EmptyState label="Sin datos en el período" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-violet-500" />
              Tendencia de Volumen
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreTrend.length > 0 ? (
              <ChartContainer config={volumeTrendConfig} className="h-[260px] w-full">
                <BarChart data={data.scoreTrend} margin={{ left: 8, right: 12 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                    tickFormatter={(v) => new Date(v).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                  />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="count"
                    fill="#8b5cf6"
                    radius={[6, 6, 0, 0]}
                    animationDuration={900}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState label="Sin datos en el período" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-cyan-500" />
              Score por Pregunta
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.scoreByQuestion.length > 0 ? (
              <ChartContainer config={questionConfig} className="h-[320px] w-full">
                <BarChart
                  data={data.scoreByQuestion.slice(0, 8)}
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
                    dataKey="question"
                    tickLine={false}
                    axisLine={false}
                    width={150}
                    className="text-xs"
                    tickFormatter={(v: string) =>
                      v.length > 22 ? `${v.slice(0, 20)}…` : v
                    }
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                      />
                    }
                  />
                  <Bar dataKey="avgScore" radius={[0, 6, 6, 0]} animationDuration={900}>
                    {data.scoreByQuestion.slice(0, 8).map((q) => (
                      <Cell key={q.question} fill={getQuestionBarColor(q.avgScore)} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState label="Sin preguntas tipo RATING" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-orange-500" />
              Top Evaluadores
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topEvaluators.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evaluador</TableHead>
                    <TableHead className="text-center">Evals</TableHead>
                    <TableHead className="text-center">Avg</TableHead>
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
                        <Badge variant={scoreBadgeVariant(e.avgScore)} className="tabular-nums">
                          {e.avgScore.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState label="Sin evaluadores" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-violet-500" />
              Top Agentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topAgents.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agente</TableHead>
                    <TableHead className="text-center">Evals</TableHead>
                    <TableHead className="text-center">Avg</TableHead>
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
                        <Badge variant={scoreBadgeVariant(a.avgScore)} className="tabular-nums">
                          {a.avgScore.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState label="Sin agentes" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evaluaciones Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentResponses.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agente</TableHead>
                    <TableHead>Evaluador</TableHead>
                    <TableHead className="text-center">Score</TableHead>
                    <TableHead className="text-right">Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentResponses.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/analytics/responses/${r.id}`)}
                    >
                      <TableCell className="font-medium">{r.agentName}</TableCell>
                      <TableCell className="text-muted-foreground">{r.evaluatorName}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={scoreBadgeVariant(r.score)} className="tabular-nums">
                          {r.score.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString("es-ES")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState label="Sin evaluaciones" />
            )}
          </CardContent>
        </Card>
      </div>

      {data.sisterDispositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-cyan-500" />
              Disposiciones Hermanas
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
                  <TableHead>Disposición</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-center">Evals</TableHead>
                  <TableHead className="text-center">Avg Score</TableHead>
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
                    <TableCell className="text-muted-foreground">
                      {s.code ?? "—"}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {s.totalEvaluations}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={scoreBadgeVariant(s.avgScore)} className="tabular-nums">
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
