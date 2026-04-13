"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "motion/react";
import {
  ArrowUpDown,
  Award,
  BarChart3,
  ClipboardCheck,
  Tag,
  TrendingUp,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDispositionAnalytics } from "@/server/queries/analytics";
import { getCampaigns } from "@/server/actions/campaigns";
import type { AppSettings } from "@/lib/settings";

// ─── Chart configs ────────────────────────────────────────────────────────────

const volumeConfig = {
  totalEvaluations: { label: "Evaluaciones", color: "#ff6600" },
} satisfies ChartConfig;

const scoreConfig = {
  avgScore: { label: "Score Promedio", color: "#06b6d4" },
} satisfies ChartConfig;

const passRateConfig = {
  passRate: { label: "Pass Rate", color: "#10b981" },
} satisfies ChartConfig;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DispositionData {
  id: string;
  name: string;
  code: string;
  categoryName: string | null;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
}

// ─── Animated section wrapper ─────────────────────────────────────────────────

function Section({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
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

// ─── Score color helper ───────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  return "#f43f5e";
}

// ─── Bar colors ───────────────────────────────────────────────────────────────

const BAR_COLORS = [
  "#ff6600",
  "#1a2b45",
  "#8b5cf6",
  "#06b6d4",
  "#f59e0b",
  "#10b981",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function DispositionsAnalyticsClient({
  settings,
}: {
  settings: AppSettings;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [campaignId, setCampaignId] = useState("all");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [data, setData] = useState<DispositionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "totalEvaluations", desc: true },
  ]);

  // ─── Load campaigns once ────────────────────────────────────────────────────

  useEffect(() => {
    getCampaigns().then((cs) =>
      setCampaigns(cs.map((c) => ({ id: c.id, name: c.name }))),
    );
  }, []);

  // ─── Load disposition data ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getDispositionAnalytics(
        campaignId === "all" ? undefined : campaignId,
        dateFrom || undefined,
        dateTo || undefined,
      );
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [campaignId, dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Quick range helper ─────────────────────────────────────────────────────

  const setQuickRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  };

  // ─── KPI computations ──────────────────────────────────────────────────────

  const totalDispositions = data.length;
  const totalEvaluations = data.reduce(
    (sum, d) => sum + d.totalEvaluations,
    0,
  );
  const mostUsed = data.length > 0 ? data[0] : null; // already sorted desc by totalEvaluations
  const globalAvgScore =
    totalEvaluations > 0
      ? data.reduce((sum, d) => sum + d.avgScore * d.totalEvaluations, 0) /
        totalEvaluations
      : 0;
  const globalPassRate =
    totalEvaluations > 0
      ? data.reduce((sum, d) => sum + d.passRate * d.totalEvaluations, 0) /
        totalEvaluations
      : 0;

  // ─── Chart data ─────────────────────────────────────────────────────────────

  const volumeChartData = useMemo(
    () =>
      [...data]
        .sort((a, b) => b.totalEvaluations - a.totalEvaluations)
        .slice(0, 15),
    [data],
  );

  const scoreChartData = useMemo(
    () => [...data].sort((a, b) => b.avgScore - a.avgScore),
    [data],
  );

  const passRateChartData = useMemo(
    () => [...data].sort((a, b) => b.passRate - a.passRate),
    [data],
  );

  // ─── Table columns ─────────────────────────────────────────────────────────

  const columns = useMemo<ColumnDef<DispositionData>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Nombre
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <span className="font-medium">{row.original.name}</span>
            {row.original.code && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({row.original.code})
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "categoryName",
        header: "Categoria",
        cell: ({ getValue }) => {
          const v = getValue<string | null>();
          return v ? (
            <Badge variant="outline">{v}</Badge>
          ) : (
            <span className="text-muted-foreground">--</span>
          );
        },
      },
      {
        accessorKey: "totalEvaluations",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Evaluaciones
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue<number>()}</span>
        ),
      },
      {
        accessorKey: "avgScore",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Avg Score
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue }) => {
          const score = getValue<number>();
          return (
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  score >= settings.passThreshold ? "default" : "destructive"
                }
              >
                {score.toFixed(1)}%
              </Badge>
              <div className="hidden sm:block h-2 w-20 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${score}%`,
                    backgroundColor: scoreColor(score),
                  }}
                />
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "passRate",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Pass Rate
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue }) => {
          const rate = getValue<number>();
          return (
            <span
              className={
                rate >= settings.targetPassRate
                  ? "text-emerald-600 font-medium"
                  : rate >= settings.passThreshold
                    ? "text-amber-600"
                    : "text-rose-600"
              }
            >
              {rate}%
            </span>
          );
        },
      },
    ],
    [settings.passThreshold, settings.targetPassRate],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (loading && data.length === 0) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          className="h-8 w-8 rounded-full border-2 border-orange-500/30 border-t-orange-500"
        />
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ─── Header + Filters ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-cyan-500" />
            <h1 className="font-heading text-3xl font-bold tracking-tight">
              Disposiciones
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Analisis de rendimiento por disposicion
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={campaignId}
            onValueChange={(v) => v && setCampaignId(v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las campanas</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      </motion.div>

      {/* ─── KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Disposiciones"
          value={totalDispositions}
          icon={Tag}
          tone="navy"
          index={0}
        />
        <KpiCard
          label="Mas Utilizada"
          value={mostUsed?.totalEvaluations ?? 0}
          suffix={mostUsed ? ` - ${mostUsed.name}` : ""}
          icon={ClipboardCheck}
          tone="orange"
          index={1}
        />
        <KpiCard
          label="Score Promedio"
          value={globalAvgScore}
          decimals={1}
          suffix="%"
          icon={TrendingUp}
          tone={
            globalAvgScore >= settings.passThreshold ? "emerald" : "amber"
          }
          index={2}
        />
        <KpiCard
          label={`Pass Rate (>=${settings.passThreshold}%)`}
          value={globalPassRate}
          decimals={1}
          suffix="%"
          icon={Award}
          tone={
            globalPassRate >= settings.targetPassRate
              ? "emerald"
              : globalPassRate >= settings.passThreshold
                ? "amber"
                : "rose"
          }
          index={3}
        />
      </div>

      {/* ─── Volume by Disposition ─────────────────────────────────────── */}
      <Section delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-orange-500" />
              Volumen por Disposicion
            </CardTitle>
          </CardHeader>
          <CardContent>
            {volumeChartData.length > 0 ? (
              <ChartContainer
                config={volumeConfig}
                className="h-[300px] w-full"
              >
                <BarChart data={volumeChartData}>
                  <CartesianGrid
                    vertical={false}
                    strokeDasharray="3 3"
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="name"
                    angle={-25}
                    textAnchor="end"
                    height={70}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent />}
                  />
                  <Bar
                    dataKey="totalEvaluations"
                    radius={[6, 6, 0, 0]}
                    animationDuration={900}
                  >
                    {volumeChartData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={BAR_COLORS[i % BAR_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState label="Sin disposiciones registradas" />
            )}
          </CardContent>
        </Card>
      </Section>

      {/* ─── Score + Pass Rate by Disposition ──────────────────────────── */}
      <Section delay={0.15}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Score by Disposition */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-cyan-500" />
                Score por Disposicion
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scoreChartData.length > 0 ? (
                <ChartContainer
                  config={scoreConfig}
                  className="h-[350px] w-full"
                >
                  <BarChart
                    data={scoreChartData}
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
                      cursor={{ fill: "rgba(6,182,212,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [
                            `${Number(value).toFixed(1)}%`,
                            "Score",
                          ]}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgScore"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                    >
                      {scoreChartData.map((d) => (
                        <Cell key={d.id} fill={scoreColor(d.avgScore)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>

          {/* Pass Rate by Disposition */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4 text-emerald-500" />
                Pass Rate por Disposicion
              </CardTitle>
            </CardHeader>
            <CardContent>
              {passRateChartData.length > 0 ? (
                <ChartContainer
                  config={passRateConfig}
                  className="h-[350px] w-full"
                >
                  <BarChart
                    data={passRateChartData}
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
                    <ReferenceLine
                      x={settings.passThreshold}
                      stroke="#f43f5e"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{
                        value: `${settings.passThreshold}%`,
                        position: "top",
                        fill: "#f43f5e",
                        fontSize: 11,
                      }}
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(16,185,129,0.08)" }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [
                            `${Number(value).toFixed(0)}%`,
                            "Pass Rate",
                          ]}
                        />
                      }
                    />
                    <Bar
                      dataKey="passRate"
                      radius={[0, 6, 6, 0]}
                      animationDuration={900}
                    >
                      {passRateChartData.map((d) => (
                        <Cell
                          key={d.id}
                          fill={
                            d.passRate >= settings.passThreshold
                              ? "#10b981"
                              : "#f43f5e"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyState />
              )}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* ─── Disposition Table ─────────────────────────────────────────── */}
      <Section delay={0.2}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4 text-orange-500" />
              Detalle por Disposicion
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead key={header.id}>
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext(),
                                )}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.length > 0 ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length}
                          className="text-center text-muted-foreground"
                        >
                          No hay datos de disposiciones
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState label="Sin disposiciones registradas" />
            )}
          </CardContent>
        </Card>
      </Section>

      {/* ─── Summary count ─────────────────────────────────────────────── */}
      <p className="text-sm text-muted-foreground text-right">
        {data.length} disposicion{data.length !== 1 ? "es" : ""} con
        evaluaciones
        {campaignId !== "all" && " en la campana seleccionada"}
      </p>
    </div>
  );
}
