"use client";

import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type CeaFamily = {
  family: "CUSTOMER" | "BUSINESS" | "COMPLIANCE";
  applicable: number;
  failedCount: number;
  accuracy: number | null;
  target: number;
  status: "en objetivo" | "en riesgo" | "bajo benchmark" | "no configurado";
  configured: boolean;
};

const FAMILY_META: Record<
  CeaFamily["family"],
  { title: string; description: string }
> = {
  CUSTOMER: { title: "Customer CEA", description: "Errores que afectan al cliente" },
  BUSINESS: { title: "Business CEA", description: "Errores de proceso o negocio" },
  COMPLIANCE: { title: "Compliance CEA", description: "Errores de cumplimiento" },
};

const STATUS_META: Record<
  CeaFamily["status"],
  { label: string; ring: string; text: string; badge: string }
> = {
  "en objetivo": {
    label: "En objetivo",
    ring: "#12A277",
    text: "text-emerald-600 dark:text-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  "en riesgo": {
    label: "En riesgo",
    ring: "#E8931A",
    text: "text-amber-600 dark:text-amber-400",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  "bajo benchmark": {
    label: "Bajo benchmark",
    ring: "#EC456A",
    text: "text-rose-600 dark:text-rose-400",
    badge: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  "no configurado": {
    label: "No configurado",
    ring: "#94a3b8",
    text: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
};

function Ring({ value, color }: { value: number | null; color: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Medidor de precisión de error crítico">
        <title>Medidor de precisión de error crítico</title>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="9"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 900ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {value === null ? (
          <span className="text-lg font-semibold text-muted-foreground">—</span>
        ) : (
          <span className="font-heading text-xl font-bold tabular-nums">
            {value.toFixed(1)}
            <span className="text-xs font-semibold">%</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Gauge({
  item,
  onViewIncidents,
}: {
  item: CeaFamily;
  onViewIncidents?: () => void;
}) {
  const meta = FAMILY_META[item.family];
  const status = STATUS_META[item.status];
  const delta =
    item.configured && item.accuracy !== null ? item.accuracy - item.target : null;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-4 text-center">
      <Ring value={item.accuracy} color={status.ring} />
      <div className="space-y-1">
        <div className="flex items-center justify-center gap-2">
          <span className="font-heading text-sm font-semibold">{meta.title}</span>
          {delta !== null && (
            <span className={cn("text-xs font-semibold tabular-nums", status.text)}>
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(1)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>
      <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", status.badge)}>
        {status.label}
      </span>
      <p className="text-[11px] text-muted-foreground">
        {item.configured ? `Benchmark ${item.target}%` : "Sin preguntas de este tipo"}
      </p>
      {item.family === "COMPLIANCE" && item.configured && onViewIncidents && (
        <button
          type="button"
          onClick={onViewIncidents}
          className="text-xs font-semibold text-[hsl(var(--tno-orange))] hover:underline"
        >
          Ver incidencias →
        </button>
      )}
    </div>
  );
}

export function CeaGauges({
  data,
  onViewIncidents,
}: {
  data: CeaFamily[];
  onViewIncidents?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-rose-500" />
          Riesgo crítico — Precisión de Error Crítico (CEA)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((item) => (
            <Gauge key={item.family} item={item} onViewIncidents={onViewIncidents} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
