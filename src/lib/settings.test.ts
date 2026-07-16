import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("next/cache", () => ({
  unstable_cache: (reader: () => unknown) => reader,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});

import { DEFAULT_SETTINGS, getCampaignScoringSettings, getSettings } from "./settings";

describe("authoritative scoring settings", () => {
  beforeEach(() => {
    resetPrismaMock();
    prismaMock.appSetting.findMany.mockResolvedValue([]);
    prismaMock.campaignScoringSettings.findUnique.mockResolvedValue(null);
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
});
