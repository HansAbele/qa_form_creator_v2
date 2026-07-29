import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, getCampaignFilterMock, userCampaignFindManyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getCampaignFilterMock: vi.fn(),
  userCampaignFindManyMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: { userCampaign: { findMany: userCampaignFindManyMock } },
}));
vi.mock("@/server/queries/campaign-filter", () => ({
  getCampaignFilter: getCampaignFilterMock,
}));

import {
  buildInteractionWhere,
  getCallFinderCampaignFilter,
  parseCallFinderFilters,
  toCampaignWhere,
} from "./call-finder";

beforeEach(() => {
  authMock.mockReset();
  getCampaignFilterMock.mockReset();
  userCampaignFindManyMock.mockReset();
});

describe("parseCallFinderFilters", () => {
  it("should normalize supported filters", () => {
    expect(
      parseCallFinderFilters({
        campaignId: "campaign-1",
        provider: "VICIDIAL",
        direction: "INBOUND",
        minDuration: "30",
        maxDuration: "600",
        page: "2",
      }),
    ).toEqual(
      expect.objectContaining({
        campaignId: "campaign-1",
        provider: "VICIDIAL",
        direction: "INBOUND",
        minDuration: 30,
        maxDuration: 600,
        page: 2,
      }),
    );
  });

  it("should fall back safely when a query contains unsupported values", () => {
    expect(parseCallFinderFilters({ provider: "unknown", page: "-2" })).toEqual(
      expect.objectContaining({ page: 1 }),
    );
  });

  it("should discard an inverted duration range", () => {
    const result = parseCallFinderFilters({ minDuration: "600", maxDuration: "30" });
    expect(result.minDuration).toBeUndefined();
    expect(result.maxDuration).toBeUndefined();
  });
});

describe("buildInteractionWhere", () => {
  it("should filter by measured recording duration before provider contact duration", () => {
    const where = buildInteractionWhere(
      parseCallFinderFilters({ minDuration: "60", maxDuration: "300" }),
      { campaignId: "campaign-1" },
    );

    expect(where).toEqual(
      expect.objectContaining({
        campaignId: "campaign-1",
        OR: [
          { mediaAssets: { some: { durationMs: { gte: 60_000, lte: 300_000 } } } },
          {
            AND: [
              { mediaAssets: { none: { durationMs: { not: null } } } },
              { durationSeconds: { gte: 60, lte: 300 } },
            ],
          },
        ],
      }),
    );
  });
});

describe("getCallFinderCampaignFilter", () => {
  it("should keep Call Finder inside campaign membership and evaluate permission", async () => {
    authMock.mockResolvedValue({
      user: { id: "qa-1", role: "QA", campaignIds: ["campaign-1", "campaign-2"] },
    });
    getCampaignFilterMock.mockResolvedValue({
      campaignId: { in: ["campaign-1", "campaign-2"] },
    });
    userCampaignFindManyMock.mockResolvedValue([{ campaignId: "campaign-1" }]);

    await expect(getCallFinderCampaignFilter("evaluate")).resolves.toEqual({
      campaignId: { in: ["campaign-1"] },
    });
    expect(userCampaignFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "qa-1",
          campaignId: { in: ["campaign-1", "campaign-2"] },
          canEvaluate: true,
        }),
      }),
    );
  });

  it("should return no campaigns when the requested campaign lacks permission", async () => {
    authMock.mockResolvedValue({
      user: { id: "qa-1", role: "QA", campaignIds: ["campaign-2"] },
    });
    getCampaignFilterMock.mockResolvedValue({ campaignId: "campaign-2" });
    userCampaignFindManyMock.mockResolvedValue([]);

    await expect(getCallFinderCampaignFilter("evaluate", "campaign-2")).resolves.toEqual({
      campaignId: { in: [] },
    });
  });
});

describe("toCampaignWhere", () => {
  it("should translate a scoped interaction campaign filter to Campaign.id", () => {
    expect(toCampaignWhere({ campaignId: { in: ["campaign-1", "campaign-2"] } })).toEqual({
      id: { in: ["campaign-1", "campaign-2"] },
      active: true,
    });
  });

  it("should keep an unrestricted admin query limited to active campaigns", () => {
    expect(toCampaignWhere({})).toEqual({ active: true });
  });
});
