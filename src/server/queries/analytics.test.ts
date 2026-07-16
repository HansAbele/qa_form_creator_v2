import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const {
  authMock,
  getCampaignScoringSettingsMock,
  getPassThresholdForCampaignMock,
  getSettingsMock,
} = vi.hoisted(() => ({
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
  getAgentDetail,
  getAgentPerformance,
  getCampaignKpis,
  getCriticalErrorAccuracy,
  getCriticalErrorAccuracyDetail,
  getDashboardCoachingInsights,
  getDashboardStats,
  getDispositionAnalytics,
  getDispositionDetail,
  getFilteredResponses,
  getMyDashboard,
  getQACategoryMetrics,
  getReportData,
  getResponseDetail,
  getResponseTrends,
  getScoreByQuestion,
  getTeamDetail,
  getTeamPerformance,
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
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: "qa-1",
      campaignId: "campaign-1",
      canViewKPIs: true,
    });
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
        question: { formId: "form-1" },
        response: {
          id: "response-1",
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
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
        question: { formId: "form-1" },
        response: {
          id: "response-2",
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
        },
      },
      {
        score: 0,
        isFatalFail: true,
        comment: "Relacion importada invalida",
        categoryId: "cat-resolution",
        category: {
          id: "cat-resolution",
          name: "Resolucion",
          systemColor: "#ff6600",
          systemIcon: "target",
          visibleInKPIs: true,
        },
        question: { formId: "foreign-form" },
        response: {
          id: "response-corrupt",
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "foreign-campaign" },
          disposition: null,
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
        question: { formId: "form-1" },
        response: {
          id: "response-1",
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
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
        question: { formId: "form-1" },
        response: {
          id: "response-1",
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
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

  it("ignores score answers linked to a question from another form", async () => {
    prismaMock.answer.findMany.mockResolvedValue([
      {
        score: 90,
        question: { label: "Saludo", formId: "form-1" },
        response: {
          formId: "form-1",
          form: { campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
        },
      },
      {
        score: 10,
        question: { label: "Pregunta ajena", formId: "form-2" },
        response: {
          formId: "form-1",
          form: { campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
        },
      },
      {
        score: 5,
        question: { label: "Agente ajeno", formId: "form-1" },
        response: {
          formId: "form-1",
          form: { campaignId: "campaign-1" },
          agent: { campaignId: "campaign-2" },
          disposition: null,
        },
      },
    ]);

    await expect(getScoreByQuestion("campaign-1")).resolves.toEqual([
      { question: "Saludo", avgScore: 90, totalAnswers: 1 },
    ]);
    expect(prismaMock.answer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          question: expect.objectContaining({ form: { campaignId: "campaign-1" } }),
        }),
      }),
    );
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
    expect(prismaMock.response.count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          hasFatalFail: false,
          OR: [
            { result: "PASS" },
            {
              OR: [{ result: null }, { result: { notIn: ["PASS", "FAIL"] } }],
              score: { gte: 75 },
            },
          ],
          AND: [
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

  it("uses each campaign threshold for a multi-campaign dashboard pass rate", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-low", canViewKPIs: true },
      { campaignId: "campaign-high", canViewKPIs: true },
    ]);
    getCampaignScoringSettingsMock.mockImplementation(async (campaignId: string) => ({
      campaignId,
      usesGlobalDefaults: false,
      passThreshold: campaignId === "campaign-high" ? 85 : 75,
      targetPassRate: 90,
      targetAvgScore: 85,
      targetDailyRate: 12,
      fatalFailuresAllowed: 1,
    }));
    getPassThresholdForCampaignMock.mockImplementation(async (campaignId?: string) =>
      campaignId === "campaign-high" ? 85 : 75,
    );
    prismaMock.form.count.mockResolvedValue(2);
    prismaMock.response.count.mockImplementation(async (args) => {
      const where = args?.where as { hasFatalFail?: boolean };
      if (where.hasFatalFail === true) return 0;
      const serialized = JSON.stringify(where);
      if (serialized.includes('"gte":75') && serialized.includes('"gte":85')) return 1;
      return 2;
    });
    prismaMock.response.aggregate.mockResolvedValue({ _avg: { score: 80 } });
    prismaMock.response.findMany.mockResolvedValue([]);

    await expect(getDashboardStats()).resolves.toEqual(
      expect.objectContaining({ responseCount: 2, passCount: 1, failCount: 1, passRate: 50 }),
    );
    const serializedCountCalls = prismaMock.response.count.mock.calls.map(([args]) =>
      JSON.stringify(args?.where),
    );
    const passCall = serializedCountCalls.find(
      (call) => call.includes('"gte":75') && call.includes('"gte":85'),
    );
    expect(passCall).toContain('"agent":{"campaignId":"campaign-low"}');
    expect(passCall).toContain('"agent":{"campaignId":"campaign-high"}');
    expect(passCall).toContain('"disposition":{"campaignId":"campaign-low"}');
    expect(passCall).toContain('"disposition":{"campaignId":"campaign-high"}');
    const recentWhere = JSON.stringify(prismaMock.response.findMany.mock.calls[0]?.[0]?.where);
    expect(recentWhere).toContain('"agent":{"campaignId":"campaign-low"}');
    expect(recentWhere).toContain('"agent":{"campaignId":"campaign-high"}');
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
          id: "form-1",
          title: "QA Retencion",
          campaignId: "campaign-1",
          campaign: { name: "Retencion" },
        },
        agent: { name: "Ana", agentCode: "A-1", campaignId: "campaign-1" },
        evaluator: { name: "Luis" },
        answers: [
          {
            score: 100,
            value: "Si",
            comment: null,
            isFatalFail: false,
            notApplicable: false,
            question: {
              formId: "form-1",
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

  it("drops report rows with cross-campaign or cross-form relations", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: "qa-1",
      campaignId: "campaign-1",
      canViewReports: true,
    });
    const base = {
      id: "response-valid",
      formVersion: "1.0.0",
      score: 90,
      result: "PASS",
      hasFatalFail: false,
      createdAt: new Date("2026-05-03T12:00:00Z"),
      form: {
        id: "form-1",
        title: "QA Retencion",
        campaignId: "campaign-1",
        campaign: { name: "Retencion" },
      },
      agent: { name: "Ana", agentCode: "A-1", campaignId: "campaign-1" },
      evaluator: { name: "Luis" },
      disposition: null,
      answers: [
        {
          score: 100,
          value: "Si",
          comment: null,
          isFatalFail: false,
          notApplicable: false,
          question: {
            formId: "form-1",
            label: "Saludo",
            type: "RADIO",
            weight: 10,
            fatal: false,
            criticalType: null,
            requiresCommentOnFail: false,
          },
          category: null,
        },
      ],
    };
    prismaMock.response.findMany.mockResolvedValue([
      base,
      {
        ...base,
        id: "response-foreign-agent",
        agent: { ...base.agent, name: "Agente ajeno", campaignId: "campaign-2" },
      },
      {
        ...base,
        id: "response-foreign-disposition",
        disposition: {
          name: "Disposicion ajena",
          outcomeType: null,
          campaignId: "campaign-2",
        },
      },
      {
        ...base,
        id: "response-foreign-question",
        answers: [
          {
            ...base.answers[0],
            question: { ...base.answers[0].question, formId: "form-2", label: "Pregunta ajena" },
          },
        ],
      },
    ]);

    const result = await getReportData({ campaignId: "campaign-1" });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ id: "response-valid" }));
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
            form: { campaignId: "campaign-1" },
            disposition: null,
          },
          {
            score: 58,
            result: "FAIL",
            hasFatalFail: false,
            createdAt: new Date("2026-05-04T12:00:00Z"),
            form: { campaignId: "campaign-1" },
            disposition: null,
          },
          {
            score: 65,
            result: "FAIL",
            hasFatalFail: false,
            createdAt: new Date("2026-05-03T12:00:00Z"),
            form: { campaignId: "campaign-1" },
            disposition: null,
          },
          {
            score: 100,
            result: "PASS",
            hasFatalFail: false,
            createdAt: new Date("2026-05-06T12:00:00Z"),
            form: { campaignId: "foreign-campaign" },
            disposition: null,
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
        question: { formId: "form-1" },
        response: {
          agentId: "agent-1",
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
        },
      },
      {
        score: 100,
        isFatalFail: false,
        category: {
          id: "cat-foreign",
          name: "Categoria ajena",
          systemColor: "#10b981",
          visibleInDashboard: true,
        },
        question: { formId: "foreign-form" },
        response: {
          agentId: "foreign-agent",
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "foreign-campaign" },
          disposition: null,
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
    expect(insights.categoryOpportunities).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "cat-foreign" })]),
    );
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
      answers: [],
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
    getPassThresholdForCampaignMock.mockReset();
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
    getPassThresholdForCampaignMock.mockResolvedValue(70);
  });

  it("computes transaction-level accuracy per family and degrades to 'no configurado'", async () => {
    prismaMock.answer.findMany.mockResolvedValue([
      {
        responseId: "r1",
        isFatalFail: true,
        question: { criticalType: "CUSTOMER", formId: "form-1" },
        response: {
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
        },
      },
      {
        responseId: "r2",
        isFatalFail: false,
        question: { criticalType: "CUSTOMER", formId: "form-1" },
        response: {
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
        },
      },
      {
        responseId: "r3",
        isFatalFail: false,
        question: { criticalType: "BUSINESS", formId: "form-1" },
        response: {
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "campaign-1" },
          disposition: null,
        },
      },
      {
        responseId: "corrupt",
        isFatalFail: true,
        question: { criticalType: "COMPLIANCE", formId: "foreign-form" },
        response: {
          form: { id: "form-1", campaignId: "campaign-1" },
          agent: { campaignId: "foreign-campaign" },
          disposition: null,
        },
      },
    ]);

    const result = await getCriticalErrorAccuracy();

    const customer = result.find((r) => r.family === "CUSTOMER");
    expect(customer).toMatchObject({
      applicable: 2,
      failedCount: 1,
      accuracy: 50,
      target: 95,
      status: "bajo benchmark",
    });

    const business = result.find((r) => r.family === "BUSINESS");
    expect(business).toMatchObject({
      applicable: 1,
      accuracy: 100,
      target: 90,
      status: "en objetivo",
    });

    const compliance = result.find((r) => r.family === "COMPLIANCE");
    expect(compliance).toMatchObject({
      configured: false,
      accuracy: null,
      status: "no configurado",
    });
  });

  it("breaks CEA down by campaign, agent and trend", async () => {
    const mkAnswer = (responseId: string, isFatalFail: boolean) => ({
      responseId,
      isFatalFail,
      question: { criticalType: "CUSTOMER", formId: "form-1" },
      response: {
        agentId: "a1",
        createdAt: new Date("2026-06-30T00:00:00Z"),
        agent: { name: "Agent 1", agentCode: "A1", campaignId: "campaign-1" },
        disposition: null,
        form: {
          id: "form-1",
          campaignId: "campaign-1",
          campaign: { name: "Campaign 1" },
        },
      },
    });
    prismaMock.answer.findMany.mockResolvedValue([
      mkAnswer("r1", true),
      mkAnswer("r2", false),
      {
        ...mkAnswer("foreign", true),
        question: { criticalType: "CUSTOMER", formId: "foreign-form" },
        response: {
          ...mkAnswer("foreign", true).response,
          agentId: "foreign-agent",
          agent: {
            name: "Foreign Agent",
            agentCode: "X1",
            campaignId: "foreign-campaign",
          },
        },
      },
    ]);

    const detail = await getCriticalErrorAccuracyDetail();

    expect(detail.configured).toBe(true);
    expect(detail.overall.find((o) => o.family === "CUSTOMER")?.accuracy).toBe(50);
    expect(detail.byCampaign[0]).toMatchObject({
      name: "Campaign 1",
      CUSTOMER: 50,
      BUSINESS: null,
    });
    expect(detail.byAgent[0]).toMatchObject({ name: "Agent 1", CUSTOMER: 50, worst: 50 });
    expect(detail.byAgent).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Foreign Agent" })]),
    );
  });
});

