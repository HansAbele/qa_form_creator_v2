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

import { assignAgentsToTeam, createTeam, getTeams } from "./teams";

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

    await expect(
      createTeam({ name: "Support", campaignId: "campaign-1" }),
    ).rejects.toThrow("No autorizado para esta accion en esta campana");
    expect(prismaMock.team.create).not.toHaveBeenCalled();
  });

  it("keeps the detailed team reader admin-only", async () => {
    await expect(getTeams()).rejects.toThrow("No autorizado");
    expect(prismaMock.team.findMany).not.toHaveBeenCalled();
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

    await expect(
      assignAgentsToTeam("team-1", ["agent-1", "agent-2"]),
    ).rejects.toThrow("Agentes invalidos para este equipo");
    expect(prismaMock.agent.updateMany).not.toHaveBeenCalled();
  });
});
