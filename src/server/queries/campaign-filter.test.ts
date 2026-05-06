import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  const mockedPrisma = (module as { prismaMock: unknown }).prismaMock;
  return { prisma: mockedPrisma };
});

import {
  assertCampaignPermissionForUser,
  getCampaignFilter,
  getCampaignFilterForPermission,
} from "./campaign-filter";

const adminUser = {
  id: "admin-1",
  role: "ADMIN",
  campaignIds: [],
};

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1", "campaign-2"],
};

describe("campaign RBAC filters", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
  });

  it("keeps admins globally scoped unless a campaign is explicitly requested", async () => {
    authMock.mockResolvedValue({ user: adminUser });

    await expect(getCampaignFilter()).resolves.toEqual({});
    await expect(getCampaignFilter("campaign-9")).resolves.toEqual({
      campaignId: "campaign-9",
    });
  });

  it("intersects QA filters with assigned campaigns", async () => {
    authMock.mockResolvedValue({ user: qaUser });

    await expect(getCampaignFilter()).resolves.toEqual({
      campaignId: { in: ["campaign-1", "campaign-2"] },
    });
    await expect(getCampaignFilter("campaign-2")).resolves.toEqual({
      campaignId: "campaign-2",
    });
  });

  it("rejects explicit campaign ids outside the QA assignment", async () => {
    authMock.mockResolvedValue({ user: qaUser });

    await expect(getCampaignFilter("campaign-3")).rejects.toThrow(
      "No autorizado para esta campana",
    );
  });

  it("filters permission-scoped campaigns by the requested permission", async () => {
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canExport: true },
      { campaignId: "campaign-2", canExport: false },
    ]);

    await expect(getCampaignFilterForPermission("canExport")).resolves.toEqual({
      campaignId: { in: ["campaign-1"] },
    });
  });

  it("rejects permission assertions when the campaign assignment lacks the permission", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageAgents: false,
    });

    await expect(
      assertCampaignPermissionForUser(qaUser, "campaign-1", "canManageAgents"),
    ).rejects.toThrow("No autorizado para esta accion en esta campana");
  });
});
