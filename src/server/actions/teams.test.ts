import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, revalidatePathMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  revalidatePathMock: vi.fn(),
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
  revalidatePath: revalidatePathMock,
}));

import { assignAgentsToTeam, createTeam, getTeams, getTeamsForManagement } from "./teams";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

describe("team mutations RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    revalidatePathMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
  });

  it("rejects team creation when the QA lacks canManageAgents", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageAgents: false,
    });

    await expect(createTeam({ name: "Support", campaignId: "campaign-1" })).rejects.toThrow(
      "Unauthorized for this action in this campaign",
    );
    expect(prismaMock.team.create).not.toHaveBeenCalled();
  });

  it("keeps the detailed team reader admin-only", async () => {
    await expect(getTeams()).rejects.toThrow("Unauthorized");
    expect(prismaMock.team.findMany).not.toHaveBeenCalled();
  });

  it("counts only agents that belong to the team's campaign", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canManageAgents: true },
    ]);
    prismaMock.team.findMany.mockResolvedValue([
      {
        id: "team-1",
        name: "Support",
        campaignId: "campaign-1",
        campaign: { id: "campaign-1", name: "Campana 1" },
        agents: [
          { campaignId: "campaign-1" },
          { campaignId: "campaign-1" },
          { campaignId: "campaign-2" },
        ],
      },
    ]);

    await expect(getTeamsForManagement()).resolves.toEqual([
      expect.objectContaining({ id: "team-1", _count: { agents: 2 } }),
    ]);
  });

  it("rejects assigning agents from a different campaign", async () => {
    prismaMock.team.findUnique.mockResolvedValue({ campaignId: "campaign-1" });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageAgents: true,
    });
    prismaMock.agent.findMany.mockResolvedValue([
      { id: "agent-1", campaignId: "campaign-1" },
      { id: "agent-2", campaignId: "campaign-2" },
    ]);

    await expect(assignAgentsToTeam("team-1", ["agent-1", "agent-2"])).rejects.toThrow(
      "Invalid agents for this team",
    );
    expect(prismaMock.agent.updateMany).not.toHaveBeenCalled();
  });
});
