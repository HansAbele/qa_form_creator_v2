"use client";

import { format, isValid, parseISO } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { CalendarDays, ChevronDown, Clock3, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type DateTimePickerMode = "date" | "datetime";

interface DateTimePickerProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  mode?: DateTimePickerMode;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  fixedDate?: string;
}

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

function parsePickerDate(value: string) {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

function datePart(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function timeParts(value: string) {
  const match = value.match(/T(\d{2}):(\d{2})/);
  return {
    hour: match?.[1] ?? "09",
    minute: match?.[2] ?? "00",
  };
}

export function DateTimePicker({
  id,
  value,
  onChange,
  mode = "datetime",
  placeholder,
  disabled = false,
  required = false,
  className,
  fixedDate,
}: DateTimePickerProps) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const initial = parsePickerDate(value);
  const initialTime = timeParts(value);
  const [draftDate, setDraftDate] = useState<Date | null>(initial);
  const [month, setMonth] = useState(initial ?? new Date());
  const [hour, setHour] = useState(initialTime.hour);
  const [minute, setMinute] = useState(initialTime.minute);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const committedDate = parsePickerDate(value);
      const committedTime = timeParts(value);
      const fixed = fixedDate ? parseISO(fixedDate) : null;
      setDraftDate(committedDate ?? fixed);
      setMonth(committedDate ?? fixed ?? new Date());
      setHour(committedTime.hour);
      setMinute(committedTime.minute);
    }
    setOpen(nextOpen);
  };

  const apply = () => {
    if (!draftDate) return;
    const day = fixedDate ?? datePart(draftDate);
    onChange(mode === "datetime" ? `${day}T${hour}:${minute}` : day);
    setOpen(false);
  };

  const formattedValue = initial
    ? format(
        initial,
        mode === "datetime"
          ? locale === "es"
            ? "d MMM yyyy · HH:mm"
            : "MMM d, yyyy · HH:mm"
          : locale === "es"
            ? "d MMM yyyy"
            : "MMM d, yyyy",
        { locale: locale === "es" ? es : enUS },
      )
    : null;

  return (
    <div className={cn("flex min-w-0 gap-2", className)}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          id={id}
          type="button"
          disabled={disabled}
          aria-required={required}
          className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-[11px] border border-border bg-card px-3 text-sm font-medium shadow-sm outline-none transition-colors hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex min-w-0 items-center gap-2">
            {mode === "datetime" ? (
              <Clock3 className="size-4 shrink-0 text-primary" />
            ) : (
              <CalendarDays className="size-4 shrink-0 text-primary" />
            )}
            <span
              className={cn("truncate tabular-nums", !formattedValue && "text-muted-foreground")}
            >
              {formattedValue ?? placeholder ?? t("Select date")}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[calc(100vw-2rem)] max-w-[320px] p-3">
          {fixedDate ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium">
              <CalendarDays className="size-4 text-primary" />
              {format(parseISO(fixedDate), locale === "es" ? "d MMM yyyy" : "MMM d, yyyy", {
                locale: locale === "es" ? es : enUS,
              })}
            </div>
          ) : (
            <Calendar
              month={month}
              from={draftDate}
              to={draftDate}
              onMonthChange={setMonth}
              onSelectDay={(day) => {
                setDraftDate(day);
                setMonth(day);
              }}
            />
          )}
          {mode === "datetime" ? (
            <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
              <Select value={hour} onValueChange={(next) => next && setHour(next)}>
                <SelectTrigger aria-label={t("Hour")} className="w-full">
                  <SelectValue>{hour}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {HOURS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={minute} onValueChange={(next) => next && setMinute(next)}>
                <SelectTrigger aria-label={t("Minute")} className="w-full">
                  <SelectValue>{minute}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {MINUTES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">
              {draftDate ? datePart(draftDate) : t("Select date")}
              {mode === "datetime" && draftDate ? ` · ${hour}:${minute}` : ""}
            </span>
            <Button type="button" size="sm" disabled={!draftDate} onClick={apply}>
              {t("Apply")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {value && !required ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t("Clear date")}
          onClick={() => onChange("")}
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
