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

import {
  getCampaignKpis,
  getCriticalErrorAccuracy,
  getCriticalErrorAccuracyDetail,
  getDashboardCoachingInsights,
  getMyDashboard,
  getQACategoryMetrics,
  getReportData,
  getResponseDetail,
  getResponseTrends,
} from "./analytics";

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

  it("returns actionable insights and excludes campaigns with no evaluations", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewDashboard: true, canViewKPIs: true },
    ]);
    prismaMock.campaign.findMany.mockResolvedValue([
      {
        id: "campaign-1",
        name: "Retencion",
        forms: [{ id: "form-1" }],
        agents: [{ id: "agent-1" }],
        _count: { users: 2 },
      },
      {
        // No forms → 0 evaluations → must NOT be flagged in "Necesita atención".
        id: "campaign-2",
        name: "Sin datos",
        forms: [],
        agents: [],
        _count: { users: 0 },
      },
    ]);
    prismaMock.response.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prismaMock.response.aggregate.mockResolvedValue({ _avg: { score: 66 } });
    prismaMock.agent.findMany.mockResolvedValue([
      {
        id: "agent-1",
        name: "Ana",
        agentCode: "A-1",
        campaignId: "campaign-1",
        campaign: { name: "Retencion" },
        responses: [
          {
            score: 50,
            result: "FAIL",
            hasFatalFail: true,
            createdAt: new Date("2026-05-05T12:00:00Z"),
          },
          {
            score: 58,
            result: "FAIL",
            hasFatalFail: false,
            createdAt: new Date("2026-05-04T12:00:00Z"),
          },
          {
            score: 65,
            result: "FAIL",
            hasFatalFail: false,
            createdAt: new Date("2026-05-03T12:00:00Z"),
          },
        ],
      },
    ]);
    prismaMock.answer.findMany.mockResolvedValue([
      {
        score: 45,
        isFatalFail: true,
        category: {
          id: "cat-1",
          name: "Cumplimiento",
          systemColor: "#dc2626",
          visibleInDashboard: true,
        },
        response: {
          agentId: "agent-1",
          form: { campaignId: "campaign-1" },
        },
      },
    ]);

    const insights = await getDashboardCoachingInsights(undefined, "2026-05-01", "2026-05-05");

    expect(insights.summary.criticalCount).toBeGreaterThan(0);
    expect(insights.agentRisks).toEqual([
      expect.objectContaining({
        id: "agent-1",
        severity: "CRITICAL",
        fatalFailCount: 1,
      }),
    ]);
    expect(insights.categoryOpportunities).toEqual([
      expect.objectContaining({
        id: "cat-1",
        severity: "CRITICAL",
        affectedAgents: 1,
      }),
    ]);
    expect(insights.campaignRisks).toEqual([
      expect.objectContaining({
        id: "campaign-1",
        missedTargets: expect.arrayContaining(["score", "pass rate", "volumen diario"]),
      }),
    ]);
    // The empty campaign must not appear as a risk.
    expect(insights.campaignRisks.map((c) => c.id)).not.toContain("campaign-2");
  });

  it("does not expose program dashboard trends with only personal dashboard access", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewDashboard: true, canViewKPIs: false },
    ]);
    prismaMock.response.findMany.mockResolvedValue([]);

    await expect(getResponseTrends()).resolves.toEqual([]);

    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          form: { campaignId: { in: [] } },
        }),
      }),
    );
  });

  it("does not expose a draft response through report-only access", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canViewReports: true,
      canEditEvaluations: false,
    });
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-draft",
      evaluatorId: "qa-2",
      status: "DRAFT",
      form: {
        id: "form-1",
        title: "QA Form",
        campaignId: "campaign-1",
        status: "PUBLISHED",
        campaign: { active: true },
      },
      agent: { id: "agent-1", campaignId: "campaign-1" },
      disposition: null,
    });

    await expect(getResponseDetail("response-draft")).rejects.toThrow(
      "No autorizado para esta accion en esta campana",
    );
  });
});

