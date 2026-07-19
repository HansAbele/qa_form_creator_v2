import { describe, expect, it } from "vitest";
import { summarizeChartData } from "@/lib/chart-accessibility";

describe("summarizeChartData", () => {
  it("should identify an empty chart", () => {
    expect(summarizeChartData([])).toBe("No data.");
  });

  it("should include every value in a short series", () => {
    expect(summarizeChartData(["Enero: 72%", "Febrero: 81%"])).toBe(
      "2 data points: Enero: 72%; Febrero: 81%.",
    );
  });

  it("should bound a long series while preserving its first and last values", () => {
    const values = Array.from({ length: 12 }, (_, index) => `Día ${index + 1}: ${index}`);

    const description = summarizeChartData(values, 4);

    expect(description).toContain("Día 1: 0; Día 2: 1");
    expect(description).toContain("8 intermediate points omitted");
    expect(description).toContain("Día 11: 10; Día 12: 11");
    expect(description).not.toContain("Día 6: 5");
  });
});
