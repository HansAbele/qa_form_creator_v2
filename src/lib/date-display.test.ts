import { describe, expect, it } from "vitest";
import {
  formatDateOnlyForDisplay,
  formatOperationalTimestamp,
  UNAVAILABLE_DATE_LABEL,
} from "@/lib/date-display";

describe("formatDateOnlyForDisplay", () => {
  it("should preserve the calendar day for a YYYY-MM-DD value", () => {
    expect(
      formatDateOnlyForDisplay(
        "2026-01-01",
        { day: "2-digit", month: "2-digit", year: "numeric" },
        "en-US",
      ),
    ).toBe("01/01/2026");
  });

  it("should reject impossible or timestamp-shaped values", () => {
    expect(formatDateOnlyForDisplay("2026-02-30")).toBe(UNAVAILABLE_DATE_LABEL);
    expect(formatDateOnlyForDisplay("2026-02-28T00:00:00Z")).toBe(UNAVAILABLE_DATE_LABEL);
  });
});

describe("formatOperationalTimestamp", () => {
  it("should render the same instant on the operational calendar day", () => {
    const instant = "2026-07-16T03:30:00.000Z";
    const options = {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    } as const;

    expect(formatOperationalTimestamp(instant, "UTC", options, "en-US")).toBe(
      "07/16/2026, 03:30",
    );
    expect(formatOperationalTimestamp(instant, "America/Havana", options, "en-US")).toBe(
      "07/15/2026, 23:30",
    );
  });

  it("should fail closed for invalid values or time zones", () => {
    expect(formatOperationalTimestamp("not-a-date", "UTC")).toBe(UNAVAILABLE_DATE_LABEL);
    expect(formatOperationalTimestamp(0, "Not/A_Time_Zone")).toBe(UNAVAILABLE_DATE_LABEL);
  });
});
