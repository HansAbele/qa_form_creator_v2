import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});

import {
  getCampaignResponseAggregates,
  getCoachingAgentAggregates,
  getCoachingCategoryAggregates,
  getCriticalErrorAccuracyAggregates,
  getDispositionAggregates,
  getEvaluatorActivityAggregates,
  getQACategoryMetricAggregates,
  getResponseTrendAggregates,
  getScopedResponsePageIds,
  getScoreByQuestionAggregates,
  getScoreDistributionCounts,
  getSelfDashboardAgentAggregates,
  getSelfDashboardSummary,
} from "./analytics-sql";

describe("analytics SQL scope", () => {
  beforeEach(() => resetPrismaMock());

  it("returns no data and executes no query for an empty authorized scope", async () => {
    await expect(getCampaignResponseAggregates({ campaigns: [] })).resolves.toEqual([]);
    await expect(
      getScopedResponsePageIds({ campaigns: [], page: 1, pageSize: 50 }),
    ).resolves.toEqual([]);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("normalizes bigint and decimal aggregate values for Server Action serialization", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        campaignId: "campaign-1",
        totalEvaluations: BigInt(12),
        avgScore: "81.25",
        passCount: BigInt(9),
        fatalFailCount: BigInt(1),
        minCreatedAt: new Date("2026-01-01T00:00:00Z"),
        maxCreatedAt: new Date("2026-01-30T00:00:00Z"),
      },
    ]);

    await expect(
      getCampaignResponseAggregates({
        campaigns: [{ campaignId: "campaign-1", passThreshold: 75 }],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        campaignId: "campaign-1",
        totalEvaluations: 12,
        avgScore: 81.25,
        passCount: 9,
        fatalFailCount: 1,
      }),
    ]);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("uses one query regardless of the number of authorized campaigns", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const campaigns = Array.from({ length: 50 }, (_, index) => ({
      campaignId: `campaign-${index}`,
      passThreshold: 70 + (index % 5),
    }));

    await getCampaignResponseAggregates({ campaigns, dateFrom: "2026-01-01" });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("paginates with a stable SQL query and returns only response IDs", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: "response-2" }, { id: "response-1" }]);

    await expect(
      getScopedResponsePageIds({
        campaigns: [{ campaignId: "campaign-1", passThreshold: 75 }],
        page: 2,
        pageSize: 2,
        resultStatus: "FAIL",
        fatalOnly: true,
      }),
    ).resolves.toEqual(["response-2", "response-1"]);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("keeps dashboard and KPI aggregate query counts constant across large campaign scopes", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const campaigns = Array.from({ length: 250 }, (_, index) => ({
      campaignId: `campaign-${index}`,
      passThreshold: 65 + (index % 20),
    }));
    const filters = { campaigns, dateFrom: "2026-01-01", dateTo: "2026-03-31" };

    await Promise.all([
      getResponseTrendAggregates(filters),
      getScoreDistributionCounts(filters, 70),
      getEvaluatorActivityAggregates(filters),
      getScoreByQuestionAggregates(filters),
      getQACategoryMetricAggregates(filters),
      getCriticalErrorAccuracyAggregates(filters, true),
      getCoachingAgentAggregates(filters),
      getCoachingCategoryAggregates(filters),
      getDispositionAggregates(filters),
      getSelfDashboardSummary({ ...filters, evaluatorId: "qa-1" }),
      getSelfDashboardAgentAggregates({ ...filters, evaluatorId: "qa-1" }),
    ]);

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(11);
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
    expect(prismaMock.answer.findMany).not.toHaveBeenCalled();
  });

  it("executes no analytics query when RBAC resolves to an empty campaign scope", async () => {
    const filters = { campaigns: [] };

    await expect(
      Promise.all([
        getResponseTrendAggregates(filters),
        getEvaluatorActivityAggregates(filters),
        getScoreByQuestionAggregates(filters),
        getQACategoryMetricAggregates(filters),
        getCriticalErrorAccuracyAggregates(filters, true),
        getCoachingAgentAggregates(filters),
        getCoachingCategoryAggregates(filters),
        getDispositionAggregates(filters),
      ]),
    ).resolves.toEqual([[], [], [], [], [], [], [], []]);
    await expect(getScoreDistributionCounts(filters, 70)).resolves.toEqual([0, 0, 0, 0]);
    await expect(getSelfDashboardSummary(filters)).resolves.toEqual({
      evaluations: 0,
      avgScore: 0,
      fatalCount: 0,
      stdDev: 0,
      minCreatedAt: null,
      maxCreatedAt: null,
    });
    await expect(getSelfDashboardAgentAggregates(filters)).resolves.toEqual([]);

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("parameterizes tenant/date input and enforces relation integrity in answer aggregates", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    await getScoreByQuestionAggregates({
      campaigns: [{ campaignId: "campaign-sensitive", passThreshold: 73 }],
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
    });

    const query = prismaMock.$queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[];
      values?: readonly unknown[];
    };
    const sql = query.strings?.join(" ") ?? "";
    expect(sql).toContain("authorized_campaign");
    expect(sql).toContain("r.\"status\" = 'SUBMITTED'");
    expect(sql).toContain('ag."campaignId" = f."campaignId"');
    expect(sql).toContain('q."formId" = sr."formId"');
    expect(sql).toContain('r."createdAt" >=');
    expect(sql).toContain('r."createdAt" <');
    expect(sql).not.toContain("campaign-sensitive");
    expect(query.values).toContain("campaign-sensitive");
  });

  it("returns all CEA dimensions from a single normalized aggregate query", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        scopeType: "AGENT",
        scopeId: "agent-1",
        scopeName: "Ana",
        agentCode: "A-1",
        date: null,
        family: "COMPLIANCE",
        applicable: BigInt(8),
        failedCount: BigInt(1),
      },
    ]);

    await expect(
      getCriticalErrorAccuracyAggregates(
        { campaigns: [{ campaignId: "campaign-1", passThreshold: 70 }] },
        true,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        scopeType: "AGENT",
        scopeId: "agent-1",
        applicable: 8,
        failedCount: 1,
      }),
    ]);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("keeps the evaluator self-dashboard scope in SQL instead of loading peer responses", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    await getSelfDashboardSummary({
      campaigns: [{ campaignId: "campaign-1", passThreshold: 70 }],
      evaluatorId: "qa-private",
    });

    const query = prismaMock.$queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[];
      values?: readonly unknown[];
    };
    const sql = query.strings?.join(" ") ?? "";
    expect(sql).toContain('r."evaluatorId" =');
    expect(sql).not.toContain("qa-private");
    expect(query.values).toContain("qa-private");
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });
});
