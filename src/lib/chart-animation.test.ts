import { describe, expect, it } from "vitest";
import { isChartAnimationActive } from "./chart-animation";

describe("isChartAnimationActive", () => {
  it("disables chart animation when reduced motion is requested", () => {
    expect(isChartAnimationActive(true)).toBe(false);
  });

  it("keeps animation for the default and no-preference states", () => {
    expect(isChartAnimationActive(false)).toBe(true);
    expect(isChartAnimationActive(null)).toBe(true);
  });
});
