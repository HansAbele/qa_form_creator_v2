import { describe, expect, it } from "vitest";
import { getMetricDisplay } from "@/lib/metric-display";

describe("getMetricDisplay", () => {
  it("shows a truthful zero for an empty count", () => {
    expect(getMetricDisplay({ kind: "count", value: 0, hasData: false, status: "empty" })).toEqual({
      state: "no-data",
      text: "0",
    });
  });

  it.each(["average", "rate"])("does not invent a zero for an empty %s", () => {
    expect(
      getMetricDisplay({
        kind: "measure",
        value: 0,
        hasData: false,
        status: "empty",
        decimals: 1,
        suffix: "%",
      }),
    ).toEqual({ state: "no-data", text: "—" });
  });

  it("formats an available measurement", () => {
    expect(
      getMetricDisplay({
        kind: "measure",
        value: 87.345,
        hasData: true,
        status: "success",
        decimals: 1,
        suffix: "%",
      }),
    ).toEqual({ state: "ready", text: "87.3%" });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined,
  ])("marks an invalid loaded metric as unavailable (%s)", (value) => {
    expect(getMetricDisplay({ kind: "measure", value, hasData: true, status: "success" })).toEqual({
      state: "unavailable",
      text: "—",
    });
  });

  it("reserves a blank placeholder only for active loading", () => {
    expect(
      getMetricDisplay({ kind: "count", value: undefined, hasData: false, status: "loading" }),
    ).toEqual({ state: "loading", text: null });
  });

  it("marks failures as unavailable instead of leaving a loading placeholder", () => {
    expect(
      getMetricDisplay({ kind: "count", value: undefined, hasData: false, status: "error" }),
    ).toEqual({ state: "unavailable", text: "—" });
  });
});
