import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  normalizeWorkspacePreferences,
  resolvePreferredCampaignId,
  resolveWorkspaceDateRange,
} from "./workspace-preferences";

describe("workspace preferences", () => {
  it("normalizes malformed persisted JSON without trusting unknown values", () => {
    expect(
      normalizeWorkspacePreferences({
        defaultCampaignId: 42,
        defaultDateRange: "SOMEDAY",
        defaultEvaluationScope: "GLOBAL",
      }),
    ).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
  });

  it("always selects the only available campaign", () => {
    expect(
      resolvePreferredCampaignId(
        { ...DEFAULT_WORKSPACE_PREFERENCES, defaultCampaignId: "not-accessible" },
        [{ id: "campaign-1" }],
      ),
    ).toBe("campaign-1");
  });

  it("uses a preferred campaign only when it remains accessible", () => {
    const campaigns = [{ id: "campaign-1" }, { id: "campaign-2" }];
    expect(
      resolvePreferredCampaignId(
        { ...DEFAULT_WORKSPACE_PREFERENCES, defaultCampaignId: "campaign-2" },
        campaigns,
      ),
    ).toBe("campaign-2");
    expect(
      resolvePreferredCampaignId(
        { ...DEFAULT_WORKSPACE_PREFERENCES, defaultCampaignId: "campaign-3" },
        campaigns,
      ),
    ).toBeUndefined();
  });

  it("builds inclusive operational date presets", () => {
    expect(resolveWorkspaceDateRange("LAST_7_DAYS", new Date("2026-08-03T12:00:00Z"))).toEqual({
      dateFrom: "2026-07-28",
      dateTo: "2026-08-03",
    });
    expect(resolveWorkspaceDateRange("ALL_TIME")).toEqual({});
  });
});
