import { describe, expect, it, vi } from "vitest";
import { formatCalendarDayLabel, formatCalendarMonth, getCalendarWeekdays } from "./calendar";

vi.mock("@/components/providers/i18n-provider", () => ({
  useI18n: () => ({ locale: "en", t: (message: string) => message }),
}));

describe("Calendar localization", () => {
  const july = new Date(2026, 6, 17);

  it("renders English calendar copy", () => {
    expect(getCalendarWeekdays("en").map(({ label }) => label)).toEqual([
      "Mo",
      "Tu",
      "We",
      "Th",
      "Fr",
      "Sa",
      "Su",
    ]);
    expect(formatCalendarMonth(july, "en")).toBe("July 2026");
    expect(formatCalendarDayLabel(july, "en")).toBe("July 17, 2026");
  });

  it("renders Spanish calendar copy", () => {
    expect(getCalendarWeekdays("es").map(({ label }) => label)).toEqual([
      "lu",
      "ma",
      "mi",
      "ju",
      "vi",
      "sá",
      "do",
    ]);
    expect(formatCalendarMonth(july, "es")).toBe("julio 2026");
    expect(formatCalendarDayLabel(july, "es")).toBe("17 de julio de 2026");
  });
});
