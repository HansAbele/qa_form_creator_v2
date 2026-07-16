import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("next/cache", () => ({
  unstable_cache: (reader: () => unknown) => reader,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});

import {
  DEFAULT_SETTINGS,
  getCampaignScoringSettings,
  getCampaignScoringSettingsMap,
  getSettings,
} from "./settings";

describe("authoritative scoring settings", () => {
  beforeEach(() => {
    resetPrismaMock();
    prismaMock.appSetting.findMany.mockResolvedValue([]);
    prismaMock.campaignScoringSettings.findUnique.mockResolvedValue(null);
    prismaMock.campaignScoringSettings.findMany.mockResolvedValue([]);
  });

  it("uses documented defaults only when settings rows are absent", async () => {
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("surfaces global settings storage failures", async () => {
    prismaMock.appSetting.findMany.mockRejectedValue(new Error("settings storage unavailable"));

    await expect(getSettings()).rejects.toThrow("settings storage unavailable");
  });

  it("rejects corrupted persisted scoring values instead of silently changing semantics", async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([
      { key: "passThreshold", value: "not-a-number" },
    ]);

    await expect(getSettings()).rejects.toThrow("passThreshold");
  });

  it("surfaces campaign scoring storage failures", async () => {
    prismaMock.campaignScoringSettings.findUnique.mockRejectedValue(
      new Error("campaign scoring unavailable"),
    );

    await expect(getCampaignScoringSettings("campaign-1")).rejects.toThrow(
      "campaign scoring unavailable",
    );
  });

  it("loads campaign scoring for many campaigns with one database query", async () => {
    prismaMock.campaignScoringSettings.findMany.mockResolvedValue([
      {
        campaignId: "campaign-2",
        usesGlobalDefaults: false,
        passThreshold: 82,
        targetPassRate: 91,
        targetAvgScore: 88,
        targetDailyRate: 14,
        fatalFailuresAllowed: 1,
        fatalZeroesScore: true,
        customerCeaTarget: 96,
        businessCeaTarget: 92,
        complianceCeaTarget: 99,
      },
    ]);

    const settings = await getCampaignScoringSettingsMap([
      "campaign-1",
      "campaign-2",
      "campaign-1",
    ]);

    expect(settings.get("campaign-1")).toEqual(
      expect.objectContaining({ campaignId: "campaign-1", passThreshold: 70 }),
    );
    expect(settings.get("campaign-2")).toEqual(
      expect.objectContaining({ campaignId: "campaign-2", passThreshold: 82 }),
    );
    expect(prismaMock.campaignScoringSettings.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.campaignScoringSettings.findUnique).not.toHaveBeenCalled();
  });
});