describe("Critical Error Accuracy (CEA)", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getSettingsMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewKPIs: true, canViewDashboard: true },
    ]);
    getSettingsMock.mockResolvedValue({
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
    });
  });

  it("computes transaction-level accuracy per family and degrades to 'no configurado'", async () => {
    prismaMock.answer.findMany.mockResolvedValue([
      { responseId: "r1", isFatalFail: true, question: { criticalType: "CUSTOMER" } },
      { responseId: "r2", isFatalFail: false, question: { criticalType: "CUSTOMER" } },
      { responseId: "r3", isFatalFail: false, question: { criticalType: "BUSINESS" } },
    ]);

    const result = await getCriticalErrorAccuracy();

    const customer = result.find((r) => r.family === "CUSTOMER");
    expect(customer).toMatchObject({ applicable: 2, failedCount: 1, accuracy: 50, target: 95, status: "bajo benchmark" });

    const business = result.find((r) => r.family === "BUSINESS");
    expect(business).toMatchObject({ applicable: 1, accuracy: 100, target: 90, status: "en objetivo" });

    const compliance = result.find((r) => r.family === "COMPLIANCE");
    expect(compliance).toMatchObject({ configured: false, accuracy: null, status: "no configurado" });
  });

  it("breaks CEA down by campaign, agent and trend", async () => {
    const mkAnswer = (responseId: string, isFatalFail: boolean) => ({
      responseId,
      isFatalFail,
      question: { criticalType: "CUSTOMER" },
      response: {
        agentId: "a1",
        createdAt: new Date("2026-06-30T00:00:00Z"),
        agent: { name: "Agent 1", agentCode: "A1" },
        form: { campaignId: "campaign-1", campaign: { name: "Campaign 1" } },
      },
    });
    prismaMock.answer.findMany.mockResolvedValue([mkAnswer("r1", true), mkAnswer("r2", false)]);

    const detail = await getCriticalErrorAccuracyDetail();

    expect(detail.configured).toBe(true);
    expect(detail.overall.find((o) => o.family === "CUSTOMER")?.accuracy).toBe(50);
    expect(detail.byCampaign[0]).toMatchObject({ name: "Campaign 1", CUSTOMER: 50, BUSINESS: null });
    expect(detail.byAgent[0]).toMatchObject({ name: "Agent 1", CUSTOMER: 50, worst: 50 });
  });
});

describe("Evaluator self-scoped dashboard (getMyDashboard)", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getSettingsMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewDashboard: true },
    ]);
    getSettingsMock.mockResolvedValue({
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
    });
  });

  it("derives every personal dashboard metric from the current evaluator only", async () => {
    prismaMock.response.findMany.mockResolvedValue([
      {
        id: "m1",
        score: 80,
        result: "PASS",
        hasFatalFail: false,
        createdAt: new Date("2026-06-30T10:00:00Z"),
        agent: { id: "a1", name: "Agent 1", agentCode: "A1" },
        form: { title: "Form A", campaign: { name: "Campaign 1" } },
      },
      {
        id: "m2",
        score: 60,
        result: "FAIL",
        hasFatalFail: true,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        agent: { id: "a1", name: "Agent 1", agentCode: "A1" },
        form: { title: "Form A", campaign: { name: "Campaign 1" } },
      },
    ]);

    const data = await getMyDashboard();

    expect(data.evaluations).toBe(2);
    expect(data.avgScore).toBe(70);
    expect(data.fatalCount).toBe(1);
    expect(data.recentActivity[0]).toMatchObject({ id: "m1", result: "PASS" });
    expect(data.agentsBelowTarget).toHaveLength(1);
    expect(data.agentsBelowTarget[0]).toMatchObject({ id: "a1", avgScore: 70 });
    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ evaluatorId: "qa-1" }),
      }),
    );
    expect(prismaMock.response.aggregate).not.toHaveBeenCalled();
    expect(prismaMock.agent.findMany).not.toHaveBeenCalled();
  });
});
