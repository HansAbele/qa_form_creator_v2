"use client";

import { createContext, useContext } from "react";

const OperationalTimeZoneContext = createContext("UTC");

export function OperationalTimeProvider({
  children,
  timeZone,
}: {
  children: React.ReactNode;
  timeZone: string;
}) {
  return (
    <OperationalTimeZoneContext.Provider value={timeZone}>
      {children}
    </OperationalTimeZoneContext.Provider>
  );
}

export function useOperationalTimeZone() {
  return useContext(OperationalTimeZoneContext);
}

export function formatOperationalDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addOperationalCalendarDays(dateOnly: string, days: number) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
