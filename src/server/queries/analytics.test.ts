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
  getCampaignScoringSettingsMap: async (campaignIds: string[]) => {
    const entries = await Promise.all(
      campaignIds.map(async (campaignId) => {
        const configured = await getCampaignScoringSettingsMock(campaignId);
        if (configured) return [campaignId, configured] as const;

        return [
          campaignId,
          {
            campaignId,
            usesGlobalDefaults: true,
            passThreshold: (await getPassThresholdForCampaignMock(campaignId)) ?? 70,
            targetPassRate: 85,
            targetAvgScore: 80,
            targetDailyRate: 20,
            fatalFailuresAllowed: 0,
          },
        ] as const;
      }),
    );
    return new Map(entries);
  },
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
  getEvaluationHistory,
  getEvaluationHistoryFilterOptions,
  getEvaluatorDetail,
  getFilteredResponses,
  getMyDashboard,
  getQACategoryMetrics,
  getReportData,
  getReportResponseDetail,
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
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: "cat-resolution",
        name: "Resolucion",
        color: "#ff6600",
        icon: "target",
        totalAnswers: BigInt(1),
        totalEvaluations: BigInt(1),
        avgScore: "100",
        failedAnswers: BigInt(0),
        fatalFailCount: BigInt(0),
        commentCount: BigInt(0),
      },
      {
        id: "cat-compliance",
        name: "Cumplimiento",
        color: "#dc2626",
        icon: "shield",
        totalAnswers: BigInt(1),
        totalEvaluations: BigInt(1),
        avgScore: "50",
        failedAnswers: BigInt(1),
        fatalFailCount: BigInt(1),
        commentCount: BigInt(1),
      },
    ]);
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

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.answer.findMany).not.toHaveBeenCalled();
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
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: "cat-critical",
        name: "Critica",
        color: "#dc2626",
        icon: "shield",
        totalAnswers: BigInt(1),
        totalEvaluations: BigInt(1),
        avgScore: "0",
        failedAnswers: BigInt(1),
        fatalFailCount: BigInt(1),
        commentCount: BigInt(1),
      },
    ]);
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
    prismaMock.$queryRaw.mockResolvedValue([
      { question: "Saludo", avgScore: "90", totalAnswers: BigInt(1) },
    ]);
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
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.answer.findMany).not.toHaveBeenCalled();
  });

  it("returns campaign KPI targets and fatal failures from effective campaign settings", async () => {
    prismaMock.campaign.findMany.mockResolvedValue([
      {
        id: "campaign-1",
        name: "Retencion",
        _count: { forms: 2, agents: 1, users: 2 },
      },
    ]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        campaignId: "campaign-1",
        totalEvaluations: BigInt(5),
        avgScore: "86.4",
        passCount: BigInt(4),
        fatalFailCount: BigInt(2),
        minCreatedAt: new Date("2026-05-01T12:00:00Z"),
        maxCreatedAt: new Date("2026-05-05T12:00:00Z"),
      },
    ]);

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
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.response.count).not.toHaveBeenCalled();
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
    expect(passCall).toContain('"team":{"campaignId":"campaign-low"}');
    expect(passCall).toContain('"team":{"campaignId":"campaign-high"}');
    expect(passCall).toContain('"category":{"campaignId":"campaign-low"}');
    expect(passCall).toContain('"category":{"campaignId":"campaign-high"}');
    const recentWhere = JSON.stringify(prismaMock.response.findMany.mock.calls[0]?.[0]?.where);
    expect(recentWhere).toContain('"team":{"campaignId":"campaign-low"}');
    expect(recentWhere).toContain('"team":{"campaignId":"campaign-high"}');
    expect(recentWhere).toContain('"category":{"campaignId":"campaign-low"}');
    expect(recentWhere).toContain('"category":{"campaignId":"campaign-high"}');
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
        submittedAt: new Date("2026-05-03T12:00:00Z"),
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
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "response-1" }]).mockResolvedValueOnce([
      {
        campaignId: "campaign-1",
        totalEvaluations: BigInt(1),
        avgScore: "74",
        passCount: BigInt(0),
        fatalFailCount: BigInt(0),
        minCreatedAt: new Date("2026-05-03T12:00:00Z"),
        maxCreatedAt: new Date("2026-05-03T12:00:00Z"),
      },
    ]);

    await expect(getReportData({ campaignId: "campaign-1" })).resolves.toEqual(
      expect.objectContaining({
        items: [
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
            submittedAt: "2026-05-03T12:00:00.000Z",
          }),
        ],
        page: 1,
        pageSize: 50,
        totalCount: 1,
        totalPages: 1,
        summary: expect.objectContaining({
          totalEvaluations: 1,
          avgScore: 74,
          passRate: 0,
        }),
      }),
    );
  });

  it("hydrates only IDs returned by the integrity-scoped report page query", async () => {
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
      submittedAt: new Date("2026-05-03T12:00:00Z"),
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
    prismaMock.response.findMany.mockResolvedValue([base]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: "response-valid" }]).mockResolvedValueOnce([
      {
        campaignId: "campaign-1",
        totalEvaluations: BigInt(1),
        avgScore: "90",
        passCount: BigInt(1),
        fatalFailCount: BigInt(0),
        minCreatedAt: base.submittedAt,
        maxCreatedAt: base.submittedAt,
      },
    ]);

    const result = await getReportData({ campaignId: "campaign-1" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ id: "response-valid" }));
    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["response-valid"] },
          form: { campaignId: "campaign-1" },
          status: "SUBMITTED",
          submittedAt: { not: null },
          OR: [
            expect.objectContaining({
              AND: expect.arrayContaining([
                {
                  agent: {
                    campaignId: "campaign-1",
                    OR: [{ teamId: null }, { team: { campaignId: "campaign-1" } }],
                  },
                },
                {
                  OR: [
                    { dispositionId: null },
                    {
                      disposition: {
                        campaignId: "campaign-1",
                        OR: [{ categoryId: null }, { category: { campaignId: "campaign-1" } }],
                      },
                    },
                  ],
                },
              ]),
            }),
          ],
        }),
      }),
    );
  });

  it("does not select or expose evaluator email to a non-admin KPI reader", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "qa-2",
      name: "Eva",
      role: "QA",
    });
    prismaMock.response.findMany.mockResolvedValue([]);
    prismaMock.response.aggregate.mockResolvedValue({ _avg: { score: null } });

    const result = await getEvaluatorDetail("qa-2");

    expect(result).toEqual(expect.objectContaining({ name: "Eva", email: null, role: "QA" }));
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, name: true, role: true },
      }),
    );
  });

  it("returns actionable insights and excludes campaigns with no evaluations", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewDashboard: true, canViewKPIs: true },
    ]);
    prismaMock.campaign.findMany.mockResolvedValue([
      {
        id: "campaign-1",
        name: "Retencion",
        _count: { forms: 1, agents: 1, users: 2 },
      },
      {
        // No forms → 0 evaluations → must NOT be flagged in "Necesita atención".
        id: "campaign-2",
        name: "Sin datos",
        _count: { forms: 0, agents: 0, users: 0 },
      },
    ]);
    prismaMock.$queryRaw.mockImplementation(async (query) => {
      const sql = (query as { strings?: readonly string[] }).strings?.join(" ") ?? "";
      if (sql.includes("ranked AS")) {
        return [
          {
            id: "agent-1",
            name: "Ana",
            agentCode: "A-1",
            campaignId: "campaign-1",
            campaignName: "Retencion",
            totalEvaluations: BigInt(3),
            avgScore: "57.6666667",
            passCount: BigInt(0),
            fatalFailCount: BigInt(1),
            recentAvg: "57.6666667",
            previousAvg: null,
          },
        ];
      }
      if (sql.includes('qc."visibleInDashboard"')) {
        return [
          {
            id: "cat-1",
            name: "Cumplimiento",
            color: "#dc2626",
            campaignId: "campaign-1",
            totalScore: "45",
            scoredCount: BigInt(1),
            totalAnswers: BigInt(1),
            fatalFailCount: BigInt(1),
            affectedAgents: BigInt(1),
          },
        ];
      }
      return [
        {
          campaignId: "campaign-1",
          totalEvaluations: BigInt(4),
          avgScore: "66",
          passCount: BigInt(1),
          fatalFailCount: BigInt(1),
          minCreatedAt: new Date("2026-05-01T12:00:00Z"),
          maxCreatedAt: new Date("2026-05-05T12:00:00Z"),
        },
      ];
    });
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
            submittedAt: new Date("2026-05-05T12:00:00Z"),
            form: { campaignId: "campaign-1" },
            disposition: null,
          },
          {
            score: 58,
            result: "FAIL",
            hasFatalFail: false,
            submittedAt: new Date("2026-05-04T12:00:00Z"),
            form: { campaignId: "campaign-1" },
            disposition: null,
          },
          {
            score: 65,
            result: "FAIL",
            hasFatalFail: false,
            submittedAt: new Date("2026-05-03T12:00:00Z"),
            form: { campaignId: "campaign-1" },
            disposition: null,
          },
          {
            score: 100,
            result: "PASS",
            hasFatalFail: false,
            submittedAt: new Date("2026-05-06T12:00:00Z"),
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
        missedTargets: expect.arrayContaining(["score", "pass rate", "daily volume"]),
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

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("does not expose a draft response through report-only access", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewReports: true,
        canEditEvaluations: false,
      },
    ]);
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

    await expect(getResponseDetail("response-draft")).rejects.toThrow("Evaluation unavailable");
    expect(prismaMock.response.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.response.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              status: "DRAFT",
              form: { campaignId: { in: [] } },
            },
            {
              status: "SUBMITTED",
              form: { campaignId: { in: ["campaign-1"] } },
            },
            {
              status: "SUBMITTED",
              evaluatorId: qaUser.id,
              form: { campaignId: { in: [] } },
            },
            {
              status: "CANCELLED",
              form: { campaignId: { in: [] } },
            },
          ]),
        }),
        select: {
          id: true,
          formId: true,
          status: true,
          form: { select: { campaignId: true } },
        },
      }),
    );
    expect(prismaMock.response.findUnique).not.toHaveBeenCalled();
  });

  it("allows a peer submission inside a campaign with evaluation access", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewEvaluations: true,
        canViewKPIs: false,
        canViewReports: false,
        canEditEvaluations: false,
      },
      {
        campaignId: "campaign-2",
        canViewEvaluations: false,
        canViewKPIs: true,
        canViewReports: false,
        canEditEvaluations: false,
      },
    ]);
    const timestamp = new Date("2026-07-10T12:00:00Z");
    prismaMock.response.findFirst
      .mockResolvedValueOnce({
        id: "response-peer",
        formId: "form-1",
        status: "SUBMITTED",
        form: { campaignId: "campaign-1" },
      })
      .mockResolvedValueOnce({
        id: "response-peer",
        status: "SUBMITTED",
        score: 90,
        result: "PASS",
        hasFatalFail: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        submittedAt: timestamp,
        cancelledAt: null,
        cancellationReason: null,
        scoringSnapshot: null,
        settingsSnapshot: null,
        formSnapshot: null,
        form: {
          id: "form-1",
          title: "QA Form",
          campaignId: "campaign-1",
          status: "PUBLISHED",
          campaign: { active: true },
        },
        agent: {
          id: "agent-1",
          name: "Ana",
          agentCode: "A-1",
          campaignId: "campaign-1",
          campaign: { name: "Campana Uno" },
        },
        evaluator: { id: "qa-peer", name: "QA Peer" },
        disposition: null,
        answers: [],
      });

    await expect(getResponseDetail("response-peer")).resolves.toEqual(
      expect.objectContaining({
        id: "response-peer",
        evaluator: { id: "qa-peer", name: "QA Peer" },
        canEdit: false,
        canOpenAnalytics: false,
      }),
    );
    expect(prismaMock.response.findFirst.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                {
                  status: "SUBMITTED",
                  form: { campaignId: { in: ["campaign-1"] } },
                },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("denies a peer submission outside campaigns with evaluation access", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewEvaluations: true,
        canViewReports: false,
        canEditEvaluations: false,
      },
    ]);
    prismaMock.response.findFirst.mockResolvedValueOnce(null);

    await expect(getResponseDetail("response-peer-campaign-2")).rejects.toThrow(
      "Evaluation unavailable",
    );
    const authorizationWhere = prismaMock.response.findFirst.mock.calls[0]?.[0].where;
    expect(authorizationWhere).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          {
            status: "SUBMITTED",
            form: { campaignId: { in: ["campaign-1"] } },
          },
        ]),
      }),
    );
    expect(JSON.stringify(authorizationWhere.OR)).not.toContain("campaign-2");
  });

  it("allows an evaluator to load their own submitted response without report access", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewDashboard: true,
        canViewReports: false,
        canEditEvaluations: false,
      },
    ]);
    const timestamp = new Date("2026-07-10T12:00:00Z");
    prismaMock.response.findFirst
      .mockResolvedValueOnce({
        id: "response-own",
        formId: "form-1",
        status: "SUBMITTED",
        form: { campaignId: "campaign-1" },
      })
      .mockResolvedValueOnce({
        id: "response-own",
        status: "SUBMITTED",
        score: 90,
        result: "PASS",
        hasFatalFail: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        submittedAt: timestamp,
        cancelledAt: null,
        cancellationReason: null,
        scoringSnapshot: null,
        settingsSnapshot: null,
        formSnapshot: null,
        form: {
          id: "form-1",
          title: "QA Form",
          campaignId: "campaign-1",
          status: "PUBLISHED",
          campaign: { active: true },
        },
        agent: {
          id: "agent-1",
          name: "Ana",
          agentCode: "A-1",
          campaignId: "campaign-1",
          campaign: { name: "Campana Uno" },
        },
        evaluator: { id: qaUser.id, name: "QA Uno" },
        disposition: null,
        answers: [],
      });

    await expect(getResponseDetail("response-own")).resolves.toEqual(
      expect.objectContaining({ id: "response-own", status: "SUBMITTED", canEdit: false }),
    );
    expect(prismaMock.response.findFirst.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                {
                  status: "SUBMITTED",
                  evaluatorId: qaUser.id,
                  form: { campaignId: { in: ["campaign-1"] } },
                },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("allows a submitted response through report scope without granting edit access", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewReports: true,
        canEditEvaluations: false,
      },
    ]);
    const createdAt = new Date("2026-07-10T12:00:00Z");
    prismaMock.response.findFirst
      .mockResolvedValueOnce({
        id: "response-submitted",
        formId: "form-1",
        status: "SUBMITTED",
        form: { campaignId: "campaign-1" },
      })
      .mockResolvedValueOnce({
        id: "response-submitted",
        status: "SUBMITTED",
        score: 90,
        result: "PASS",
        hasFatalFail: false,
        createdAt,
        updatedAt: createdAt,
        submittedAt: createdAt,
        cancelledAt: null,
        cancellationReason: null,
        scoringSnapshot: null,
        settingsSnapshot: null,
        formSnapshot: null,
        form: {
          id: "form-1",
          title: "QA Form",
          campaignId: "campaign-1",
          status: "PUBLISHED",
          campaign: { active: true },
        },
        agent: {
          id: "agent-1",
          name: "Ana",
          agentCode: "A-1",
          campaignId: "campaign-1",
          campaign: { name: "Campana Uno" },
        },
        evaluator: { id: "qa-2", name: "Eva", email: "eva@example.com" },
        disposition: null,
        answers: [],
      });

    await expect(getResponseDetail("response-submitted")).resolves.toEqual(
      expect.objectContaining({ id: "response-submitted", canEdit: false }),
    );
    expect(prismaMock.response.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.response.findFirst.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                {
                  status: "SUBMITTED",
                  form: { campaignId: { in: ["campaign-1"] } },
                },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("allows a cancelled response only through audit scope", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewAudit: true,
        canViewReports: false,
        canEditEvaluations: false,
      },
    ]);
    const createdAt = new Date("2026-07-10T12:00:00Z");
    const cancelledAt = new Date("2026-07-11T12:00:00Z");
    prismaMock.response.findFirst
      .mockResolvedValueOnce({
        id: "response-cancelled",
        formId: "form-1",
        status: "CANCELLED",
        form: { campaignId: "campaign-1" },
      })
      .mockResolvedValueOnce({
        id: "response-cancelled",
        status: "CANCELLED",
        score: 40,
        result: "FAIL",
        hasFatalFail: false,
        createdAt,
        updatedAt: cancelledAt,
        submittedAt: createdAt,
        cancelledAt,
        cancellationReason: "Duplicada",
        scoringSnapshot: null,
        settingsSnapshot: null,
        formSnapshot: null,
        form: {
          id: "form-1",
          title: "QA Form",
          campaignId: "campaign-1",
          status: "ARCHIVED",
          campaign: { active: true },
        },
        agent: {
          id: "agent-1",
          name: "Ana",
          agentCode: "A-1",
          campaignId: "campaign-1",
          campaign: { name: "Campana Uno" },
        },
        evaluator: { id: "qa-2", name: "Eva" },
        disposition: null,
        answers: [],
      });

    await expect(getResponseDetail("response-cancelled")).resolves.toEqual(
      expect.objectContaining({
        id: "response-cancelled",
        status: "CANCELLED",
        canEdit: false,
        cancellationReason: "Duplicada",
      }),
    );
    expect(prismaMock.response.findFirst.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                {
                  status: "CANCELLED",
                  form: { campaignId: { in: ["campaign-1"] } },
                },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("rejects a report detail whose agent team belongs to another campaign", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewReports: true },
    ]);
    prismaMock.response.findFirst.mockResolvedValue({
      id: "response-corrupt-team",
      form: { id: "form-1", campaignId: "campaign-1" },
      agent: {
        name: "Agente ajeno",
        agentCode: "X-1",
        campaignId: "campaign-1",
        teamId: "team-foreign",
        team: { campaignId: "campaign-2" },
      },
      disposition: null,
      answers: [],
    });

    await expect(getReportResponseDetail("response-corrupt-team")).rejects.toThrow(
      "Evaluation unavailable",
    );
    expect(prismaMock.response.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          agent: {
            select: expect.objectContaining({
              teamId: true,
              team: { select: { campaignId: true } },
            }),
          },
        }),
      }),
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
    prismaMock.$queryRaw.mockResolvedValue([
      {
        scopeType: "OVERALL",
        scopeId: null,
        scopeName: null,
        agentCode: null,
        date: null,
        family: "CUSTOMER",
        applicable: BigInt(2),
        failedCount: BigInt(1),
      },
      {
        scopeType: "OVERALL",
        scopeId: null,
        scopeName: null,
        agentCode: null,
        date: null,
        family: "BUSINESS",
        applicable: BigInt(1),
        failedCount: BigInt(0),
      },
    ]);
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
        submittedAt: new Date("2026-06-30T00:00:00Z"),
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
    prismaMock.$queryRaw.mockResolvedValue([
      {
        scopeType: "OVERALL",
        scopeId: null,
        scopeName: null,
        agentCode: null,
        date: null,
        family: "CUSTOMER",
        applicable: BigInt(2),
        failedCount: BigInt(1),
      },
      {
        scopeType: "CAMPAIGN",
        scopeId: "campaign-1",
        scopeName: "Campaign 1",
        agentCode: null,
        date: null,
        family: "CUSTOMER",
        applicable: BigInt(2),
        failedCount: BigInt(1),
      },
      {
        scopeType: "AGENT",
        scopeId: "a1",
        scopeName: "Agent 1",
        agentCode: "A1",
        date: null,
        family: "CUSTOMER",
        applicable: BigInt(2),
        failedCount: BigInt(1),
      },
      {
        scopeType: "DAY",
        scopeId: "2026-06-29",
        scopeName: null,
        agentCode: null,
        date: "2026-06-29",
        family: "CUSTOMER",
        applicable: BigInt(2),
        failedCount: BigInt(1),
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
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          evaluations: BigInt(2),
          avgScore: "70",
          fatalCount: BigInt(1),
          stdDev: "10",
          minCreatedAt: new Date("2026-06-29T10:00:00Z"),
          maxCreatedAt: new Date("2026-06-30T10:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([
        { date: "2026-06-29", count: BigInt(1), avgScore: "60" },
        { date: "2026-06-30", count: BigInt(1), avgScore: "80" },
      ])
      .mockResolvedValueOnce([
        {
          bucket0: BigInt(0),
          bucket1: BigInt(1),
          bucket2: BigInt(1),
          bucket3: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "a1",
          name: "Agent 1",
          agentCode: "A1",
          campaignId: "campaign-1",
          campaignName: "Campaign 1",
          avgScore: "70",
        },
      ]);
    prismaMock.response.findMany.mockResolvedValue([
      {
        id: "m1",
        score: 80,
        result: "PASS",
        hasFatalFail: false,
        submittedAt: new Date("2026-06-30T10:00:00Z"),
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
        submittedAt: new Date("2026-06-29T10:00:00Z"),
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
        take: 8,
      }),
    );
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(4);
    expect(prismaMock.response.aggregate).not.toHaveBeenCalled();
    expect(prismaMock.agent.findMany).not.toHaveBeenCalled();
  });

  it("classifies legacy personal results with each campaign threshold", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-low", canViewDashboard: true },
      { campaignId: "campaign-high", canViewDashboard: true },
    ]);
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
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          evaluations: BigInt(2),
          avgScore: "80",
          fatalCount: BigInt(0),
          stdDev: "0",
          minCreatedAt: new Date("2026-06-29T10:00:00Z"),
          maxCreatedAt: new Date("2026-06-30T10:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([
        { date: "2026-06-29", count: BigInt(1), avgScore: "80" },
        { date: "2026-06-30", count: BigInt(1), avgScore: "80" },
      ])
      .mockResolvedValueOnce([
        {
          bucket0: BigInt(0),
          bucket1: BigInt(0),
          bucket2: BigInt(2),
          bucket3: BigInt(0),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "agent-low",
          name: "Agent Low",
          agentCode: "L1",
          campaignId: "campaign-low",
          campaignName: "Low",
          avgScore: "80",
        },
        {
          id: "agent-high",
          name: "Agent High",
          agentCode: "H1",
          campaignId: "campaign-high",
          campaignName: "High",
          avgScore: "80",
        },
      ]);
    prismaMock.response.findMany.mockResolvedValue([
      {
        id: "low-pass",
        score: 80,
        result: null,
        hasFatalFail: false,
        submittedAt: new Date("2026-06-30T10:00:00Z"),
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
        submittedAt: new Date("2026-06-29T10:00:00Z"),
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
            submittedAt: new Date("2026-07-03T12:00:00Z"),
            form: { campaignId: "campaign-low" },
            disposition: null,
          },
          {
            score: 99,
            result: "FAIL",
            hasFatalFail: false,
            submittedAt: new Date("2026-07-02T12:00:00Z"),
            form: { campaignId: "campaign-low" },
            disposition: null,
          },
          {
            score: 99,
            result: "PASS",
            hasFatalFail: true,
            submittedAt: new Date("2026-07-01T12:00:00Z"),
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
            submittedAt: new Date("2026-07-03T12:00:00Z"),
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
        campaign: { name: "Campana Baja" },
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
    prismaMock.campaign.findMany.mockResolvedValue([{ id: "campaign-low" }]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: "disposition-1",
        name: "Escalado",
        code: "ESC",
        categoryName: "Escalamientos",
        totalEvaluations: BigInt(2),
        avgScore: "98",
        passCount: BigInt(0),
      },
    ]);
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
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.disposition.findMany).not.toHaveBeenCalled();
  });

  it("rejects high-score explicit and fatal failures in team detail", async () => {
    prismaMock.team.findFirst
      .mockResolvedValueOnce({ id: "team-1", campaignId: "campaign-low" })
      .mockResolvedValueOnce({
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
                submittedAt: new Date("2026-07-02T12:00:00Z"),
                form: { campaignId: "campaign-low" },
                disposition: null,
              },
              {
                score: 97,
                result: null,
                hasFatalFail: true,
                submittedAt: new Date("2026-07-01T12:00:00Z"),
                form: { campaignId: "campaign-low" },
                disposition: null,
              },
              {
                score: 100,
                result: "PASS",
                hasFatalFail: false,
                submittedAt: new Date("2026-07-03T12:00:00Z"),
                form: { campaignId: "campaign-high" },
                disposition: null,
              },
              {
                score: 100,
                result: "PASS",
                hasFatalFail: false,
                submittedAt: new Date("2026-07-04T12:00:00Z"),
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
                submittedAt: new Date("2026-07-03T12:00:00Z"),
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
    expect(prismaMock.team.findFirst).toHaveBeenLastCalledWith(
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
    prismaMock.campaign.findMany.mockResolvedValue([{ id: "campaign-low" }]);
    prismaMock.disposition.findFirst
      .mockResolvedValueOnce({ id: "disposition-1", campaignId: "campaign-low" })
      .mockResolvedValueOnce({
        id: "disposition-1",
        name: "Escalado",
        code: "ESC",
        active: true,
        campaignId: "campaign-low",
        categoryId: "category-1",
        category: { name: "Escalamientos", campaignId: "campaign-low" },
        campaign: { id: "campaign-low", name: "Campana Uno" },
      });
    prismaMock.response.findMany.mockResolvedValue([
      {
        id: "response-1",
        score: 96,
        result: "FAIL",
        hasFatalFail: false,
        submittedAt: new Date("2026-07-02T12:00:00Z"),
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
        submittedAt: new Date("2026-07-01T12:00:00Z"),
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
    prismaMock.disposition.findMany.mockResolvedValue([]);

    const result = await getDispositionDetail("disposition-1");

    expect(result).toEqual(
      expect.objectContaining({
        id: "disposition-1",
        avgScore: 96,
        passThreshold: 75,
        passRate: 0,
        categoryName: "Escalamientos",
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
          AND: expect.arrayContaining([
            { form: { campaignId: "campaign-low" } },
            expect.objectContaining({
              agent: expect.objectContaining({ campaignId: "campaign-low" }),
            }),
          ]),
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
      createdAt: new Date("2026-06-30T12:00:00Z"),
      submittedAt: new Date("2026-07-01T12:00:00Z"),
      evaluator: { id: "evaluator-1", name: "Eva" },
      answers: [],
    };
    prismaMock.campaign.findMany.mockResolvedValue([{ id: "campaign-low" }]);
    prismaMock.agent.findFirst
      .mockResolvedValueOnce({ id: "agent-1", campaignId: "campaign-low" })
      .mockResolvedValueOnce({
        id: "agent-1",
        name: "Ana",
        agentCode: "A-1",
        campaignId: "campaign-low",
        campaign: { name: "Campana Uno" },
        team: { name: "Equipo Uno", campaignId: "campaign-low" },
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
        teamName: "Equipo Uno",
        scoreTrend: [{ date: "2026-07-01", avgScore: 88 }],
        recentResponses: [expect.objectContaining({ id: "response-valid", result: "PASS" })],
      }),
    );
  });

  it("uses scoped existence checks and uniform errors before loading drill-down PII", async () => {
    prismaMock.campaign.findMany.mockResolvedValue([{ id: "campaign-low" }]);

    await expect(getAgentDetail("hidden-agent")).rejects.toThrow("Agent unavailable");
    expect(prismaMock.agent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hidden-agent",
          OR: [
            {
              campaignId: "campaign-low",
              OR: [{ teamId: null }, { team: { campaignId: "campaign-low" } }],
            },
          ],
        }),
        select: { id: true, campaignId: true },
      }),
    );

    await expect(getTeamDetail("hidden-team")).rejects.toThrow("Team unavailable");
    expect(prismaMock.team.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "hidden-team" }),
        select: { id: true, campaignId: true },
      }),
    );

    await expect(getDispositionDetail("hidden-disposition")).rejects.toThrow(
      "Disposition unavailable",
    );
    expect(prismaMock.disposition.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hidden-disposition",
          OR: [
            {
              campaignId: "campaign-low",
              OR: [{ categoryId: null }, { category: { campaignId: "campaign-low" } }],
            },
          ],
        }),
        select: { id: true, campaignId: true },
      }),
    );

    await expect(getEvaluatorDetail("hidden-evaluator")).rejects.toThrow("Evaluator unavailable");
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "hidden-evaluator",
          responses: {
            some: expect.objectContaining({
              status: "SUBMITTED",
              OR: expect.any(Array),
            }),
          },
        }),
        select: { id: true, name: true, email: true, role: true },
      }),
    );

    expect(prismaMock.agent.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.team.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.disposition.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("returns the effective failed result for a historical fatal response", async () => {
    const createdAt = new Date("2026-07-01T12:00:00Z");
    const updatedAt = new Date("2026-07-02T12:00:00Z");
    prismaMock.response.findFirst
      .mockResolvedValueOnce({
        id: "response-fatal",
        formId: "form-1",
        status: "SUBMITTED",
        form: { campaignId: "campaign-low" },
      })
      .mockResolvedValueOnce({
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
    expect(result.evaluator).toEqual({ id: "evaluator-1", name: "Eva" });
    expect(getPassThresholdForCampaignMock).toHaveBeenCalledWith("campaign-low");
    expect(prismaMock.response.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.response.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          evaluator: { select: { id: true, name: true } },
        }),
      }),
    );
  });

  it("does not expose response detail with an answer from another form", async () => {
    prismaMock.response.findFirst
      .mockResolvedValueOnce({
        id: "response-corrupt",
        formId: "form-1",
        status: "SUBMITTED",
        form: { campaignId: "campaign-low" },
      })
      .mockResolvedValueOnce(null);

    await expect(getResponseDetail("response-corrupt")).rejects.toThrow("Evaluation unavailable");
    expect(prismaMock.response.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.response.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "response-corrupt",
          formId: "form-1",
          AND: expect.arrayContaining([{ answers: { every: { question: { formId: "form-1" } } } }]),
        }),
      }),
    );
  });

  it("returns the same unavailable error for a nonexistent response", async () => {
    prismaMock.response.findFirst.mockResolvedValueOnce(null);

    await expect(getResponseDetail("missing-response")).rejects.toThrow("Evaluation unavailable");
    expect(prismaMock.response.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.response.findUnique).not.toHaveBeenCalled();
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
      submittedAt: new Date("2026-07-10T12:00:00Z"),
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
              AND: expect.arrayContaining([
                { form: { campaignId: "campaign-low" } },
                {
                  agent: expect.objectContaining({
                    campaignId: "campaign-low",
                    OR: expect.arrayContaining([{ team: { campaignId: "campaign-low" } }]),
                  }),
                },
                expect.objectContaining({
                  OR: expect.arrayContaining([
                    expect.objectContaining({
                      disposition: expect.objectContaining({
                        campaignId: "campaign-low",
                        OR: expect.arrayContaining([{ category: { campaignId: "campaign-low" } }]),
                      }),
                    }),
                  ]),
                }),
              ]),
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
              {
                agent: expect.objectContaining({
                  campaignId: "campaign-low",
                  OR: expect.arrayContaining([{ team: { campaignId: "campaign-low" } }]),
                }),
              },
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
          AND: expect.arrayContaining([
            { form: { campaignId: "campaign-low" } },
            {
              agent: expect.objectContaining({
                campaignId: "campaign-low",
                OR: expect.arrayContaining([{ team: { campaignId: "campaign-low" } }]),
              }),
            },
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  disposition: expect.objectContaining({
                    campaignId: "campaign-low",
                    OR: expect.arrayContaining([{ category: { campaignId: "campaign-low" } }]),
                  }),
                }),
              ]),
            }),
          ]),
        },
      ]),
    );
  });
});

