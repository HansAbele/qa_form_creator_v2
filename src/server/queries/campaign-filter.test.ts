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
  getCampaignFilterForPermissions,
  hasCampaignPermissionForUser,
} from "./campaign-filter";

const adminUser = {
  id: "admin-1",
  role: "ADMIN" as const,
  campaignIds: [],
};

const qaUser = {
  id: "qa-1",
  role: "QA" as const,
  campaignIds: ["campaign-1", "campaign-2"],
};

const supervisorUser = {
  id: "supervisor-1",
  role: "SUPERVISOR" as const,
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
    await expect(getCampaignFilterForPermissions(["canExport", "canViewReports"])).resolves.toEqual(
      {},
    );
    await expect(
      getCampaignFilterForPermissions(["canExport", "canViewReports"], "campaign-9"),
    ).resolves.toEqual({ campaignId: "campaign-9" });
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

  it("requires every requested permission on the same campaign", async () => {
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canExport: true, canViewReports: true },
      { campaignId: "campaign-2", canExport: true, canViewReports: false },
    ]);

    await expect(getCampaignFilterForPermissions(["canExport", "canViewReports"])).resolves.toEqual(
      {
        campaignId: { in: ["campaign-1"] },
      },
    );
  });

  it("rejects an explicit campaign when one required permission is missing", async () => {
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
      canViewReports: false,
    });

    await expect(
      getCampaignFilterForPermissions(["canExport", "canViewReports"], "campaign-1"),
    ).rejects.toThrow("No autorizado para esta accion en esta campana");
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

  it("resolves an effective permission for one assigned campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageDispositions: true,
    });

    await expect(
      hasCampaignPermissionForUser(qaUser, "campaign-1", "canManageDispositions"),
    ).resolves.toBe(true);
    await expect(
      hasCampaignPermissionForUser(qaUser, "campaign-3", "canManageDispositions"),
    ).resolves.toBe(false);
    expect(prismaMock.userCampaign.findUnique).toHaveBeenCalledTimes(1);
  });

  it("keeps Supervisor scoped to assigned campaigns for read permissions", async () => {
    authMock.mockResolvedValue({ user: supervisorUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewReports: true },
      { campaignId: "campaign-2", canViewReports: true },
    ]);

    await expect(getCampaignFilterForPermission("canViewReports")).resolves.toEqual({
      campaignId: { in: ["campaign-1", "campaign-2"] },
    });
  });

  it("blocks Supervisor write permissions even when legacy rows contain writes", async () => {
    authMock.mockResolvedValue({ user: supervisorUser });

    await expect(getCampaignFilterForPermission("canEvaluate")).resolves.toEqual({
      campaignId: { in: [] },
    });
    await expect(
      assertCampaignPermissionForUser(supervisorUser, "campaign-1", "canEvaluate"),
    ).rejects.toThrow("No autorizado para esta accion en esta campana");
    await expect(
      hasCampaignPermissionForUser(supervisorUser, "campaign-1", "canManageDispositions"),
    ).resolves.toBe(false);
    expect(prismaMock.userCampaign.findUnique).not.toHaveBeenCalled();
  });
});
