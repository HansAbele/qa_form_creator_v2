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

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import * as campaignActions from "./campaigns";

describe("fixed-purpose campaign readers", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    authMock.mockResolvedValue({
      user: { id: "qa-1", role: "QA", campaignIds: ["campaign-1"] },
    });
    prismaMock.campaign.findMany.mockResolvedValue([]);
  });

  it("does not export a client-selectable permission helper", () => {
    expect(campaignActions).not.toHaveProperty("getCampaignsForPermission");
    expect(campaignActions).not.toHaveProperty("getCampaignsForPermissions");
    expect(campaignActions).not.toHaveProperty("getCampaignById");
  });

  it("reserves the detailed campaign reader for global administrators", async () => {
    await expect(campaignActions.getCampaigns()).rejects.toThrow("Unauthorized");
    expect(prismaMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("binds dashboard campaign reads to canViewDashboard", async () => {
    await campaignActions.getDashboardCampaigns();

    expect(prismaMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          users: {
            some: { userId: "qa-1", canViewDashboard: true },
          },
        },
      }),
    );
  });

  it("lists export campaigns only when reports and export are both allowed", async () => {
    await campaignActions.getExportCampaigns();

    expect(prismaMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          users: {
            some: {
              userId: "qa-1",
              canExport: true,
              canViewReports: true,
            },
          },
        },
      }),
    );
  });

  it("keeps supervisors blocked from export campaign reads", async () => {
    authMock.mockResolvedValue({
      user: { id: "supervisor-1", role: "SUPERVISOR", campaignIds: ["campaign-1"] },
    });

    await expect(campaignActions.getExportCampaigns()).resolves.toEqual([]);
    expect(prismaMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("keeps global administrators unrestricted", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", campaignIds: [] },
    });

    await campaignActions.getReportCampaigns();

    expect(prismaMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        select: { id: true, name: true },
      }),
    );
  });

  it("deactivates campaigns without deleting their operational history", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", campaignIds: [] },
    });
    const before = { id: "campaign-1", name: "Campaign 1", active: true };
    prismaMock.campaign.findUnique.mockResolvedValue(before);
    prismaMock.campaign.update.mockResolvedValue({ ...before, active: false });

    await campaignActions.deactivateCampaign("campaign-1");

    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "campaign-1" },
      data: { active: false },
    });
    expect(prismaMock.form.count).not.toHaveBeenCalled();
  });
});
