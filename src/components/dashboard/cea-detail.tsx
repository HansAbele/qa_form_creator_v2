"use client";

import { ShieldAlert } from "lucide-react";
import { useId } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useChartAnimation } from "@/components/ui/use-chart-animation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDateOnlyForDisplay } from "@/lib/date-display";

type Detail = Awaited<
  ReturnType<typeof import("@/server/queries/analytics").getCriticalErrorAccuracyDetail>
>;
type Fam = "CUSTOMER" | "BUSINESS" | "COMPLIANCE";

const FAMILY_LABEL: Record<Fam, string> = {
  CUSTOMER: "Customer",
  BUSINESS: "Business",
  COMPLIANCE: "Compliance",
};
const FAMILY_COLOR: Record<Fam, string> = {
  CUSTOMER: "#2563eb",
  BUSINESS: "#E8931A",
  COMPLIANCE: "#EC456A",
};
const FAMILIES: Fam[] = ["CUSTOMER", "BUSINESS", "COMPLIANCE"];

function accClass(v: number | null, target: number) {
  if (v === null) return "text-muted-foreground";
  if (v >= target) return "text-emerald-600 dark:text-emerald-400";
  if (v >= target - 2) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function AccCell({ v, target }: { v: number | null; target: number }) {
  return (
    <span className={cn("font-medium tabular-nums", accClass(v, target))}>
      {v === null ? "—" : `${v.toFixed(1)}%`}
    </span>
  );
}

export function CeaDetail({ data }: { data: Detail }) {
  const chartAnimation = useChartAnimation();
  const trendDescriptionId = useId();
  const header = (
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        <ShieldAlert className="h-4 w-4 text-rose-500" />
        Precisión de Error Crítico (CEA)
      </CardTitle>
    </CardHeader>
  );

  if (!data.configured) {
    return (
      <Card>
        {header}
        <CardContent>
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No hay preguntas marcadas como críticas (Customer / Business / Compliance) en el alcance
            actual. Márcalas como fatales con su tipo COPC en el constructor de formularios para
            activar el análisis CEA.
          </div>
        </CardContent>
      </Card>
    );
  }

  const trendValues = data.trend.flatMap((t) =>
    FAMILIES.map((f) => t[f]).filter((x): x is number => x !== null),
  );
  const trendMin = trendValues.length ? Math.min(...trendValues) : 100;
  const yLo = Math.max(0, Math.floor(trendMin / 5) * 5 - 5);

  return (
    <Card>
      {header}
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {data.overall.map((o) => (
            <div key={o.family} className="rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{FAMILY_LABEL[o.family]} CEA</span>
                <span className="text-xs text-muted-foreground">Benchmark {o.target}%</span>
              </div>
              <p
                className={cn(
                  "mt-1 font-heading text-3xl font-bold tabular-nums",
                  accClass(o.accuracy, o.target),
                )}
              >
                {o.accuracy === null ? "—" : `${o.accuracy.toFixed(1)}%`}
              </p>
              <p className="text-xs text-muted-foreground">
                {o.configured
                  ? `${o.applicable} evaluaciones · ${o.failedCount} con error`
                  : "Sin preguntas de este tipo"}
              </p>
            </div>
          ))}
        </div>

        {data.trend.length >= 2 && (
          <div
            role="img"
            aria-label="Tendencia de precisión de error crítico por familia"
            aria-describedby={trendDescriptionId}
          >
            <p className="mb-2 text-sm font-medium">Tendencia por familia</p>
            <p id={trendDescriptionId} className="sr-only">
              {data.trend
                .map(
                  (item) =>
                    `${formatDateOnlyForDisplay(item.date)}: Customer ${item.CUSTOMER ?? "sin datos"}%, Business ${item.BUSINESS ?? "sin datos"}%, Compliance ${item.COMPLIANCE ?? "sin datos"}%`,
                )
                .join("; ")}
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) =>
                    formatDateOnlyForDisplay(String(v), { day: "2-digit", month: "short" })
                  }
                  className="text-xs"
                />
                <YAxis domain={[yLo, 100]} className="text-xs" />
                <Tooltip
                  labelFormatter={(label) => formatDateOnlyForDisplay(String(label))}
                  formatter={(value, name) => [
                    value === null ? "—" : `${Number(value).toFixed(1)}%`,
                    FAMILY_LABEL[name as Fam] ?? name,
                  ]}
                />
                <Legend formatter={(value) => FAMILY_LABEL[value as Fam] ?? value} />
                {FAMILIES.map((f) => (
                  <ReferenceLine
                    key={`ref-${f}`}
                    y={data.targets[f]}
                    stroke={FAMILY_COLOR[f]}
                    strokeDasharray="2 4"
                    strokeOpacity={0.4}
                  />
                ))}
                {FAMILIES.map((f) => (
                  <Line
                    key={f}
                    type="monotone"
                    dataKey={f}
                    stroke={FAMILY_COLOR[f]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    isAnimationActive={chartAnimation}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">Por campaña</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaña</TableHead>
                  <TableHead className="text-right">Customer</TableHead>
                  <TableHead className="text-right">Business</TableHead>
                  <TableHead className="text-right">Compliance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byCampaign.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-[160px] truncate font-medium">{c.name}</TableCell>
                    <TableCell className="text-right">
                      <AccCell v={c.CUSTOMER} target={data.targets.CUSTOMER} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AccCell v={c.BUSINESS} target={data.targets.BUSINESS} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AccCell v={c.COMPLIANCE} target={data.targets.COMPLIANCE} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Agentes con menor precisión</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agente</TableHead>
                  <TableHead className="text-right">Customer</TableHead>
                  <TableHead className="text-right">Business</TableHead>
                  <TableHead className="text-right">Compliance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byAgent.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-[160px] truncate font-medium">
                      {a.name}
                      {a.agentCode ? (
                        <span className="ml-1 text-xs text-muted-foreground">({a.agentCode})</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <AccCell v={a.CUSTOMER} target={data.targets.CUSTOMER} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AccCell v={a.BUSINESS} target={data.targets.BUSINESS} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AccCell v={a.COMPLIANCE} target={data.targets.COMPLIANCE} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
