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
import { enUS, es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const WEEKDAY_REFERENCE = new Date(2024, 0, 1);
const WEEKDAYS = [
  { key: "monday", offset: 0 },
  { key: "tuesday", offset: 1 },
  { key: "wednesday", offset: 2 },
  { key: "thursday", offset: 3 },
  { key: "friday", offset: 4 },
  { key: "saturday", offset: 5 },
  { key: "sunday", offset: 6 },
] as const;

function dateFnsLocale(locale: Locale) {
  return locale === "es" ? es : enUS;
}

export function getCalendarWeekdays(locale: Locale) {
  const localized = dateFnsLocale(locale);
  return WEEKDAYS.map(({ key, offset }) => ({
    key,
    label: format(addDays(WEEKDAY_REFERENCE, offset), "EEEEEE", { locale: localized }),
  }));
}

export function formatCalendarMonth(month: Date, locale: Locale) {
  return format(month, "LLLL yyyy", { locale: dateFnsLocale(locale) });
}

export function formatCalendarDayLabel(day: Date, locale: Locale) {
  const pattern = locale === "es" ? "d 'de' MMMM 'de' yyyy" : "MMMM d, yyyy";
  return format(day, pattern, { locale: dateFnsLocale(locale) });
}

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
  const { locale, t } = useI18n();
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdays = getCalendarWeekdays(locale);
  const today = new Date();

  return (
    <div className="w-full max-w-[280px] select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label={t("Previous month")}
          onClick={() => onMonthChange(addMonths(month, -1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-heading text-sm font-semibold capitalize">
          {formatCalendarMonth(month, locale)}
        </span>
        <button
          type="button"
          aria-label={t("Next month")}
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {weekdays.map((weekday) => (
          <span
            key={weekday.key}
            className="pb-1 text-center text-[11px] font-semibold uppercase text-muted-foreground"
          >
            {weekday.label}
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
              aria-label={formatCalendarDayLabel(day, locale)}
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
