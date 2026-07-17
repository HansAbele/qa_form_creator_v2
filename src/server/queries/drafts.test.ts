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

import { getAccessibleEvaluationDrafts } from "./drafts";

const adminUser = {
  id: "admin-1",
  role: "ADMIN" as const,
  campaignIds: [],
};

const qaUser = {
  id: "qa-1",
  role: "QA" as const,
  campaignIds: ["campaign-evaluate", "campaign-correct", "campaign-both"],
};

const supervisorUser = {
  id: "supervisor-1",
  role: "SUPERVISOR" as const,
  campaignIds: ["campaign-1"],
};

function createDraft(evaluatorId: string, agentCampaignId = "campaign-1") {
  return {
    id: `draft-${evaluatorId}`,
    formId: "form-1",
    evaluatorId,
    updatedAt: new Date("2026-07-16T15:00:00.000Z"),
    form: {
      title: "Quality Review",
      campaignId: "campaign-1",
      campaign: { name: "Retention" },
    },
    agent: { name: "Agent One", agentCode: "A-001", campaignId: agentCampaignId },
    evaluator: { name: evaluatorId === "qa-1" ? "QA One" : "QA Two" },
  };
}

describe("evaluation draft discovery RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
  });

  it("requires authentication before querying drafts", async () => {
    authMock.mockResolvedValue(null);

    await expect(getAccessibleEvaluationDrafts()).rejects.toThrow("No autorizado");
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("returns every draft to an admin and labels ownership", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    prismaMock.response.findMany.mockResolvedValue([createDraft("admin-1"), createDraft("qa-2")]);

    const drafts = await getAccessibleEvaluationDrafts();

    expect(prismaMock.userCampaign.findMany).not.toHaveBeenCalled();
    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "DRAFT",
          form: { status: "PUBLISHED", campaign: { active: true } },
          agent: { active: true },
        },
        select: {
          id: true,
          formId: true,
          evaluatorId: true,
          updatedAt: true,
          form: {
            select: {
              title: true,
              campaignId: true,
              campaign: { select: { name: true } },
            },
          },
          agent: { select: { name: true, agentCode: true, campaignId: true } },
          evaluator: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
    );
    expect(drafts.map((draft) => draft.isOwn)).toEqual([true, false]);
    expect(drafts[0]).not.toHaveProperty("evaluatorId");
  });

  it("separates a QA's own evaluation campaigns from foreign correction campaigns", async () => {
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-evaluate",
        canEvaluate: true,
        canEditEvaluations: false,
      },
      {
        campaignId: "campaign-correct",
        canEvaluate: false,
        canEditEvaluations: true,
      },
      {
        campaignId: "campaign-both",
        canEvaluate: true,
        canEditEvaluations: true,
      },
    ]);
    prismaMock.response.findMany.mockResolvedValue([createDraft("qa-1"), createDraft("qa-2")]);

    const drafts = await getAccessibleEvaluationDrafts();

    expect(prismaMock.userCampaign.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.userCampaign.findMany).toHaveBeenCalledWith({
      where: {
        userId: "qa-1",
        campaignId: {
          in: ["campaign-evaluate", "campaign-correct", "campaign-both"],
        },
      },
      select: {
        campaignId: true,
        canEvaluate: true,
        canEditEvaluations: true,
      },
    });
    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "DRAFT",
          form: { status: "PUBLISHED", campaign: { active: true } },
          agent: { active: true },
          OR: [
            {
              evaluatorId: "qa-1",
              form: {
                campaignId: { in: ["campaign-evaluate", "campaign-both"] },
              },
            },
            {
              evaluatorId: { not: "qa-1" },
              form: {
                campaignId: { in: ["campaign-correct", "campaign-both"] },
              },
            },
          ],
        },
      }),
    );
    expect(drafts.map((draft) => draft.isOwn)).toEqual([true, false]);
  });

  it("does not query drafts when the user has no applicable mutation permission", async () => {
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([]);

    await expect(getAccessibleEvaluationDrafts()).resolves.toEqual([]);
    expect(prismaMock.userCampaign.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("keeps Supervisor out of evaluation drafts even with assigned campaigns", async () => {
    authMock.mockResolvedValue({ user: supervisorUser });

    await expect(getAccessibleEvaluationDrafts()).resolves.toEqual([]);
    expect(prismaMock.userCampaign.findMany).not.toHaveBeenCalled();
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("does not expose agent metadata from a campaign inconsistent with the form", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    prismaMock.response.findMany.mockResolvedValue([
      createDraft("admin-1"),
      createDraft("qa-2", "campaign-other"),
    ]);

    const drafts = await getAccessibleEvaluationDrafts();

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.id).toBe("draft-admin-1");
  });
});
