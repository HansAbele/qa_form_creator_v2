"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, Medal, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
import { useI18n } from "@/components/providers/i18n-provider";
import { AccessibleChart } from "@/components/ui/accessible-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useChartAnimation } from "@/components/ui/use-chart-animation";

interface AgentData {
  id: string;
  name: string;
  agentCode: string | null;
  campaignId: string;
  campaignName: string;
  totalEvaluations: number;
  avgScore: number;
  passRate: number;
  lastScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  trend: number;
}

interface AgentPerformanceClientProps {
  agents: AgentData[];
  campaigns: { id: string; name: string }[];
  passThreshold: number;
}

// Brand-aligned palette: TNO orange + navy + supporting hues
const COLORS = ["#ff6600", "#1a2b45", "#10b981", "#f59e0b", "#8b5cf6"];
const MEDAL_COLORS = ["text-yellow-500", "text-gray-400", "text-amber-700"];

export function AgentPerformanceClient({
  agents,
  campaigns,
  passThreshold,
}: AgentPerformanceClientProps) {
  const { t } = useI18n();
  const chartAnimation = useChartAnimation();
  const [sorting, setSorting] = useState<SortingState>([{ id: "avgScore", desc: true }]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState(
    campaigns.length === 1 ? (campaigns[0]?.id ?? "all") : "all",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"leaderboard" | "comparison">("leaderboard");

  const filtered = useMemo(
    () =>
      campaignFilter === "all" ? agents : agents.filter((a) => a.campaignId === campaignFilter),
    [agents, campaignFilter],
  );

  // Sorted for ranking
  const ranked = useMemo(
    () =>
      filtered
        .filter((agent) => agent.totalEvaluations > 0)
        .sort((a, b) => b.avgScore - a.avgScore),
    [filtered],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  }, []);

  const selectedAgents = useMemo(
    () => agents.filter((a) => selectedIds.has(a.id)),
    [agents, selectedIds],
  );

  const columns = useMemo<ColumnDef<AgentData>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        cell: ({ row }) => {
          if (row.original.totalEvaluations === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          const rank = ranked.findIndex((a) => a.id === row.original.id);
          if (rank < 3) {
            return <Medal className={`h-5 w-5 ${MEDAL_COLORS[rank]}`} />;
          }
          return <span className="text-muted-foreground">{rank + 1}</span>;
        },
        size: 40,
      },
      {
        id: "select",
        header: "",
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedIds.has(row.original.id)}
            onChange={() => toggleSelect(row.original.id)}
            disabled={row.original.totalEvaluations === 0}
            aria-label={t("Compare {name}", { name: row.original.name })}
            title={row.original.totalEvaluations === 0 ? t("No data") : undefined}
            className="h-4 w-4 rounded border-input"
          />
        ),
        size: 30,
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("Agent")}
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <span className="font-medium">{row.original.name}</span>
            {row.original.agentCode && (
              <span className="ml-1 text-xs text-muted-foreground">({row.original.agentCode})</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "campaignName",
        header: t("Campaign"),
        cell: ({ getValue }) => <Badge variant="outline">{getValue<string>()}</Badge>,
      },
      {
        accessorKey: "totalEvaluations",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("Evals")}
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
      },
      {
        accessorKey: "avgScore",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {t("Average Score")}
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue, row }) => {
          if (row.original.totalEvaluations === 0) {
            return <Badge variant="outline">—</Badge>;
          }
          const score = getValue<number>();
          const midFail = Math.floor(passThreshold * 0.7);
          return (
            <div className="flex items-center gap-2">
              <Badge variant={score >= passThreshold ? "default" : "destructive"}>
                {score.toFixed(1)}%
              </Badge>
              <div className="hidden sm:block h-2 w-20 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${score >= passThreshold ? "bg-green-500" : score >= midFail ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${score}%` }}
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
            {t("Pass Rate")}
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue, row }) =>
          row.original.totalEvaluations > 0 ? (
            <span>{getValue<number>()}%</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "minScore",
        header: "Min",
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          return v !== null ? (
            <span className="text-xs">{v.toFixed(0)}%</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: "maxScore",
        header: "Max",
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          return v !== null ? (
            <span className="text-xs">{v.toFixed(0)}%</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: "trend",
        header: t("Trend"),
        cell: ({ getValue, row }) => {
          if (row.original.totalEvaluations < 6) {
            return <span className="text-muted-foreground">—</span>;
          }
          const trend = getValue<number>();
          if (trend === 0) return <Minus className="h-4 w-4 text-muted-foreground" />;
          return trend > 0 ? (
            <span className="flex items-center gap-1 text-green-600">
              <TrendingUp className="h-4 w-4" />+{trend.toFixed(1)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-600">
              <TrendingDown className="h-4 w-4" />
              {trend.toFixed(1)}
            </span>
          );
        },
      },
    ],
    [ranked, selectedIds, passThreshold, t, toggleSelect],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const comparisonScoreData = selectedAgents
    .filter((agent) => agent.totalEvaluations > 0)
    .map((a) => ({ id: a.id, name: a.name, avgScore: a.avgScore }));
  const comparisonVolumeData = selectedAgents
    .filter((agent) => agent.totalEvaluations > 0)
    .map((a) => ({ id: a.id, name: a.name, value: a.totalEvaluations }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("Agent performance")}</h1>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant={mode === "comparison" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode(mode === "comparison" ? "leaderboard" : "comparison")}
            >
              {mode === "comparison"
                ? t("View table")
                : t("Compare ({count})", { count: selectedIds.size })}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedIds(new Set());
                setMode("leaderboard");
              }}
            >
              <X className="h-4 w-4" /> {t("Clear")}
            </Button>
          </div>
        )}
      </div>

      {/* Comparison Mode */}
      {mode === "comparison" && selectedAgents.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Score comparison")}</CardTitle>
            </CardHeader>
            <CardContent>
              {comparisonScoreData.length > 0 ? (
                <AccessibleChart
                  label={t("Score comparison among selected agents")}
                  description={comparisonScoreData
                    .map((item) => `${item.name}: ${item.avgScore.toFixed(1)}%`)
                    .join("; ")}
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={comparisonScoreData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]} />
                      <Bar
                        dataKey="avgScore"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={chartAnimation}
                      >
                        {comparisonScoreData.map((item, i) => (
                          <Cell key={item.id} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </AccessibleChart>
              ) : (
                <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                  {t("No data")}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Evaluation volume")}</CardTitle>
            </CardHeader>
            <CardContent>
              {comparisonVolumeData.length > 0 ? (
                <AccessibleChart
                  label={t("Evaluation volume for selected agents")}
                  description={comparisonVolumeData
                    .map((item) =>
                      t("{name}: {count} evaluations", { name: item.name, count: item.value }),
                    )
                    .join("; ")}
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={comparisonVolumeData}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        dataKey="value"
                        isAnimationActive={chartAnimation}
                        label={(props) => `${props.name}: ${props.value}`}
                      >
                        {comparisonVolumeData.map((item, i) => (
                          <Cell key={item.id} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </AccessibleChart>
              ) : (
                <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                  {t("No data")}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Detail cards for compared agents */}
          <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {selectedAgents.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-4 space-y-2">
                  <p className="font-medium text-sm truncate">{a.name}</p>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <span className="text-muted-foreground">{t("Score:")}</span>
                    <Badge
                      variant={
                        a.totalEvaluations === 0
                          ? "outline"
                          : a.avgScore >= passThreshold
                            ? "default"
                            : "destructive"
                      }
                      className="text-xs"
                    >
                      {a.totalEvaluations > 0 ? `${a.avgScore.toFixed(1)}%` : "—"}
                    </Badge>
                    <span className="text-muted-foreground">{t("Pass Rate:")}</span>
                    <span>{a.totalEvaluations > 0 ? `${a.passRate}%` : "—"}</span>
                    <span className="text-muted-foreground">{t("Evals:")}</span>
                    <span>{a.totalEvaluations}</span>
                    <span className="text-muted-foreground">{t("Min:")}</span>
                    <span>{a.minScore === null ? "—" : `${a.minScore.toFixed(0)}%`}</span>
                    <span className="text-muted-foreground">{t("Max:")}</span>
                    <span>{a.maxScore === null ? "—" : `${a.maxScore.toFixed(0)}%`}</span>
                    <span className="text-muted-foreground">{t("Trend")}:</span>
                    <span
                      className={a.trend > 0 ? "text-green-600" : a.trend < 0 ? "text-red-600" : ""}
                    >
                      {a.totalEvaluations >= 6
                        ? `${a.trend > 0 ? "+" : ""}${a.trend.toFixed(1)}`
                        : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t("Search agent")}
          placeholder={t("Search agent...")}
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-64"
        />
        {campaigns.length === 1 ? (
          <div className="flex min-h-10 w-48 items-center justify-between rounded-md border bg-muted/30 px-3 text-sm">
            <span className="truncate font-medium">{campaigns[0]?.name}</span>
            <Badge variant="secondary">{t("Automatic")}</Badge>
          </div>
        ) : (
          <Select value={campaignFilter} onValueChange={(v) => v && setCampaignFilter(v)}>
            <SelectTrigger aria-label={t("Filter by campaign")} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All campaigns")}</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-sm text-muted-foreground ml-auto">
          {t("{count} agents", { count: filtered.length })}
          {selectedIds.size > 0 &&
            ` — ${t("{count} selected (max 5)", { count: selectedIds.size })}`}
        </p>
      </div>

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
                <TableRow
                  key={row.id}
                  className={selectedIds.has(row.original.id) ? "bg-accent" : ""}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  {t("No agent data")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
