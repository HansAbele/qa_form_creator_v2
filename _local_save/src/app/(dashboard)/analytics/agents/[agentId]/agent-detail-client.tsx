"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Award,
  BarChart3,
  ClipboardCheck,
  Hash,
  TrendingUp,
  User,
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
import { KpiCard } from "@/components/ui/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentDetailData {
  id: string;
  name: string;
  agentCode: string | null;
  campaignName: string;
  campaignId: string;
  teamName: string | null;
  teamId: string | null;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
  minScore: number | null;
  maxScore: number | null;
  passThreshold: number;
  scoreTrend: { date: string; avgScore: number; count: number }[];
  scoreByQuestion: { question: string; avgScore: number }[];
  dispositionBreakdown: { name: string; count: number; avgScore: number }[];
  evaluators: { id: string; name: string; count: number; avgScore: number }[];
  recentResponses: {
    id: string;
    formTitle: string;
    evaluatorName: string;
    dispositionName: string | null;
    score: number;
    createdAt: string;
  }[];
}

// ─── Chart configs ───────────────────────────────────────────────────────────

const trendConfig = {
  avgScore: { label: "Score Promedio", color: "#1a2b45" },
} satisfies ChartConfig;

const questionConfig = {
  avgScore: { label: "Score Promedio", color: "#ff6600" },
} satisfies ChartConfig;

const dispositionConfig = {
  count: { label: "Evaluaciones", color: "#06b6d4" },
} satisfies ChartConfig;

const evaluatorConfig = {
  count: { label: "Evaluaciones", color: "#8b5cf6" },
} satisfies ChartConfig;

// ─── Colors ──────────────────────────────────────────────────────────────────

const PIE_COLORS = ["#ff6600", "#1a2b45", "#10b981", "#8b5cf6", "#06b6d4", "#f59e0b", "#f43f5e", "#14b8a6"];

function getQuestionBarColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  return "#f43f5e";
}

// ─── Section animation wrapper ───────────────────────────────────────────────

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