describe("Evaluator self-scoped dashboard (getMyDashboard)", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getCampaignScoringSettingsMock.mockReset();
    getPassThresholdForCampaignMock.mockReset();
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
    getPassThresholdForCampaignMock.mockResolvedValue(70);
    getCampaignScoringSettingsMock.mockResolvedValue({
      campaignId: "campaign-1",
      usesGlobalDefaults: false,
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
      fatalFailuresAllowed: 0,
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
        agent: {
          id: "a1",
          name: "Agent 1",
          agentCode: "A1",
          campaignId: "campaign-1",
        },
        form: {
          title: "Form A",
          campaignId: "campaign-1",
          campaign: { name: "Campaign 1" },
        },
      },
      {
        id: "m2",
        score: 60,
        result: "FAIL",
        hasFatalFail: true,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        agent: {
          id: "a1",
          name: "Agent 1",
          agentCode: "A1",
          campaignId: "campaign-1",
        },
        form: {
          title: "Form A",
          campaignId: "campaign-1",
          campaign: { name: "Campaign 1" },
        },
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

  it("classifies legacy personal results with each campaign threshold", async () => {
    getPassThresholdForCampaignMock.mockImplementation(async (campaignId?: string) =>
      campaignId === "campaign-high" ? 85 : 75,
    );
    getCampaignScoringSettingsMock.mockImplementation(async (campaignId: string) => ({
      campaignId,
      usesGlobalDefaults: false,
      passThreshold: campaignId === "campaign-high" ? 85 : 75,
      targetPassRate: 85,
      targetAvgScore: campaignId === "campaign-high" ? 90 : 75,
      targetDailyRate: 20,
      fatalFailuresAllowed: 0,
    }));
    prismaMock.response.findMany.mockResolvedValue([
      {
        id: "low-pass",
        score: 80,
        result: null,
        hasFatalFail: false,
        createdAt: new Date("2026-06-30T10:00:00Z"),
        agent: {
          id: "agent-low",
          name: "Agent Low",
          agentCode: "L1",
          campaignId: "campaign-low",
        },
        form: {
          title: "Low Form",
          campaignId: "campaign-low",
          campaign: { name: "Low" },
        },
      },
      {
        id: "high-fail",
        score: 80,
        result: null,
        hasFatalFail: false,
        createdAt: new Date("2026-06-29T10:00:00Z"),
        agent: {
          id: "agent-high",
          name: "Agent High",
          agentCode: "H1",
          campaignId: "campaign-high",
        },
        form: {
          title: "High Form",
          campaignId: "campaign-high",
          campaign: { name: "High" },
        },
      },
    ]);

    const result = await getMyDashboard();

    expect(result.recentActivity).toEqual([
      expect.objectContaining({ id: "low-pass", result: "PASS" }),
      expect.objectContaining({ id: "high-fail", result: "FAIL" }),
    ]);
    expect(result.agentsBelowTarget).toEqual([
      expect.objectContaining({ id: "agent-high", campaignId: "campaign-high" }),
    ]);
  });
});

describe("PASS/FAIL accuracy across analytics surfaces", () => {
  const adminUser = {
    id: "admin-1",
    role: "ADMIN",
    campaignIds: [],
  };

  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getCampaignScoringSettingsMock.mockReset();
    getPassThresholdForCampaignMock.mockReset();
    getSettingsMock.mockReset();
    authMock.mockResolvedValue({ user: adminUser });
    getPassThresholdForCampaignMock.mockImplementation(async (campaignId?: string) =>
      campaignId === "campaign-high" ? 85 : 75,
    );
  });

  it("uses each campaign threshold and rejects explicit or fatal failures in agent performance", async () => {
    prismaMock.agent.findMany.mockResolvedValue([
      {
        id: "agent-low",
        name: "Ana",
        agentCode: "A-1",
        campaignId: "campaign-low",
        campaign: { name: "Umbral 75" },
        responses: [
          {
            score: 80,
            result: null,
            hasFatalFail: false,
            createdAt: new Date("2026-07-03T12:00:00Z"),
            form: { campaignId: "campaign-low" },
            disposition: null,
          },
          {
            score: 99,
            result: "FAIL",
            hasFatalFail: false,
            createdAt: new Date("2026-07-02T12:00:00Z"),
            form: { campaignId: "campaign-low" },
            disposition: null,
          },
          {
            score: 99,
            result: "PASS",
            hasFatalFail: true,
            createdAt: new Date("2026-07-01T12:00:00Z"),
            form: { campaignId: "campaign-low" },
            disposition: null,
          },
        ],
      },
      {
        id: "agent-high",
        name: "Beto",
        agentCode: "B-1",
        campaignId: "campaign-high",
        campaign: { name: "Umbral 85" },
        responses: [
          {
            score: 80,
            result: null,
            hasFatalFail: false,
            createdAt: new Date("2026-07-03T12:00:00Z"),
            form: { campaignId: "campaign-high" },
            disposition: null,
          },
        ],
      },
    ]);

    const result = await getAgentPerformance();

    expect(result).toEqual([
      expect.objectContaining({ id: "agent-low", passRate: 33 }),
      expect.objectContaining({ id: "agent-high", passRate: 0 }),
    ]);
    expect(getPassThresholdForCampaignMock).toHaveBeenNthCalledWith(1, "campaign-low");
    expect(getPassThresholdForCampaignMock).toHaveBeenNthCalledWith(2, "campaign-high");
    expect(prismaMock.agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          responses: expect.objectContaining({
            select: expect.objectContaining({ result: true, hasFatalFail: true }),
          }),
        }),
      }),
    );
  });

  it("rejects high-score explicit and fatal failures in team performance", async () => {
    prismaMock.team.findMany.mockResolvedValue([
      {
        id: "team-1",
        name: "Equipo Uno",
        campaignId: "campaign-low",
        agents: [
          {
            id: "agent-1",
            campaignId: "campaign-low",
            responses: [
              {
                score: 99,
                result: "FAIL",
                hasFatalFail: false,
                form: { campaignId: "campaign-low" },
                disposition: null,
              },
              {
                score: 99,
                result: null,
                hasFatalFail: true,
                form: { campaignId: "campaign-low" },
                disposition: null,
              },
            ],
          },
        ],
      },
    ]);

    await expect(getTeamPerformance()).resolves.toEqual([
      expect.objectContaining({ id: "team-1", avgScore: 99, passRate: 0 }),
    ]);
    expect(prismaMock.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          agents: expect.objectContaining({
            include: expect.objectContaining({
              responses: expect.objectContaining({
                select: expect.objectContaining({ result: true, hasFatalFail: true }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("rejects high-score explicit and fatal failures in disposition analytics", async () => {
    prismaMock.disposition.findMany.mockResolvedValue([
      {
        id: "disposition-1",
        name: "Escalado",
        code: "ESC",
        campaignId: "campaign-low",
        category: { name: "Escalamientos", campaignId: "campaign-low" },
        responses: [
          {
            score: 98,
            result: "FAIL",
            hasFatalFail: false,
            form: { campaignId: "campaign-low" },
            agent: { campaignId: "campaign-low" },
          },
          {
            score: 98,
            result: null,
            hasFatalFail: true,
            form: { campaignId: "campaign-low" },
            agent: { campaignId: "campaign-low" },
          },
        ],
      },
    ]);

    await expect(getDispositionAnalytics()).resolves.toEqual([
      expect.objectContaining({ id: "disposition-1", avgScore: 98, passRate: 0 }),
    ]);
    expect(prismaMock.disposition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          responses: expect.objectContaining({
            select: expect.objectContaining({ result: true, hasFatalFail: true }),
          }),
        }),
      }),
    );
  });

  it("rejects high-score explicit and fatal failures in team detail", async () => {
    prismaMock.team.findUnique.mockResolvedValue({
      id: "team-1",
      name: "Equipo Uno",
      campaignId: "campaign-low",
      campaign: { name: "Campana Uno" },
      agents: [
        {
          id: "agent-1",
          name: "Ana",
          agentCode: "A-1",
          campaignId: "campaign-low",
          responses: [
            {
              score: 97,
              result: "FAIL",
              hasFatalFail: false,
              createdAt: new Date("2026-07-02T12:00:00Z"),
              form: { campaignId: "campaign-low" },
              disposition: null,
            },
            {
              score: 97,
              result: null,
              hasFatalFail: true,
              createdAt: new Date("2026-07-01T12:00:00Z"),
              form: { campaignId: "campaign-low" },
              disposition: null,
            },
            {
              score: 100,
              result: "PASS",
              hasFatalFail: false,
              createdAt: new Date("2026-07-03T12:00:00Z"),
              form: { campaignId: "campaign-high" },
              disposition: null,
            },
            {
              score: 100,
              result: "PASS",
              hasFatalFail: false,
              createdAt: new Date("2026-07-04T12:00:00Z"),
              form: { campaignId: "campaign-low" },
              disposition: { campaignId: "campaign-high" },
            },
          ],
        },
        {
          id: "agent-foreign",
          name: "Fuera de campana",
          agentCode: "F-1",
          campaignId: "campaign-high",
          responses: [
            {
              score: 100,
              result: "PASS",
              hasFatalFail: false,
              createdAt: new Date("2026-07-03T12:00:00Z"),
              form: { campaignId: "campaign-low" },
              disposition: null,
            },
          ],
        },
      ],
    });

    const result = await getTeamDetail("team-1");

    expect(result.agentRanking).toEqual([
      expect.objectContaining({ id: "agent-1", avgScore: 97, passRate: 0 }),
    ]);
    expect(result).toEqual(expect.objectContaining({ agentCount: 1, totalEvaluations: 2 }));
    expect(prismaMock.team.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          agents: expect.objectContaining({
            include: expect.objectContaining({
              responses: expect.objectContaining({
                select: expect.objectContaining({ result: true, hasFatalFail: true }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("rejects high-score explicit and fatal failures in disposition detail", async () => {
    prismaMock.disposition.findUnique.mockResolvedValue({
      id: "disposition-1",
      name: "Escalado",
      code: "ESC",
      active: true,
      campaignId: "campaign-low",
      categoryId: "category-foreign",
      category: { name: "Categoria ajena", campaignId: "campaign-high" },
      campaign: { id: "campaign-low", name: "Campana Uno" },
    });
    prismaMock.response.findMany.mockResolvedValue([
      {
        id: "response-1",
        score: 96,
        result: "FAIL",
        hasFatalFail: false,
        createdAt: new Date("2026-07-02T12:00:00Z"),
        agent: { id: "agent-1", name: "Ana" },
        evaluator: { id: "evaluator-1", name: "Eva" },
        form: { title: "Formulario Uno" },
        answers: [],
      },
      {
        id: "response-2",
        score: 96,
        result: null,
        hasFatalFail: true,
        createdAt: new Date("2026-07-01T12:00:00Z"),
        agent: { id: "agent-1", name: "Ana" },
        evaluator: { id: "evaluator-1", name: "Eva" },
        form: { title: "Formulario Uno" },
        answers: [],
      },
    ]);
    prismaMock.response.aggregate.mockResolvedValue({
      _avg: { score: 96 },
      _count: { _all: 2 },
    });

    const result = await getDispositionDetail("disposition-1");

    expect(result).toEqual(
      expect.objectContaining({
        id: "disposition-1",
        avgScore: 96,
        passThreshold: 75,
        passRate: 0,
        categoryName: null,
        recentResponses: [
          expect.objectContaining({ id: "response-1", result: "FAIL" }),
          expect.objectContaining({ id: "response-2", result: "FAIL" }),
        ],
      }),
    );
    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dispositionId: "disposition-1",
          form: { campaignId: "campaign-low" },
          agent: { campaignId: "campaign-low" },
        }),
        select: expect.objectContaining({ result: true, hasFatalFail: true }),
      }),
    );
  });

  it("filters corrupt cross-campaign relations from agent detail", async () => {
    const baseResponse = {
      score: 88,
      result: "PASS",
      hasFatalFail: false,
      createdAt: new Date("2026-07-02T12:00:00Z"),
      evaluator: { id: "evaluator-1", name: "Eva" },
      answers: [],
    };
    prismaMock.agent.findUnique.mockResolvedValue({
      id: "agent-1",
      name: "Ana",
      agentCode: "A-1",
      campaignId: "campaign-low",
      campaign: { name: "Campana Uno" },
      team: { name: "Equipo ajeno", campaignId: "campaign-high" },
      responses: [
        {
          ...baseResponse,
          id: "response-valid",
          form: { title: "Formulario Uno", campaignId: "campaign-low" },
          disposition: null,
        },
        {
          ...baseResponse,
          id: "response-foreign-form",
          form: { title: "Formulario Ajeno", campaignId: "campaign-high" },
          disposition: null,
        },
        {
          ...baseResponse,
          id: "response-foreign-disposition",
          form: { title: "Formulario Uno", campaignId: "campaign-low" },
          disposition: {
            id: "disposition-foreign",
            name: "Ajena",
            campaignId: "campaign-high",
          },
        },
      ],
    });

    const result = await getAgentDetail("agent-1");

    expect(result).toEqual(
      expect.objectContaining({
        totalEvaluations: 1,
        avgScore: 88,
        passThreshold: 75,
        teamName: null,
        recentResponses: [expect.objectContaining({ id: "response-valid", result: "PASS" })],
      }),
    );
  });

  it("returns the effective failed result for a historical fatal response", async () => {
    const createdAt = new Date("2026-07-01T12:00:00Z");
    const updatedAt = new Date("2026-07-02T12:00:00Z");
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-fatal",
      evaluatorId: "evaluator-1",
      status: "SUBMITTED",
      score: 99,
      result: "PASS",
      hasFatalFail: true,
      createdAt,
      updatedAt,
      submittedAt: updatedAt,
      cancelledAt: null,
      cancellationReason: null,
      scoringSnapshot: null,
      settingsSnapshot: null,
      formSnapshot: null,
      form: {
        id: "form-1",
        title: "QA Form",
        campaignId: "campaign-low",
        status: "PUBLISHED",
        campaign: { active: true },
      },
      agent: {
        id: "agent-1",
        name: "Ana",
        agentCode: "A-1",
        campaignId: "campaign-low",
        campaign: { name: "Campana Uno" },
      },
      evaluator: { id: "evaluator-1", name: "Eva", email: "eva@example.com" },
      disposition: null,
      answers: [],
    });

    const result = await getResponseDetail("response-fatal");

    expect(result).toEqual(
      expect.objectContaining({
        id: "response-fatal",
        score: 99,
        result: "FAIL",
        hasFatalFail: true,
        updatedAt: updatedAt.toISOString(),
      }),
    );
    expect(getPassThresholdForCampaignMock).toHaveBeenCalledWith("campaign-low");
  });

  it("does not expose response detail with an answer from another form", async () => {
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-corrupt",
      status: "SUBMITTED",
      form: {
        id: "form-1",
        campaignId: "campaign-low",
        status: "PUBLISHED",
        campaign: { active: true },
      },
      agent: { id: "agent-1", campaignId: "campaign-low" },
      disposition: null,
      answers: [
        {
          id: "answer-foreign",
          question: { id: "question-foreign", formId: "form-2", label: "Dato ajeno" },
        },
      ],
    });

    await expect(getResponseDetail("response-corrupt")).rejects.toThrow(
      "La evaluación contiene relaciones de otra campaña",
    );
  });
});

describe("Filtered responses effective PASS/FAIL", () => {
  const reportUser = {
    id: "qa-report",
    role: "QA",
    campaignIds: ["campaign-low", "campaign-high"],
  };

  function responseRow(args: {
    id: string;
    campaignId: string;
    score: number;
    result: string | null;
    hasFatalFail: boolean;
  }) {
    return {
      ...args,
      createdAt: new Date("2026-07-10T12:00:00Z"),
      agent: {
        id: `agent-${args.campaignId}`,
        name: `Agente ${args.campaignId}`,
        campaign: { name: `Campana ${args.campaignId}` },
      },
      evaluator: { id: "evaluator-1", name: "Eva" },
      form: {
        id: `form-${args.campaignId}`,
        title: `Formulario ${args.campaignId}`,
        campaignId: args.campaignId,
      },
      disposition: null,
    };
  }

  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getPassThresholdForCampaignMock.mockReset();
    authMock.mockResolvedValue({ user: reportUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-low", canViewReports: true },
      { campaignId: "campaign-high", canViewReports: true },
    ]);
    getPassThresholdForCampaignMock.mockImplementation(async (campaignId?: string) =>
      campaignId === "campaign-high" ? 75 : 70,
    );
    prismaMock.response.count.mockResolvedValue(3);
  });

  it("resolves results with each campaign threshold and makes fatal PASS data fail", async () => {
    prismaMock.response.findMany.mockResolvedValue([
      responseRow({
        id: "low-72",
        campaignId: "campaign-low",
        score: 72,
        result: null,
        hasFatalFail: false,
      }),
      responseRow({
        id: "high-72",
        campaignId: "campaign-high",
        score: 72,
        result: null,
        hasFatalFail: false,
      }),
      responseRow({
        id: "fatal-99",
        campaignId: "campaign-low",
        score: 99,
        result: "PASS",
        hasFatalFail: true,
      }),
    ]);

    const result = await getFilteredResponses({});

    expect(result.responses).toEqual([
      expect.objectContaining({ id: "low-72", result: "PASS", passThreshold: 70 }),
      expect.objectContaining({ id: "high-72", result: "FAIL", passThreshold: 75 }),
      expect.objectContaining({
        id: "fatal-99",
        result: "FAIL",
        hasFatalFail: true,
        campaignId: "campaign-low",
      }),
    ]);
    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          form: { campaignId: { in: ["campaign-low", "campaign-high"] } },
          status: "SUBMITTED",
          OR: expect.arrayContaining([
            {
              AND: [
                { form: { campaignId: "campaign-low" } },
                { agent: { campaignId: "campaign-low" } },
                {
                  OR: [{ dispositionId: null }, { disposition: { campaignId: "campaign-low" } }],
                },
              ],
            },
          ]),
        }),
      }),
    );
  });

  it("accepts a case-insensitive FAIL filter without replacing the custom score range", async () => {
    prismaMock.response.findMany.mockResolvedValue([
      responseRow({
        id: "fatal-99",
        campaignId: "campaign-low",
        score: 99,
        result: "PASS",
        hasFatalFail: true,
      }),
    ]);
    prismaMock.response.count.mockResolvedValue(1);

    const result = await getFilteredResponses({
      resultStatus: "fAiL",
      minScore: 90,
      maxScore: 100,
    });

    expect(result.responses[0]).toEqual(
      expect.objectContaining({ id: "fatal-99", score: 99, result: "FAIL" }),
    );
    const findManyArgs = prismaMock.response.findMany.mock.calls[0]?.[0];
    expect(findManyArgs.where).toEqual(
      expect.objectContaining({
        score: { gte: 90, lte: 100 },
        OR: expect.arrayContaining([
          {
            AND: expect.arrayContaining([
              { form: { campaignId: "campaign-low" } },
              { agent: { campaignId: "campaign-low" } },
              {
                OR: [
                  { hasFatalFail: true },
                  { result: "FAIL" },
                  {
                    hasFatalFail: false,
                    OR: [{ result: null }, { result: { notIn: ["PASS", "FAIL"] } }],
                    score: { lt: 70 },
                  },
                ],
              },
            ]),
          },
        ]),
      }),
    );
    expect(prismaMock.response.count).toHaveBeenCalledWith({ where: findManyArgs.where });
  });

  it("ignores unsupported result status values instead of widening Prisma input", async () => {
    prismaMock.response.findMany.mockResolvedValue([]);
    prismaMock.response.count.mockResolvedValue(0);

    await getFilteredResponses({ resultStatus: "FAIL; DROP TABLE Response" });

    const findManyArgs = prismaMock.response.findMany.mock.calls[0]?.[0];
    expect(findManyArgs.where.OR).toEqual(
      expect.arrayContaining([
        {
          AND: [
            { form: { campaignId: "campaign-low" } },
            { agent: { campaignId: "campaign-low" } },
            {
              OR: [{ dispositionId: null }, { disposition: { campaignId: "campaign-low" } }],
            },
          ],
        },
      ]),
    );
  });
});
