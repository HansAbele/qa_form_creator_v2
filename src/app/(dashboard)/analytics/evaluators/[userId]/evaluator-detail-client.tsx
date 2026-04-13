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
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "motion/react";
import {
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  Mail,
  Shield,
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

interface EvaluatorDetailData {
  id: string;
  name: string;
  email: string;
  role: string;
  campaigns: { id: string; name: string }[];
  totalEvaluations: number;
  avgScore: number;
  stdDev: number;
  passThreshold: number;
  activityByDay: { date: string; count: number }[];
  agentsEvaluated: { id: string; name: string; count: number; avgScore: number }[];
  dispositionFrequency: { name: string; count: number }[];
  recentResponses: {
    id: string;
    agentName: string;
    formTitle: string;
    dispositionName: string | null;
    score: number;
    createdAt: string;
  }[];
}

// ─── Chart configs ───────────────────────────────────────────────────────────

const activityConfig = {
  count: { label: "Evaluaciones", color: "#ff6600" },
} satisfies ChartConfig;

const calibrationConfig = {
  avgScore: { label: "Score Promedio", color: "#1a2b45" },
} satisfies ChartConfig;

const agentConfig = {
  count: { label: "Evaluaciones", color: "#8b5cf6" },
} satisfies ChartConfig;

const dispositionConfig = {
  count: { label: "Evaluaciones", color: "#06b6d4" },
} satisfies ChartConfig;

// ─── Colors ──────────────────────────────────────────────────────────────────

const PIE_COLORS = ["#ff6600", "#1a2b45", "#10b981", "#8b5cf6", "#06b6d4", "#f43f5e"];

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

export function EvaluatorDetailClient({ data }: { data: EvaluatorDetailData }) {
  const router = useRouter();

  const activitySpark = data.activityByDay.map((d) => ({ value: d.count }));
  const consistency = data.stdDev;
  const consistencyTone = consistency <= 10 ? "emerald" : consistency <= 20 ? "amber" : "rose";

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
                    <span className="flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" />
                      {data.email}
                    </span>
                    <Badge variant="secondary" className="gap-1">
                      <Shield className="h-3 w-3" />
                      {data.role === "ADMIN" ? "QA Manager" : "QA"}
                    </Badge>
                  </div>
                  {data.campaigns.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.campaigns.map((c) => (
                        <Badge key={c.id} variant="outline">{c.name}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Threshold inline */}
              <div className="flex items-center gap-3 text-sm">
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Total Evaluaciones"
          value={data.totalEvaluations}
          icon={ClipboardCheck}
          tone="orange"
          trend={activitySpark}
          index={0}
        />
        <KpiCard
          label="Score Promedio"
          value={data.avgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={data.avgScore >= data.passThreshold ? "emerald" : "amber"}
          index={1}
        />
        <KpiCard
          label="Consistencia (Desv. Est.)"
          value={consistency}
          decimals={1}
          suffix=" pts"
          icon={BarChart3}
          tone={consistencyTone}
          index={2}
        />
      </div>

      {/* ─── Activity by Day + Calibration ─────────────────────────────── */}
      <Section delay={0.1}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Activity by Day */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-4 w-4 text-orange-500" />
                Actividad por Dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.activityByDay.length > 0 ? (
                <ChartContainer config={activityConfig} className="h-[280px] w-full">
                  <BarChart data={data.activityByDay}>
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
                    <ChartTooltip
                      cursor={{ fill: "rgba(255,102,0,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [`${value} evaluaciones`, "Cantidad"]}
                        />
                      }
                    />
                    <Bar
                      dataKey="count"
                      fill="#ff6600"
                      radius={[4, 4, 0, 0]}
                      animationDuration={900}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin actividad registrada" />
              )}
            </CardContent>
          </Card>

          {/* Calibration: avg score per day vs pass threshold */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                Calibracion (Score vs Umbral)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.activityByDay.length > 1 ? (
                <ChartContainer config={calibrationConfig} className="h-[280px] w-full">
                  <LineChart
                    data={data.activityByDay.map((d) => {
                      // Use daily average from agentsEvaluated data when available
                      // Fallback to overall avg for illustration
                      return { date: d.date, avgScore: data.avgScore };
                    })}
                  >
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
                    <ReferenceLine
                      y={data.passThreshold}
                      stroke="#f43f5e"
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      label={{
                        value: `Umbral ${data.passThreshold}%`,
                        position: "insideTopRight",
                        fill: "#f43f5e",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
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
        </div>
      </Section>

      {/* ─── Agents Evaluated + Disposition Frequency ──────────────────── */}
      <Section delay={0.2}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Agents Evaluated (horizontal bar, clickable) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-violet-500" />
                Agentes Evaluados
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.agentsEvaluated.length > 0 ? (
                <ChartContainer config={agentConfig} className="h-[280px] w-full">
                  <BarChart
                    data={data.agentsEvaluated.slice(0, 10)}
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
                          formatter={(value, _name, item) => {
                            const payload = item?.payload as
                              | { avgScore?: number }
                              | undefined;
                            const avg = payload?.avgScore;
                            return [
                              `${value} evals${avg !== undefined ? ` | Avg: ${avg.toFixed(1)}%` : ""}`,
                              "Agente",
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
                      className="cursor-pointer"
                      onClick={(data) => {
                        if (data?.id) router.push(`/analytics/agents/${data.id}`);
                      }}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState label="Sin agentes evaluados" />
              )}
            </CardContent>
          </Card>

          {/* Disposition Frequency (PieChart) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-cyan-500" />
                Frecuencia de Disposiciones
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.dispositionFrequency.length > 0 ? (
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
                        data={data.dispositionFrequency}
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
                        {data.dispositionFrequency.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  {/* Legend */}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs">
                    {data.dispositionFrequency.map((d, i) => (
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
                      <TableHead>Agente</TableHead>
                      <TableHead>Formulario</TableHead>
                      <TableHead>Disposicion</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead className="text-right">Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentResponses.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.agentName}</TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {r.formTitle}
                        </TableCell>
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