function EmptyState({ label = "Sin datos" }: { label?: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AgentDetailClient({ data }: { data: AgentDetailData }) {
  const router = useRouter();

  const scoreTrendSpark = data.scoreTrend.map((t) => ({ value: t.avgScore }));

  return (
    <div className="space-y-6">
      {/* ─── Back button + Header ──────────────────────────────────────── */}
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
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 ring-1 ring-orange-500/20">
                  <User className="h-7 w-7 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {data.agentCode && (
                      <Badge variant="outline" className="gap-1">
                        <Hash className="h-3 w-3" />
                        {data.agentCode}
                      </Badge>
                    )}
                    <Badge variant="secondary">{data.campaignName}</Badge>
                    {data.teamName && (
                      <Badge variant="secondary" className="gap-1">
                        <Users className="h-3 w-3" />
                        {data.teamName}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Min / Max inline */}
              <div className="flex items-center gap-3 text-sm">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Min</p>
                  <p className="font-semibold tabular-nums">
                    {data.minScore !== null ? `${data.minScore.toFixed(0)}%` : "--"}
                  </p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Max</p>
                  <p className="font-semibold tabular-nums">
                    {data.maxScore !== null ? `${data.maxScore.toFixed(0)}%` : "--"}
                  </p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Umbral</p>
                  <p className="font-semibold tabular-nums">{data.passThreshold}%</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Score Promedio"
          value={data.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={data.avgScore >= data.passThreshold ? "emerald" : "amber"}
          trend={scoreTrendSpark}
          index={0}
        />
        <KpiCard
          label={`Pass Rate (>=${data.passThreshold}%)`}
          value={data.passRate}
          suffix="%"
          icon={Award}
          tone={data.passRate >= 80 ? "emerald" : data.passRate >= 60 ? "amber" : "rose"}
          index={1}
        />
        <KpiCard
          label="Evaluaciones"
          value={data.totalEvaluations}
          icon={ClipboardCheck}
          tone="orange"
          index={2}
        />
        <KpiCard
          label="Rango de Score"
          value={data.maxScore !== null && data.minScore !== null ? data.maxScore - data.minScore : 0}
          decimals={1}
          suffix=" pts"
          icon={BarChart3}
          tone="navy"
          index={3}
        />
      </div>

      {/* ─── Score Trend + Score by Question ────────────────────────────── */}
      <Section delay={0.1}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Score Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                Tendencia de Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.scoreTrend.length > 1 ? (
                <ChartContainer config={trendConfig} className="h-[280px] w-full">
                  <LineChart data={data.scoreTrend}>
                    <defs>
                      <linearGradient id="scoreTrendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1a2b45" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#1a2b45" stopOpacity={0} />
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
                <EmptyState label="Se necesitan al menos 2 puntos de datos" />
              )}
            </CardContent>
          </Card>

          {/* Score by Question */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-4 w-4 text-orange-500" />
                Score por Pregunta
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.scoreByQuestion.length > 0 ? (
                <ChartContainer config={questionConfig} className="h-[280px] w-full">
                  <BarChart
                    data={data.scoreByQuestion}
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
                      width={120}
                      className="text-xs"
                      tickFormatter={(v) => (String(v).length > 18 ? `${String(v).slice(0, 18)}...` : String(v))}
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(255,102,0,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                        />
                      }
                    />
                    <Bar dataKey="avgScore" radius={[0, 6, 6, 0]} animationDuration={900}>
                      {data.scoreByQuestion.map((item, i) => (
                        <Cell key={i} fill={getQuestionBarColor(item.avgScore)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin datos de preguntas" />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Disposition Breakdown + Evaluators ────────────────────────── */}
      <Section delay={0.2}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Disposition Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-cyan-500" />
                Disposiciones
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.dispositionBreakdown.length > 0 ? (
                <div className="flex flex-col items-center">
                  <ChartContainer
                    config={dispositionConfig}
                    className="mx-auto h-[250px] w-full max-w-[300px]"
                  >
                    <PieChart>
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            formatter={(value, name) => [
                              `${value} evaluaciones`,
                              String(name),
                            ]}
                          />
                        }
                      />
                      <Pie
                        data={data.dispositionBreakdown}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        strokeWidth={3}
                        paddingAngle={2}
                        animationDuration={900}
                      >
                        {data.dispositionBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  {/* Legend */}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs">
                    {data.dispositionBreakdown.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="text-muted-foreground">{d.name}</span>
                        <span className="font-medium tabular-nums">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState label="Sin disposiciones registradas" />
              )}
            </CardContent>
          </Card>

          {/* Evaluators */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-violet-500" />
                Evaluadores
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.evaluators.length > 0 ? (
                <ChartContainer config={evaluatorConfig} className="h-[280px] w-full">
                  <BarChart
                    data={data.evaluators}
                    layout="vertical"
                    margin={{ left: 20, right: 12 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      className="text-xs"
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={90}
                      className="text-xs"
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(139,92,246,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value, name, item) => {
                            const payload = item?.payload as
                              | { avgScore?: number }
                              | undefined;
                            const avg = payload?.avgScore;
                            return [
                              `${value} evals${avg !== undefined ? ` | Avg: ${avg.toFixed(1)}%` : ""}`,
                              String(name),
                            ];
                          }}
                        />
                      }
                    />
                    <Bar
                      dataKey="count"
                      fill="#8b5cf6"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin datos de evaluadores" />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Recent Evaluations Table ──────────────────────────────────── */}
      <Section delay={0.3}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evaluaciones Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentResponses.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Formulario</TableHead>
                      <TableHead>Evaluador</TableHead>
                      <TableHead>Disposicion</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead className="text-right">Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentResponses.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-[200px] truncate font-medium">
                          {r.formTitle}
                        </TableCell>
                        <TableCell>{r.evaluatorName}</TableCell>
                        <TableCell>
                          {r.dispositionName ? (
                            <Badge variant="outline">{r.dispositionName}</Badge>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={r.score >= data.passThreshold ? "default" : "destructive"}
                            className="tabular-nums"
                          >
                            {r.score.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {new Date(r.createdAt).toLocaleDateString("es-ES", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState label="Sin evaluaciones registradas" />
            )}
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
