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

import {
  createAgent,
  deleteAgent,
  getAgents,
  getAgentsForEvaluation,
  getAgentsForManagement,
  updateAgent,
} from "./agents";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

describe("agent mutations RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    revalidatePathMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
  });

  it("rejects create when the QA lacks canManageAgents", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageAgents: false,
    });

    await expect(createAgent({ name: "Ana", campaignId: "campaign-1" })).rejects.toThrow(
      "No autorizado para esta accion en esta campana",
    );
    expect(prismaMock.agent.create).not.toHaveBeenCalled();
  });

  it("keeps the detailed agent reader admin-only", async () => {
    await expect(getAgents()).rejects.toThrow("No autorizado");
    expect(prismaMock.agent.findMany).not.toHaveBeenCalled();
  });

  it("returns a minimal active selector for authorized evaluators", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEvaluate: true,
    });
    prismaMock.agent.findMany.mockResolvedValue([]);

    await getAgentsForEvaluation("campaign-1");

    expect(prismaMock.agent.findMany).toHaveBeenCalledWith({
      where: { campaignId: "campaign-1", active: true, campaign: { active: true } },
      select: { id: true, name: true, agentCode: true },
      orderBy: { name: "asc" },
    });
  });

  it("hides foreign team metadata and counts only campaign-consistent responses", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canManageAgents: true },
    ]);
    prismaMock.agent.findMany.mockResolvedValue([
      {
        id: "agent-valid",
        name: "Ana",
        campaignId: "campaign-1",
        campaign: { id: "campaign-1", name: "Campana 1" },
        team: { id: "team-1", name: "Equipo 1", campaignId: "campaign-1" },
      },
      {
        id: "agent-corrupt",
        name: "Beto",
        campaignId: "campaign-1",
        campaign: { id: "campaign-1", name: "Campana 1" },
        team: { id: "team-2", name: "Equipo ajeno", campaignId: "campaign-2" },
      },
    ]);
    prismaMock.response.groupBy.mockResolvedValue([
      { agentId: "agent-valid", _count: { _all: 2 } },
      { agentId: "agent-corrupt", _count: { _all: 1 } },
    ]);

    const result = await getAgentsForManagement();

    expect(result).toEqual([
      expect.objectContaining({
        id: "agent-valid",
        team: { id: "team-1", name: "Equipo 1" },
        _count: { responses: 2 },
      }),
      expect.objectContaining({
        id: "agent-corrupt",
        team: null,
        _count: { responses: 1 },
      }),
    ]);
    expect(prismaMock.response.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              AND: [
                { form: { campaignId: "campaign-1" } },
                { agent: { campaignId: "campaign-1" } },
                {
                  OR: [{ dispositionId: null }, { disposition: { campaignId: "campaign-1" } }],
                },
              ],
            },
          ],
        }),
      }),
    );
  });

  it("rejects create when the selected team belongs to another campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageAgents: true,
    });
    prismaMock.team.findUnique.mockResolvedValue({ campaignId: "campaign-2" });

    await expect(
      createAgent({
        name: "Ana",
        campaignId: "campaign-1",
        teamId: "team-2",
      }),
    ).rejects.toThrow("Equipo invalido para esta campana");
    expect(prismaMock.agent.create).not.toHaveBeenCalled();
  });

  it("creates an agent inside the authorized campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageAgents: true,
    });
    prismaMock.agent.create.mockResolvedValue({
      id: "agent-1",
      name: "Ana",
      campaignId: "campaign-1",
    });

    await expect(
      createAgent({
        name: " Ana ",
        agentCode: " A-1 ",
        campaignId: "campaign-1",
      }),
    ).resolves.toMatchObject({ id: "agent-1" });

    expect(prismaMock.agent.create).toHaveBeenCalledWith({
      data: {
        name: "Ana",
        agentCode: "A-1",
        campaignId: "campaign-1",
        teamId: null,
      },
    });
  });

  it("uses the existing agent campaign before updates and soft deletes", async () => {
    prismaMock.agent.findUnique.mockResolvedValue({ campaignId: "campaign-1" });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageAgents: true,
    });
    prismaMock.agent.update.mockResolvedValue({ id: "agent-1" });

    await updateAgent("agent-1", { name: "Ana", active: true });
    await deleteAgent("agent-1");

    expect(prismaMock.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent-1" },
        data: expect.objectContaining({ active: false }),
      }),
    );
  });
});
