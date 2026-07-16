"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, Award, BarChart3, ClipboardCheck, Tag } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  DataLoadError,
  type DataLoadStatus,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
import {
  addOperationalCalendarDays,
  formatOperationalDate,
  useOperationalTimeZone,
} from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/ui/kpi-card";
import { Label } from "@/components/ui/label";
import { useChartAnimation } from "@/components/ui/use-chart-animation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getKpiCampaigns } from "@/server/actions/campaigns";
import { getDispositionAnalytics } from "@/server/queries/analytics";
import { summarizeChartData } from "@/lib/chart-accessibility";

// ─── Chart configs ────────────────────────────────────────────────────────────

const volumeConfig = {
  totalEvaluations: { label: "Evaluaciones", color: "#ff6600" },
} satisfies ChartConfig;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DispositionData {
  id: string;
  name: string;
  code: string | null;
  categoryName: string | null;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

function scoreColor(score: number): string {
  if (score >= 70) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#f43f5e";
}

const BAR_COLORS = ["#ff6600", "#1a2b45", "#8b5cf6", "#06b6d4", "#f59e0b", "#10b981"];

// ─── Animated section wrapper ─────────────────────────────────────────────────

function EmptyState({ label = "Sin datos" }: { label?: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-[340px] rounded-xl" />
      <Skeleton className="h-[400px] rounded-xl" />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DispositionsAnalyticsClient() {
  const chartAnimation = useChartAnimation();
  const operationalTimeZone = useOperationalTimeZone();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [campaignId, setCampaignId] = useState("all");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<DispositionData[]>([]);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const [campaignLoadStatus, setCampaignLoadStatus] = useState<DataLoadStatus>("loading");
  const [sorting, setSorting] = useState<SortingState>([{ id: "totalEvaluations", desc: true }]);
  const campaignRequestGeneration = useRef(0);
  const dataRequestGeneration = useRef(0);

  // ─── Load campaigns once ────────────────────────────────────────────────────

  const loadCampaigns = useCallback(async () => {
    const requestId = ++campaignRequestGeneration.current;
    setCampaignLoadStatus("loading");
    try {
      const result = await getKpiCampaigns();
      if (requestId !== campaignRequestGeneration.current) return;
      setCampaigns(result.map((campaign) => ({ id: campaign.id, name: campaign.name })));
      setCampaignLoadStatus(result.length === 0 ? "empty" : "success");
    } catch (error) {
      if (requestId !== campaignRequestGeneration.current) return;
      reportDataLoadError(error, "disposition-campaign-filter");
      setCampaignLoadStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
    return () => {
      campaignRequestGeneration.current += 1;
    };
  }, [loadCampaigns]);

  // ─── Load disposition data ──────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const requestId = ++dataRequestGeneration.current;
    setLoadStatus("loading");
    try {
      const result = await getDispositionAnalytics(
        campaignId === "all" ? undefined : campaignId,
        dateFrom || undefined,
        dateTo || undefined,
      );
      if (requestId !== dataRequestGeneration.current) return;
      setData(result);
      setLoadStatus(result.length === 0 ? "empty" : "success");
    } catch (e) {
      if (requestId !== dataRequestGeneration.current) return;
      reportDataLoadError(e, "dispositions-analytics");
      setLoadStatus("error");
    }
  }, [campaignId, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
    return () => {
      dataRequestGeneration.current += 1;
    };
  }, [loadData]);

  // ─── Quick range helper ─────────────────────────────────────────────────────

  const setQuickRange = (days: number) => {
    const to = formatOperationalDate(new Date(), operationalTimeZone);
    setDateFrom(addOperationalCalendarDays(to, -(days - 1)));
    setDateTo(to);
  };

  // ─── KPI computations ──────────────────────────────────────────────────────

  const totalDispositions = data.length;
  const mostUsed = data.length > 0 ? data[0] : null; // already sorted desc by totalEvaluations
  const bestScore =
    data.length > 0 ? data.reduce((best, d) => (d.avgScore > best.avgScore ? d : best)) : null;

  // ─── Chart data (top 15 by volume) ──────────────────────────────────────────

  const volumeChartData = useMemo(
    () => [...data].sort((a, b) => b.totalEvaluations - a.totalEvaluations).slice(0, 15),
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
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Nombre
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "code",
        header: "Codigo",
        cell: ({ getValue }) => {
          const v = getValue<string | null>();
          return v ? (
            <span className="text-xs text-muted-foreground">{v}</span>
          ) : (
            <span className="text-muted-foreground">--</span>
          );
        },
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
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Evaluaciones
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue }) => <span className="tabular-nums">{getValue<number>()}</span>,
      },
      {
        accessorKey: "avgScore",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Avg Score
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue }) => {
          const score = getValue<number>();
          return (
            <div className="flex items-center gap-2">
              <Badge variant={scoreBadgeVariant(score)}>{score.toFixed(1)}%</Badge>
              <div className="hidden h-2 w-20 overflow-hidden rounded-full bg-muted sm:block">
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
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
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
                rate >= 80
                  ? "font-medium text-emerald-600"
                  : rate >= 50
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
    [],
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

  if (loadStatus === "loading" && data.length === 0) return <LoadingSkeleton />;
  if (loadStatus === "error") {
    return (
      <DataLoadError onRetry={() => void loadData()} title="No pudimos cargar las disposiciones" />
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {campaignLoadStatus === "error" ? (
        <DataLoadError
          compact
          onRetry={() => void loadCampaigns()}
          title="No pudimos cargar el filtro de campañas"
        />
      ) : null}
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
            <h1 className="font-heading text-3xl font-bold tracking-tight">Disposiciones</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Analisis de rendimiento por disposicion
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={campaignId} onValueChange={(v) => v && setCampaignId(v)}>
            <SelectTrigger aria-label="Campaña" className="w-48">
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
              <Button key={d} variant="outline" size="sm" onClick={() => setQuickRange(d)}>
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
              <Label htmlFor="dispositions-date-from" className="text-xs">
                Desde
              </Label>
              <Input
                id="dispositions-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-36"
              />
            </div>
            <div>
              <Label htmlFor="dispositions-date-to" className="text-xs">
                Hasta
              </Label>
              <Input
                id="dispositions-date-to"
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Total Disposiciones"
          value={totalDispositions}
          icon={Tag}
          tone="navy"
          index={0}
        />
        <KpiCard
          label="Mas Usada"
          value={mostUsed?.totalEvaluations ?? 0}
          suffix={mostUsed ? ` - ${mostUsed.name}` : ""}
          icon={ClipboardCheck}
          tone="orange"
          index={1}
        />
        <KpiCard
          label="Mejor Score"
          value={bestScore?.avgScore ?? 0}
          decimals={1}
          suffix={bestScore ? `% - ${bestScore.name}` : "%"}
          icon={Award}
          tone="emerald"
          index={2}
        />
      </div>

      {/* ─── Volume by Disposition (Top 15 BarChart) ───────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-orange-500" />
              Top 15 Disposiciones por Volumen
            </CardTitle>
          </CardHeader>
          <CardContent>
            {volumeChartData.length > 0 ? (
              <ChartContainer
                config={volumeConfig}
                accessibilityLabel="Volumen de evaluaciones por disposición"
                accessibilityDescription={summarizeChartData(
                  volumeChartData.map(
                    (disposition) =>
                      `${disposition.name}: ${disposition.totalEvaluations} evaluaciones`,
                  ),
                )}
                className="h-[300px] w-full"
              >
                <BarChart data={volumeChartData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="name"
                    angle={-25}
                    textAnchor="end"
                    height={70}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                    tickFormatter={(v) =>
                      String(v).length > 12 ? `${String(v).slice(0, 12)}...` : String(v)
                    }
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    className="text-xs"
                  />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="totalEvaluations"
                    radius={[6, 6, 0, 0]}
                    animationDuration={900}
                    isAnimationActive={chartAnimation}
                  >
                    {volumeChartData.map((item, i) => (
                      <Cell key={item.id} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState label="Sin disposiciones registradas" />
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ─── Disposition Table (sortable, all dispositions) ────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2 * 0.08 }}
      >
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
                              : flexRender(header.column.columnDef.header, header.getContext())}
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
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
      </motion.div>

      {/* ─── Summary count ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 3 * 0.08 }}
      >
        <p className="text-right text-sm text-muted-foreground">
          {data.length} disposicion{data.length !== 1 ? "es" : ""} con evaluaciones
          {campaignId !== "all" && " en la campana seleccionada"}
        </p>
      </motion.div>
    </div>
  );
}
