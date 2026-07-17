import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDateRangePreset } from "./date-range-filter";

afterEach(() => {
  vi.useRealTimers();
});

function setNow(isoDate: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoDate));
}

describe("DateRangeFilter monthly presets", () => {
  it("resolves Este mes from its first day through the operational current day", () => {
    setNow("2026-07-17T15:00:00.000Z");

    expect(resolveDateRangePreset("este_mes", "America/Havana")).toEqual({
      from: "2026-07-01",
      to: "2026-07-17",
    });
  });

  it("resolves Mes anterior as the complete preceding calendar month", () => {
    setNow("2026-07-17T15:00:00.000Z");

    expect(resolveDateRangePreset("mes_anterior", "America/Havana")).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });

  it("crosses the year boundary for the previous month", () => {
    setNow("2026-01-15T15:00:00.000Z");

    expect(resolveDateRangePreset("mes_anterior", "America/Havana")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("includes February 29 when the previous month belongs to a leap year", () => {
    setNow("2024-03-15T15:00:00.000Z");

    expect(resolveDateRangePreset("mes_anterior", "America/Havana")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });

  it("uses the operational date when UTC is already in the following month", () => {
    setNow("2026-03-01T02:30:00.000Z");

    expect(resolveDateRangePreset("este_mes", "America/Havana")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(resolveDateRangePreset("mes_anterior", "America/Havana")).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });
});
