"use client";

import { useCallback, useState, useMemo } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { ArrowUpDown, TrendingUp, TrendingDown, Minus, Medal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface AgentData {
  id: string; name: string; agentCode: string | null; campaignName: string;
  totalEvaluations: number; avgScore: number; passRate: number;
  lastScore: number | null; minScore: number | null; maxScore: number | null;
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
  const [sorting, setSorting] = useState<SortingState>([{ id: "avgScore", desc: true }]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"leaderboard" | "comparison">("leaderboard");

  const filtered = useMemo(
    () => campaignFilter === "all" ? agents : agents.filter((a) => a.campaignName === campaignFilter),
    [agents, campaignFilter],
  );

  // Sorted for ranking
  const ranked = useMemo(
    () => [...filtered].sort((a, b) => b.avgScore - a.avgScore),
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
            className="h-4 w-4 rounded border-input"
          />
        ),
        size: 30,
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button variant="ghost" size="xs" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Agente<ArrowUpDown className="ml-1 h-3 w-3" />
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
        header: "Campaña",
        cell: ({ getValue }) => <Badge variant="outline">{getValue<string>()}</Badge>,
      },
      {
        accessorKey: "totalEvaluations",
        header: ({ column }) => (
          <Button variant="ghost" size="xs" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Evals<ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
      },
      {
        accessorKey: "avgScore",
        header: ({ column }) => (
          <Button variant="ghost" size="xs" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Avg Score<ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue }) => {
          const score = getValue<number>();
          const midFail = Math.floor(passThreshold * 0.7);
          return (
            <div className="flex items-center gap-2">
              <Badge variant={score >= passThreshold ? "default" : "destructive"}>{score.toFixed(1)}%</Badge>
              <div className="hidden sm:block h-2 w-20 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full ${score >= passThreshold ? "bg-green-500" : score >= midFail ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${score}%` }} />
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "passRate",
        header: ({ column }) => (
          <Button variant="ghost" size="xs" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
            Pass Rate<ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue }) => <span>{getValue<number>()}%</span>,
      },
      {
        accessorKey: "minScore",
        header: "Min",
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          return v !== null ? <span className="text-xs">{v.toFixed(0)}%</span> : <span className="text-muted-foreground">—</span>;
        },
      },
      {
        accessorKey: "maxScore",
        header: "Max",
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          return v !== null ? <span className="text-xs">{v.toFixed(0)}%</span> : <span className="text-muted-foreground">—</span>;
        },
      },
      {
        accessorKey: "trend",
        header: "Trend",
        cell: ({ getValue }) => {
          const trend = getValue<number>();
          if (trend === 0) return <Minus className="h-4 w-4 text-muted-foreground" />;
          return trend > 0 ? (
            <span className="flex items-center gap-1 text-green-600">
              <TrendingUp className="h-4 w-4" />+{trend.toFixed(1)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-600">
              <TrendingDown className="h-4 w-4" />{trend.toFixed(1)}
            </span>
          );
        },
      },
    ],
    [ranked, selectedIds, passThreshold, toggleSelect],
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

  const comparisonScoreData = selectedAgents.map((a) => ({ name: a.name, avgScore: a.avgScore }));
  const comparisonVolumeData = selectedAgents.map((a) => ({ name: a.name, value: a.totalEvaluations }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Rendimiento de Agentes</h1>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant={mode === "comparison" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode(mode === "comparison" ? "leaderboard" : "comparison")}
            >
              {mode === "comparison" ? "Ver Tabla" : `Comparar (${selectedIds.size})`}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setMode("leaderboard"); }}>
              <X className="h-4 w-4" /> Limpiar
            </Button>
          </div>
        )}
      </div>

      {/* Comparison Mode */}
      {mode === "comparison" && selectedAgents.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Comparación de Score</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={comparisonScoreData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]} />
                  <Bar dataKey="avgScore" radius={[4, 4, 0, 0]}>
                    {comparisonScoreData.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Volumen de Evaluaciones</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={comparisonVolumeData} cx="50%" cy="50%" outerRadius={100} dataKey="value"
                    label={(props) => `${props.name}: ${props.value}`}>
                    {comparisonVolumeData.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Detail cards for compared agents */}
          <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {selectedAgents.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-4 space-y-2">
                  <p className="font-medium text-sm truncate">{a.name}</p>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <span className="text-muted-foreground">Score:</span>
                    <Badge variant={a.avgScore >= passThreshold ? "default" : "destructive"} className="text-xs">{a.avgScore.toFixed(1)}%</Badge>
                    <span className="text-muted-foreground">Pass Rate:</span><span>{a.passRate}%</span>
                    <span className="text-muted-foreground">Evals:</span><span>{a.totalEvaluations}</span>
                    <span className="text-muted-foreground">Min:</span><span>{a.minScore?.toFixed(0) ?? "—"}%</span>
                    <span className="text-muted-foreground">Max:</span><span>{a.maxScore?.toFixed(0) ?? "—"}%</span>
                    <span className="text-muted-foreground">Trend:</span>
                    <span className={a.trend > 0 ? "text-green-600" : a.trend < 0 ? "text-red-600" : ""}>
                      {a.trend > 0 ? "+" : ""}{a.trend.toFixed(1)}
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
        <Input placeholder="Buscar agente..." value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} className="w-64" />
        <Select value={campaignFilter} onValueChange={(v) => v && setCampaignFilter(v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las campañas</SelectItem>
            {campaigns.map((c) => (<SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground ml-auto">
          {filtered.length} agente{filtered.length !== 1 ? "s" : ""}
          {selectedIds.size > 0 && ` — ${selectedIds.size} seleccionado${selectedIds.size !== 1 ? "s" : ""} (max 5)`}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className={selectedIds.has(row.original.id) ? "bg-accent" : ""}>
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
                  No hay datos de agentes
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
