import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, getCampaignScoringSettingsMock, getPassThresholdForCampaignMock, getSettingsMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getCampaignScoringSettingsMock: vi.fn(),
  getPassThresholdForCampaignMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/settings", () => ({
  getCampaignScoringSettings: getCampaignScoringSettingsMock,
  getPassThresholdForCampaign: getPassThresholdForCampaignMock,
  getSettings: getSettingsMock,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  const mockedPrisma = (module as { prismaMock: unknown }).prismaMock;
  return { prisma: mockedPrisma };
});

import { getCampaignKpis, getQACategoryMetrics, getReportData } from "./analytics";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

describe("QA category analytics", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getCampaignScoringSettingsMock.mockReset();
    getPassThresholdForCampaignMock.mockReset();
    getSettingsMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewKPIs: true },
      { campaignId: "campaign-2", canViewKPIs: false },
    ]);
    getPassThresholdForCampaignMock.mockResolvedValue(70);
    getCampaignScoringSettingsMock.mockResolvedValue({
      campaignId: "campaign-1",
      usesGlobalDefaults: false,
      passThreshold: 75,
      targetPassRate: 90,
      targetAvgScore: 85,
      targetDailyRate: 12,
      fatalFailuresAllowed: 1,
    });
    getSettingsMock.mockResolvedValue({
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
    });
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

  it("returns campaign KPI targets and fatal failures from effective campaign settings", async () => {
    prismaMock.campaign.findMany.mockResolvedValue([
      {
        id: "campaign-1",
        name: "Retencion",
        forms: [{ id: "form-1" }, { id: "form-2" }],
        agents: [{ id: "agent-1" }],
        _count: { users: 2 },
      },
    ]);
    prismaMock.response.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);
    prismaMock.response.aggregate.mockResolvedValue({ _avg: { score: 86.4 } });

    await expect(getCampaignKpis(undefined, "2026-05-01", "2026-05-05")).resolves.toEqual([
      expect.objectContaining({
        id: "campaign-1",
        totalEvaluations: 5,
        avgScore: 86.4,
        passRate: 80,
        dailyRate: 1,
        fatalFailCount: 2,
        passThreshold: 75,
        targetPassRate: 90,
        targetAvgScore: 85,
        targetDailyRate: 12,
        fatalFailuresAllowed: 1,
      }),
    ]);
  });

  it("returns report rows with pass status and target deltas from campaign targets", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: "qa-1",
      campaignId: "campaign-1",
      canViewReports: true,
    });
    prismaMock.response.findMany.mockResolvedValue([
      {
        id: "response-1",
        score: 74,
        result: null,
        hasFatalFail: false,
        createdAt: new Date("2026-05-03T12:00:00Z"),
        form: {
          title: "QA Retencion",
          campaignId: "campaign-1",
          campaign: { name: "Retencion" },
        },
        agent: { name: "Ana", agentCode: "A-1" },
        evaluator: { name: "Luis" },
        answers: [
          {
            score: 100,
            value: "Si",
            comment: null,
            isFatalFail: false,
            notApplicable: false,
            question: {
              label: "Saludo",
              type: "RADIO",
              weight: 10,
              fatal: false,
              requiresCommentOnFail: false,
            },
            category: null,
          },
        ],
      },
    ]);

    await expect(getReportData({ campaignId: "campaign-1" })).resolves.toEqual([
      expect.objectContaining({
        id: "response-1",
        campaignId: "campaign-1",
        campaignName: "Retencion",
        passThreshold: 75,
        targetPassRate: 90,
        targetAvgScore: 85,
        targetDailyRate: 12,
        fatalFailuresAllowed: 1,
        passesThreshold: false,
        scoreTargetDelta: -11,
      }),
    ]);
  });
});
