import { describe, expect, it } from "vitest";
import { getStaticKpiDisplayText } from "@/components/ui/kpi-card";

describe("getStaticKpiDisplayText", () => {
  it("keeps numeric rendering for loading and ready states", () => {
    expect(getStaticKpiDisplayText({ state: "loading", text: null })).toBeNull();
    expect(getStaticKpiDisplayText({ state: "ready", text: "82.5%" })).toBeNull();
  });

  it("renders explicit no-data and unavailable values", () => {
    expect(getStaticKpiDisplayText({ state: "no-data", text: "0" })).toBe("0");
    expect(getStaticKpiDisplayText({ state: "no-data", text: "—" })).toBe("—");
    expect(getStaticKpiDisplayText({ state: "unavailable", text: "—" })).toBe("—");
  });
});
