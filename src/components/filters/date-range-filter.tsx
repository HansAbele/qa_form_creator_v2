"use client";

import { format, isBefore, isSameDay, isValid, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  addOperationalCalendarDays,
  formatOperationalDate,
  useOperationalTimeZone,
} from "@/components/providers/operational-time-provider";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Preset = "hoy" | "7" | "30" | "90" | "todo";

interface DateRangeFilterProps {
  /** Committed range, ISO `yyyy-MM-dd` or empty for all available history. */
  from: string;
  to: string;
  /** Runs only after choosing a preset or pressing Aplicar. */
  onApply: (from: string, to: string) => void;
  id?: string;
  label?: string;
  className?: string;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  disabled?: boolean;
}

const SHORTCUTS: { key: Preset; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "7", label: "Últimos 7 días" },
  { key: "30", label: "Últimos 30 días" },
  { key: "90", label: "Últimos 90 días" },
  { key: "todo", label: "Todo el periodo" },
];

const isoOf = (date: Date) => format(date, "yyyy-MM-dd");

function parseDate(value: string): Date | null {
  if (!value) return null;
  const date = parseISO(value);
  return isValid(date) ? date : null;
}

function resolvePreset(key: Preset, timeZone: string): { from: string; to: string } {
  const today = formatOperationalDate(new Date(), timeZone);
  if (key === "todo") return { from: "", to: "" };
  if (key === "hoy") return { from: today, to: today };
  return { from: addOperationalCalendarDays(today, -(Number(key) - 1)), to: today };
}

function activePreset(from: string, to: string, timeZone: string): Preset | null {
  for (const shortcut of SHORTCUTS) {
    const range = resolvePreset(shortcut.key, timeZone);
    if (range.from === from && range.to === to) return shortcut.key;
  }
  return null;
}

/** Shared, human-readable label for every date-range control and active-filter badge. */
export function dateRangeLabel(from: string, to: string, operationalToday?: string): string {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start && !end) return "Todo el periodo";
  if (start && end && isSameDay(start, end)) {
    const day = format(start, "d MMM", { locale: es });
    return operationalToday === from ? `Hoy · ${day}` : day;
  }
  if (start && end) {
    return `${format(start, "d MMM", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })}`;
  }
  if (start) return `Desde ${format(start, "d MMM yyyy", { locale: es })}`;
  return `Hasta ${format(end as Date, "d MMM yyyy", { locale: es })}`;
}

export function DateRangeFilter({
  from,
  to,
  onApply,
  id = "date-range-filter",
  label,
  className,
  triggerClassName,
  align = "end",
  disabled = false,
}: DateRangeFilterProps) {
  const operationalTimeZone = useOperationalTimeZone();
  const operationalToday = formatOperationalDate(new Date(), operationalTimeZone);
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<Date | null>(parseDate(from));
  const [draftTo, setDraftTo] = useState<Date | null>(parseDate(to));
  const [month, setMonth] = useState<Date>(
    parseDate(from) ?? parseDate(to) ?? parseISO(operationalToday),
  );

  const handleOpenChange = (next: boolean) => {
    if (next) {
      const committedFrom = parseDate(from);
      const committedTo = parseDate(to);
      setDraftFrom(committedFrom);
      setDraftTo(committedTo);
      setMonth(committedFrom ?? committedTo ?? parseISO(operationalToday));
    }
    setOpen(next);
  };

  const handleDay = (day: Date) => {
    if (!draftFrom || draftTo) {
      setDraftFrom(day);
      setDraftTo(null);
    } else if (isBefore(day, draftFrom)) {
      setDraftFrom(day);
      setDraftTo(draftFrom);
    } else {
      setDraftTo(day);
    }
  };

  const applyShortcut = (key: Preset) => {
    const range = resolvePreset(key, operationalTimeZone);
    onApply(range.from, range.to);
    setOpen(false);
  };

  const apply = () => {
    const start = draftFrom ? isoOf(draftFrom) : "";
    const end = draftTo ? isoOf(draftTo) : start;
    onApply(start, end);
    setOpen(false);
  };

  const active = activePreset(
    draftFrom ? isoOf(draftFrom) : "",
    draftTo ? isoOf(draftTo) : "",
    operationalTimeZone,
  );
  const currentLabel = dateRangeLabel(from, to, operationalToday);

  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      {label ? (
        <Label htmlFor={id} className="text-xs font-medium text-foreground/80">
          {label}
        </Label>
      ) : null}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[11px] border border-border bg-card px-3 text-sm font-medium shadow-sm outline-none transition-colors hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            triggerClassName,
          )}
          aria-label={`${label ?? "Periodo"}: ${currentLabel}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate tabular-nums">{currentLabel}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className="flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[480px] flex-col gap-0 overflow-y-auto overflow-x-hidden p-0 sm:flex-row"
        >
          <div className="grid w-full shrink-0 grid-cols-2 gap-0.5 bg-secondary/60 p-2 sm:flex sm:w-[160px] sm:flex-col">
            {SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut.key}
                type="button"
                onClick={() => applyShortcut(shortcut.key)}
                aria-pressed={active === shortcut.key}
                className={cn(
                  "rounded-md px-2.5 py-2 text-left text-[13px] font-medium outline-none transition-colors last:col-span-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:last:col-span-1",
                  active === shortcut.key
                    ? "bg-accent font-bold text-accent-foreground"
                    : "text-foreground",
                )}
              >
                {shortcut.label}
              </button>
            ))}
          </div>
          <div className="flex w-full min-w-0 flex-col items-center p-3 sm:w-auto sm:items-stretch">
            <Calendar
              month={month}
              from={draftFrom}
              to={draftTo}
              onMonthChange={setMonth}
              onSelectDay={handleDay}
            />
            <div className="mt-2 flex w-full items-center justify-between gap-3 border-t border-border pt-2.5">
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {draftFrom
                  ? dateRangeLabel(
                      isoOf(draftFrom),
                      draftTo ? isoOf(draftTo) : "",
                      operationalToday,
                    )
                  : "Selecciona un rango"}
              </span>
              <Button type="button" size="sm" onClick={apply}>
                Aplicar
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
