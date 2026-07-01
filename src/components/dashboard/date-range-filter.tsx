"use client";

import { format, isBefore, isSameDay, parseISO, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Preset = "hoy" | "7" | "30" | "90" | "todo";

interface DateRangeFilterProps {
  /** Committed range, ISO `yyyy-MM-dd` or "" for open/all. */
  from: string;
  to: string;
  /** Called once, on "Aplicar" or on a shortcut click. */
  onApply: (from: string, to: string) => void;
}

const SHORTCUTS: { key: Preset; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "7", label: "Últimos 7 días" },
  { key: "30", label: "Últimos 30 días" },
  { key: "90", label: "Últimos 90 días" },
  { key: "todo", label: "Todo el periodo" },
];

const isoOf = (d: Date) => format(d, "yyyy-MM-dd");
const parse = (s: string) => (s ? parseISO(s) : null);

function resolvePreset(key: Preset): { from: string; to: string } {
  const today = new Date();
  if (key === "todo") return { from: "", to: "" };
  if (key === "hoy") return { from: isoOf(today), to: isoOf(today) };
  return { from: isoOf(subDays(today, Number(key))), to: isoOf(today) };
}

function activePreset(from: string, to: string): Preset | null {
  for (const s of SHORTCUTS) {
    const r = resolvePreset(s.key);
    if (r.from === from && r.to === to) return s.key;
  }
  return null;
}

/** Human label for the pill / dashboard subtitle. Single source of truth. */
export function dateRangeLabel(from: string, to: string): string {
  const f = parse(from);
  const t = parse(to);
  if (!f && !t) return "Todo el periodo";
  if (f && t && isSameDay(f, t)) {
    const day = format(f, "d MMM", { locale: es });
    return isSameDay(f, new Date()) ? `Hoy · ${day}` : day;
  }
  if (f && t) {
    return `${format(f, "d MMM", { locale: es })} – ${format(t, "d MMM yyyy", { locale: es })}`;
  }
  if (f) return `Desde ${format(f, "d MMM yyyy", { locale: es })}`;
  return "Todo el periodo";
}

export function DateRangeFilter({ from, to, onApply }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<Date | null>(parse(from));
  const [draftTo, setDraftTo] = useState<Date | null>(parse(to));
  const [month, setMonth] = useState<Date>(parse(from) ?? new Date());

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Re-seed the draft from committed props whenever the popover opens.
      setDraftFrom(parse(from));
      setDraftTo(parse(to));
      setMonth(parse(from) ?? new Date());
    }
    setOpen(next);
  };

  const handleDay = (day: Date) => {
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(day);
      setDraftTo(null);
    } else if (isBefore(day, draftFrom)) {
      setDraftTo(draftFrom);
      setDraftFrom(day);
    } else {
      setDraftTo(day);
    }
  };

  const applyShortcut = (key: Preset) => {
    const r = resolvePreset(key);
    onApply(r.from, r.to);
    setOpen(false);
  };

  const apply = () => {
    const f = draftFrom ? isoOf(draftFrom) : "";
    const t = draftTo ? isoOf(draftTo) : f;
    onApply(f, t);
    setOpen(false);
  };

  const active = activePreset(
    draftFrom ? isoOf(draftFrom) : "",
    draftTo ? isoOf(draftTo) : "",
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className="flex h-10 items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-sm font-medium shadow-sm transition-colors hover:border-primary"
        aria-label={`Periodo: ${dateRangeLabel(from, to)}`}
      >
        <CalendarDays className="h-4 w-4 text-primary" />
        <span className="tabular-nums">{dateRangeLabel(from, to)}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto gap-0 overflow-hidden p-0">
        <div className="flex w-[160px] shrink-0 flex-col gap-0.5 bg-secondary/60 p-2">
          {SHORTCUTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => applyShortcut(s.key)}
              className={cn(
                "rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                active === s.key
                  ? "bg-accent font-bold text-accent-foreground"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col p-3">
          <Calendar
            month={month}
            from={draftFrom}
            to={draftTo}
            onMonthChange={setMonth}
            onSelectDay={handleDay}
          />
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2.5">
            <span className="text-xs text-muted-foreground">
              {draftFrom
                ? dateRangeLabel(isoOf(draftFrom), draftTo ? isoOf(draftTo) : "")
                : "Selecciona un rango"}
            </span>
            <Button size="sm" onClick={apply}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
