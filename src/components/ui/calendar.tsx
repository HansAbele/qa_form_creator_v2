"use client";

import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

interface CalendarProps {
  month: Date;
  from: Date | null;
  to: Date | null;
  onMonthChange: (month: Date) => void;
  onSelectDay: (day: Date) => void;
}

/**
 * Minimal range calendar built on date-fns (no react-day-picker — the project
 * uses Base UI primitives, not Radix). Selection logic lives in the parent;
 * this component only renders and reports day clicks.
 */
export function Calendar({ month, from, to, onMonthChange, onSelectDay }: CalendarProps) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  return (
    <div className="w-full max-w-[280px] select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Mes anterior"
          onClick={() => onMonthChange(addMonths(month, -1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-heading text-sm font-semibold capitalize">
          {format(month, "LLLL yyyy", { locale: es })}
        </span>
        <button
          type="button"
          aria-label="Mes siguiente"
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            className="pb-1 text-center text-[11px] font-semibold uppercase text-muted-foreground"
          >
            {w}
          </span>
        ))}
        {days.map((day) => {
          const inMonth = isSameMonth(day, month);
          const isEndpoint = (from && isSameDay(day, from)) || (to && isSameDay(day, to));
          const inRange = from && to && isWithinInterval(day, { start: from, end: to });
          const isToday = isSameDay(day, today);
          return (
            <button
              key={day.toISOString()}
              type="button"
              aria-label={format(day, "d 'de' MMMM yyyy", { locale: es })}
              aria-pressed={Boolean(isEndpoint)}
              onClick={() => onSelectDay(day)}
              className={cn(
                "mx-auto grid h-8 w-8 place-items-center rounded-md text-[13px] tabular-nums transition-colors",
                !inMonth && "text-muted-foreground/45",
                isEndpoint && "bg-primary font-extrabold text-primary-foreground",
                !isEndpoint && inRange && "bg-accent text-accent-foreground",
                !isEndpoint && !inRange && "hover:bg-muted",
                !isEndpoint && !inRange && isToday && "ring-1 ring-inset ring-primary",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
