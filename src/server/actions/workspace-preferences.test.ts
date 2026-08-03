import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});

import { readMyWorkspacePreferences, updateMyWorkspacePreferences } from "./workspace-preferences";

describe("workspace preference actions", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    authMock.mockResolvedValue({
      user: { id: "qa-1", role: "QA", campaignIds: ["campaign-1"] },
    });
    prismaMock.user.findFirst.mockResolvedValue({
      id: "qa-1",
      role: "QA",
      workspacePreferences: null,
    });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        canViewDashboard: true,
        canViewEvaluations: true,
        campaign: { id: "campaign-1", name: "HAPUSA" },
      },
    ]);
  });

  it("automatically resolves a single assigned campaign", async () => {
    const result = await readMyWorkspacePreferences();

    expect(result.preferences.defaultCampaignId).toBe("campaign-1");
    expect(result.campaigns).toEqual([{ id: "campaign-1", name: "HAPUSA" }]);
  });

  it("rejects a default campaign outside the authenticated QA scope", async () => {
    await expect(
      updateMyWorkspacePreferences({
        defaultCampaignId: "campaign-2",
        defaultDateRange: "LAST_7_DAYS",
        defaultEvaluationScope: "MANAGED",
      }),
    ).rejects.toThrow("outside your assigned scope");

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("persists only personal preferences for an assigned campaign", async () => {
    prismaMock.user.update.mockResolvedValue({ id: "qa-1" });

    const result = await updateMyWorkspacePreferences({
      defaultCampaignId: null,
      defaultDateRange: "LAST_14_DAYS",
      defaultEvaluationScope: "OWN",
    });

    expect(result.preferences).toEqual({
      defaultCampaignId: "campaign-1",
      defaultDateRange: "LAST_14_DAYS",
      defaultEvaluationScope: "OWN",
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "qa-1" },
        data: { workspacePreferences: result.preferences },
      }),
    );
  });

  it("does not expose the QA settings module to agent portal accounts", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "agent-user-1",
      role: "AGENT",
      workspacePreferences: null,
    });

    await expect(readMyWorkspacePreferences()).rejects.toThrow(
      "Workspace settings are not available for agents",
    );
  });
});