describe("Evaluation history authorization", () => {
  const evaluatorUser = {
    id: "qa-history",
    role: "QA",
    campaignIds: ["campaign-1"],
  };

  function historyRow() {
    const submittedAt = new Date("2026-07-10T12:00:00Z");
    return {
      id: "response-own",
      score: 88,
      result: "PASS",
      hasFatalFail: false,
      createdAt: new Date("2026-07-09T12:00:00Z"),
      submittedAt,
      agent: {
        id: "agent-1",
        name: "Ana",
        campaign: { name: "Campana Uno" },
      },
      evaluator: { id: evaluatorUser.id, name: "QA Uno" },
      form: {
        id: "form-1",
        title: "Formulario QA",
        campaignId: "campaign-1",
      },
      disposition: null,
    };
  }

  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getPassThresholdForCampaignMock.mockReset();
    authMock.mockResolvedValue({ user: evaluatorUser });
    getPassThresholdForCampaignMock.mockResolvedValue(70);
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: evaluatorUser.id,
      campaignId: "campaign-1",
      canViewDashboard: true,
    });
    prismaMock.response.findMany.mockResolvedValue([historyRow()]);
    prismaMock.response.count.mockResolvedValue(1);
    prismaMock.response.aggregate.mockResolvedValue({ _avg: { score: 88 } });
  });

  it("forces the current evaluator in own scope and filters by submission date", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: evaluatorUser.id,
      campaignId: "campaign-1",
      canViewDashboard: true,
    });

    const result = await getEvaluationHistory({
      scope: "own",
      campaignId: "campaign-1",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
    });

    expect(result).toEqual(
      expect.objectContaining({
        scope: "own",
        totalCount: 1,
        page: 1,
        pageSize: 25,
        summary: { totalEvaluations: 1, avgScore: 88, passRate: 100 },
      }),
    );
    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          evaluatorId: evaluatorUser.id,
          form: { campaignId: "campaign-1" },
          status: "SUBMITTED",
          submittedAt: expect.objectContaining({
            not: null,
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        }),
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        skip: 0,
        take: 25,
      }),
    );
    expect(prismaMock.response.findMany.mock.calls[0]?.[0].where).not.toHaveProperty("createdAt");
  });

  it("rejects managed scope when the campaign lacks evaluation permission", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: evaluatorUser.id,
      campaignId: "campaign-1",
      canViewDashboard: true,
      canViewEvaluations: false,
      canViewReports: true,
    });

    await expect(
      getEvaluationHistory({ scope: "managed", campaignId: "campaign-1" }),
    ).rejects.toThrow("Unauthorized for this action in this campaign");
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("does not force evaluator ownership in an authorized managed scope", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: evaluatorUser.id,
      campaignId: "campaign-1",
      canViewEvaluations: true,
      canViewReports: false,
    });

    const result = await getEvaluationHistory({
      scope: "managed",
      campaignId: "campaign-1",
      page: 2,
      pageSize: 10,
    });

    expect(result.scope).toBe("managed");
    const where = prismaMock.response.findMany.mock.calls[0]?.[0].where;
    expect(where).not.toHaveProperty("evaluatorId");
    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it("applies all monthly drill-down filters in managed scope", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: evaluatorUser.id,
      campaignId: "campaign-1",
      canViewEvaluations: true,
      canViewReports: false,
    });

    await getEvaluationHistory({
      scope: "managed",
      campaignId: "campaign-1",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      agentId: "agent-filter",
      evaluatorId: "qa-filter",
      formId: "form-filter",
      dispositionId: "disposition-filter",
      fatalOnly: true,
    });

    const historyWhere = prismaMock.response.findMany.mock.calls[0]?.[0].where;
    expect(historyWhere).toEqual(
      expect.objectContaining({
        form: { campaignId: "campaign-1" },
        agentId: "agent-filter",
        evaluatorId: "qa-filter",
        formId: "form-filter",
        dispositionId: "disposition-filter",
        hasFatalFail: true,
        status: "SUBMITTED",
        submittedAt: expect.objectContaining({
          not: null,
          gte: expect.any(Date),
          lt: expect.any(Date),
        }),
      }),
    );
    expect(prismaMock.response.count.mock.calls[0]?.[0]).toEqual({ where: historyWhere });
    expect(prismaMock.response.aggregate).toHaveBeenCalledWith({
      where: historyWhere,
      _avg: { score: true },
    });
  });

  it("returns an explicit empty summary from the same authorized filter", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: evaluatorUser.id,
      campaignId: "campaign-1",
      canViewEvaluations: true,
    });
    prismaMock.response.findMany.mockResolvedValue([]);
    prismaMock.response.count.mockResolvedValue(0);
    prismaMock.response.aggregate.mockResolvedValue({ _avg: { score: null } });

    const result = await getEvaluationHistory({
      scope: "managed",
      campaignId: "campaign-1",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
    });

    expect(result.summary).toEqual({ totalEvaluations: 0, avgScore: 0, passRate: 0 });
    expect(result.responses).toEqual([]);
    const historyWhere = prismaMock.response.findMany.mock.calls[0]?.[0].where;
    expect(prismaMock.response.count.mock.calls[0]?.[0]).toEqual({ where: historyWhere });
    expect(prismaMock.response.aggregate).toHaveBeenCalledWith({
      where: historyWhere,
      _avg: { score: true },
    });
    expect(prismaMock.response.count.mock.calls[1]?.[0]).toEqual({
      where: expect.objectContaining({ AND: expect.arrayContaining([historyWhere]) }),
    });
  });

  it("ignores a manipulated evaluatorId in own scope and forces the session evaluator", async () => {
    await getEvaluationHistory({
      scope: "own",
      campaignId: "campaign-1",
      evaluatorId: "qa-peer",
      agentId: "agent-1",
    });

    const historyWhere = prismaMock.response.findMany.mock.calls[0]?.[0].where;
    expect(historyWhere).toEqual(
      expect.objectContaining({
        evaluatorId: evaluatorUser.id,
        agentId: "agent-1",
      }),
    );
    expect(JSON.stringify(historyWhere)).not.toContain("qa-peer");
  });

  it("derives own filter options only from authorized submitted responses", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewDashboard: true,
        canViewReports: false,
      },
      {
        campaignId: "campaign-2",
        canViewDashboard: false,
        canViewReports: true,
      },
    ]);
    prismaMock.response.findMany
      .mockReset()
      .mockResolvedValueOnce([
        {
          agent: {
            id: "agent-own",
            name: "Ana",
            campaignId: "campaign-1",
            campaign: { name: "Campana Uno" },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          evaluator: { id: evaluatorUser.id, name: "QA Propio" },
          form: { campaignId: "campaign-1" },
        },
      ])
      .mockResolvedValueOnce([
        {
          form: {
            id: "form-own",
            title: "Formulario Propio",
            campaignId: "campaign-1",
            campaign: { name: "Campana Uno" },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          disposition: {
            id: "disposition-own",
            name: "Venta",
            campaignId: "campaign-1",
            campaign: { name: "Campana Uno" },
          },
        },
      ]);

    await expect(getEvaluationHistoryFilterOptions("own")).resolves.toEqual({
      agents: [
        {
          id: "agent-own",
          name: "Ana",
          campaignId: "campaign-1",
          campaignName: "Campana Uno",
        },
      ],
      evaluators: [{ id: evaluatorUser.id, name: "QA Propio", campaignIds: ["campaign-1"] }],
      forms: [
        {
          id: "form-own",
          name: "Formulario Propio",
          campaignId: "campaign-1",
          campaignName: "Campana Uno",
        },
      ],
      dispositions: [
        {
          id: "disposition-own",
          name: "Venta",
          campaignId: "campaign-1",
          campaignName: "Campana Uno",
        },
      ],
    });

    const ownScope = prismaMock.response.findMany.mock.calls[0]?.[0].where;
    expect(ownScope).toEqual(
      expect.objectContaining({
        form: { campaignId: { in: ["campaign-1"] } },
        evaluatorId: evaluatorUser.id,
        status: "SUBMITTED",
        submittedAt: { not: null },
      }),
    );
    expect(JSON.stringify(ownScope)).not.toContain("campaign-2");
    expect(prismaMock.agent.findMany).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.form.findMany).not.toHaveBeenCalled();
    expect(prismaMock.disposition.findMany).not.toHaveBeenCalled();
  });

  it("derives managed filter options from evaluation-authorized responses without self scope", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewDashboard: true,
        canViewEvaluations: true,
        canViewReports: false,
      },
      {
        campaignId: "campaign-2",
        canViewDashboard: true,
        canViewEvaluations: false,
        canViewReports: true,
      },
    ]);
    prismaMock.response.findMany
      .mockReset()
      .mockResolvedValueOnce([
        {
          agent: {
            id: "agent-managed",
            name: "Bruno",
            campaignId: "campaign-1",
            campaign: { name: "Campana Uno" },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          evaluator: { id: "qa-managed", name: "QA Gestionado" },
          form: { campaignId: "campaign-1" },
        },
      ])
      .mockResolvedValueOnce([
        {
          form: {
            id: "form-managed",
            title: "Formulario Gestionado",
            campaignId: "campaign-1",
            campaign: { name: "Campana Uno" },
          },
        },
      ])
      .mockResolvedValueOnce([]);

    const options = await getEvaluationHistoryFilterOptions("managed");

    expect(options).toEqual(
      expect.objectContaining({
        agents: [expect.objectContaining({ id: "agent-managed" })],
        evaluators: [{ id: "qa-managed", name: "QA Gestionado", campaignIds: ["campaign-1"] }],
        forms: [expect.objectContaining({ id: "form-managed" })],
        dispositions: [],
      }),
    );
    const managedScope = prismaMock.response.findMany.mock.calls[0]?.[0].where;
    expect(managedScope).toEqual(
      expect.objectContaining({
        form: { campaignId: { in: ["campaign-1"] } },
        status: "SUBMITTED",
        submittedAt: { not: null },
      }),
    );
    expect(managedScope).not.toHaveProperty("evaluatorId");
    expect(JSON.stringify(managedScope)).not.toContain("campaign-2");
    expect(prismaMock.response.findMany).toHaveBeenCalledTimes(4);
    expect(prismaMock.response.findMany.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        distinct: ["evaluatorId", "formId"],
        select: {
          evaluator: { select: { id: true, name: true } },
          form: { select: { campaignId: true } },
        },
      }),
    );
  });

  it.each([
    "PENDING",
    "PASSED",
    "",
    "CANCELLED",
  ])("rejects the unsupported result status %j before querying responses", async (resultStatus) => {
    await expect(
      getEvaluationHistory({ scope: "own", campaignId: "campaign-1", resultStatus }),
    ).rejects.toThrow("resultStatus must be PASS or FAIL");
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 10_001])("rejects the invalid page %s", async (page) => {
    await expect(
      getEvaluationHistory({ scope: "own", campaignId: "campaign-1", page }),
    ).rejects.toThrow("page must be an integer between 1 and 10000");
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it.each([
    [{ minScore: -1 }, "minScore must be a number between 0 and 100"],
    [{ maxScore: 101 }, "maxScore must be a number between 0 and 100"],
    [{ minScore: Number.NaN }, "minScore must be a number between 0 and 100"],
    [{ minScore: 80, maxScore: 70 }, "minScore cannot be greater than maxScore"],
  ] as const)("rejects invalid score boundaries", async (scoreParams, message) => {
    await expect(
      getEvaluationHistory({ scope: "own", campaignId: "campaign-1", ...scoreParams }),
    ).rejects.toThrow(message);
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("rejects a submitted history row without submittedAt instead of falling back to createdAt", async () => {
    prismaMock.response.findMany.mockResolvedValue([{ ...historyRow(), submittedAt: null }]);

    await expect(getEvaluationHistory({ scope: "own", campaignId: "campaign-1" })).rejects.toThrow(
      "Submitted evaluation has no submission date",
    );
  });
});
