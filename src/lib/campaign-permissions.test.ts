import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_ACCESS_PRESETS,
  CAMPAIGN_PERMISSION_GROUPS,
  CAMPAIGN_PERMISSION_KEYS,
  getDefaultCampaignAccessForUserRole,
} from "./campaign-permissions";

describe("campaign access presets", () => {
  it("gives evaluators the campaign-scoped tools required for daily QA work", () => {
    expect(CAMPAIGN_ACCESS_PRESETS.EVALUATOR).toEqual({
      canViewDashboard: true,
      canViewKPIs: true,
      canViewForms: true,
      canViewEvaluations: true,
      canCreateForms: true,
      canEditForms: true,
      canPublishForms: false,
      canEvaluate: true,
      canEditEvaluations: false,
      canViewReports: true,
      canExport: false,
      canManageAgents: false,
      canManageDispositions: false,
      canManageCampaignScoring: false,
      canViewAudit: false,
      canViewCoaching: true,
      canManageCoaching: true,
      canTrackQaActivity: true,
      canViewQaActivity: false,
      canViewPips: false,
      canManagePips: false,
    });
  });

  it("defaults QA users to evaluator instead of campaign administrator", () => {
    expect(getDefaultCampaignAccessForUserRole("QA")).toMatchObject({
      roleInCampaign: "EVALUATOR",
      canEvaluate: true,
      canCreateForms: true,
      canEditForms: true,
      canViewEvaluations: true,
      canViewReports: true,
    });
  });

  it("keeps administrators and supervisors on their intended presets", () => {
    expect(getDefaultCampaignAccessForUserRole("ADMIN").roleInCampaign).toBe("CAMPAIGN_ADMIN");
    expect(getDefaultCampaignAccessForUserRole("SUPERVISOR").roleInCampaign).toBe("SUPERVISOR");
  });

  it("limits agent portal accounts to their private performance records", () => {
    expect(getDefaultCampaignAccessForUserRole("AGENT")).toEqual({
      roleInCampaign: "AGENT",
      ...CAMPAIGN_ACCESS_PRESETS.AGENT,
    });
  });

  it("uses the least-privileged preset for an unknown role", () => {
    expect(getDefaultCampaignAccessForUserRole(undefined).roleInCampaign).toBe("EVALUATOR");
  });

  it("shows every campaign permission exactly once in the manager editor", () => {
    const editableKeys = CAMPAIGN_PERMISSION_GROUPS.flatMap((group) => [...group.keys]);

    expect(editableKeys).toHaveLength(CAMPAIGN_PERMISSION_KEYS.length);
    expect(new Set(editableKeys)).toEqual(new Set(CAMPAIGN_PERMISSION_KEYS));
  });
});
