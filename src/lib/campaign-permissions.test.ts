import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_ACCESS_PRESETS,
  getDefaultCampaignAccessForUserRole,
} from "./campaign-permissions";

describe("campaign access presets", () => {
  it("gives evaluators only the permissions required for their own QA work", () => {
    expect(CAMPAIGN_ACCESS_PRESETS.EVALUATOR).toEqual({
      canViewDashboard: true,
      canViewKPIs: false,
      canViewForms: true,
      canCreateForms: false,
      canEditForms: false,
      canPublishForms: false,
      canEvaluate: true,
      canEditEvaluations: false,
      canViewReports: false,
      canExport: false,
      canManageAgents: false,
      canManageDispositions: false,
      canManageCampaignScoring: false,
      canViewAudit: false,
    });
  });

  it("defaults QA users to evaluator instead of campaign administrator", () => {
    expect(getDefaultCampaignAccessForUserRole("QA")).toMatchObject({
      roleInCampaign: "EVALUATOR",
      canEvaluate: true,
      canCreateForms: false,
      canViewReports: false,
    });
  });

  it("keeps administrators and supervisors on their intended presets", () => {
    expect(getDefaultCampaignAccessForUserRole("ADMIN").roleInCampaign).toBe("CAMPAIGN_ADMIN");
    expect(getDefaultCampaignAccessForUserRole("SUPERVISOR").roleInCampaign).toBe("SUPERVISOR");
  });

  it("uses the least-privileged preset for an unknown role", () => {
    expect(getDefaultCampaignAccessForUserRole(undefined).roleInCampaign).toBe("EVALUATOR");
  });
});
