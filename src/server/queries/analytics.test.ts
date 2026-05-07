import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, getPassThresholdForCampaignMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getPassThresholdForCampaignMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/settings", () => ({
  getPassThresholdForCampaign: getPassThresholdForCampaignMock,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  const mockedPrisma = (module as { prismaMock: unknown }).prismaMock;
  return { prisma: mockedPrisma };
});

import { getQACategoryMetrics } from "./analytics";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

describe("QA category analytics", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getPassThresholdForCampaignMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewKPIs: true },
      { campaignId: "campaign-2", canViewKPIs: false },
    ]);
    getPassThresholdForCampaignMock.mockResolvedValue(70);
  });

  it("scopes QA category metrics to campaigns with KPI permission", async () => {
    prismaMock.answer.findMany.mockResolvedValue([
      {
        score: 100,
        isFatalFail: false,
        comment: null,
        categoryId: "cat-resolution",
        category: {
          id: "cat-resolution",
          name: "Resolucion",
          systemColor: "#ff6600",
          systemIcon: "target",
          visibleInKPIs: true,
        },
        response: {
          id: "response-1",
          form: { campaignId: "campaign-1" },
        },
      },
      {
        score: 50,
        isFatalFail: true,
        comment: "Falla fatal",
        categoryId: "cat-compliance",
        category: {
          id: "cat-compliance",
          name: "Cumplimiento",
          systemColor: "#dc2626",
          systemIcon: "shield",
          visibleInKPIs: true,
        },
        response: {
          id: "response-2",
          form: { campaignId: "campaign-1" },
        },
      },
    ]);

    await expect(getQACategoryMetrics(undefined, "2026-05-01", "2026-05-05")).resolves.toEqual([
      expect.objectContaining({
        id: "cat-compliance",
        avgScore: 50,
        failedAnswers: 1,
        fatalFailCount: 1,
      }),
      expect.objectContaining({
        id: "cat-resolution",
        avgScore: 100,
        failedAnswers: 0,
        fatalFailCount: 0,
      }),
    ]);

    expect(prismaMock.answer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categoryId: { not: null },
          response: expect.objectContaining({
            form: { campaignId: { in: ["campaign-1"] } },
          }),
        }),
      }),
    );
  });

  it("omits categories hidden from KPI dashboards", async () => {
    prismaMock.answer.findMany.mockResolvedValue([
      {
        score: 40,
        isFatalFail: false,
        comment: null,
        categoryId: "cat-hidden",
        category: {
          id: "cat-hidden",
          name: "Oculta",
          systemColor: null,
          systemIcon: null,
          visibleInKPIs: false,
        },
        response: {
          id: "response-1",
          form: { campaignId: "campaign-1" },
        },
      },
    ]);

    await expect(getQACategoryMetrics()).resolves.toEqual([]);
  });

  it("counts fatal option answers even when they do not have numeric score", async () => {
    prismaMock.answer.findMany.mockResolvedValue([
      {
        score: null,
        isFatalFail: true,
        comment: "Opcion fatal",
        categoryId: "cat-critical",
        category: {
          id: "cat-critical",
          name: "Critica",
          systemColor: "#dc2626",
          systemIcon: "shield",
          visibleInKPIs: true,
        },
        response: {
          id: "response-1",
          form: { campaignId: "campaign-1" },
        },
      },
    ]);

    await expect(getQACategoryMetrics()).resolves.toEqual([
      expect.objectContaining({
        id: "cat-critical",
        avgScore: 0,
        failedAnswers: 1,
        fatalFailCount: 1,
        commentCount: 1,
      }),
    ]);
  });
});
