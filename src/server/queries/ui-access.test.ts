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

import { getCurrentUserUiAccess } from "./ui-access";

describe("effective UI access", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    authMock.mockResolvedValue({
      user: {
        id: "qa-1",
        role: "QA",
        campaignIds: ["campaign-1", "campaign-2"],
      },
    });
    prismaMock.user.findFirst.mockResolvedValue({ id: "qa-1", role: "QA" });
  });

  it("does not combine export and report grants from different campaigns", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canExport: true, canViewReports: false },
      { campaignId: "campaign-2", canExport: false, canViewReports: true },
    ]);

    const access = await getCurrentUserUiAccess();

    expect(access.canViewReports).toBe(true);
    expect(access.canExport).toBe(false);
  });

  it("exposes export UI only when both grants coexist on a campaign", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canExport: true, canViewReports: true },
      { campaignId: "campaign-2", canExport: false, canViewReports: true },
    ]);

    const access = await getCurrentUserUiAccess();

    expect(access.canExport).toBe(true);
    expect(access.canOpenSettings).toBe(true);
  });

  it("keeps global administrators unrestricted", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", campaignIds: [] },
    });
    prismaMock.user.findFirst.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    const access = await getCurrentUserUiAccess();

    expect(access.isAdmin).toBe(true);
    expect(access.canViewReports).toBe(true);
    expect(access.canExport).toBe(true);
    expect(prismaMock.userCampaign.findMany).not.toHaveBeenCalled();
  });

  it("gives supervisors personal settings without granting administration", async () => {
    authMock.mockResolvedValue({
      user: { id: "supervisor-1", role: "SUPERVISOR", campaignIds: ["campaign-1"] },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: "supervisor-1",
      role: "SUPERVISOR",
      agentProfile: null,
    });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewReports: true, canViewEvaluations: true },
    ]);

    const access = await getCurrentUserUiAccess();

    expect(access.isSupervisor).toBe(true);
    expect(access.canOpenSettings).toBe(true);
    expect(access.isAdmin).toBe(false);
    expect(access.canViewReports).toBe(true);
  });

  it("keeps agent portal accounts out of QA settings", async () => {
    authMock.mockResolvedValue({
      user: { id: "agent-user-1", role: "AGENT", campaignIds: [] },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: "agent-user-1",
      role: "AGENT",
      agentProfile: { id: "agent-1", active: true },
    });

    const access = await getCurrentUserUiAccess();

    expect(access.isAgent).toBe(true);
    expect(access.canOpenSettings).toBe(false);
    expect(prismaMock.userCampaign.findMany).not.toHaveBeenCalled();
  });
});
