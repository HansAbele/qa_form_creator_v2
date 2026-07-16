"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { RESPONSE_STATUS, submittedResponseWhere } from "@/lib/response-status";
import {
  getCampaignScoringSettings,
  getPassThresholdForCampaign,
  getSettings,
} from "@/lib/settings";
import { buildQACategoryMetrics } from "@/lib/qa-category-metrics";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";
import { assertCampaignPermissionForUser, getCampaignFilterForPermission } from "./campaign-filter";

// Program analytics expose peer and agent performance, so they require the
// scoped KPI permission. Basic dashboard access is only for "Mi trabajo".
const DASHBOARD_READ_PERMISSION = "canViewKPIs" satisfies CampaignPermissionKey;
const SELF_DASHBOARD_READ_PERMISSION = "canViewDashboard" satisfies CampaignPermissionKey;
const KPI_READ_PERMISSION = "canViewKPIs" satisfies CampaignPermissionKey;
const REPORT_READ_PERMISSION = "canViewReports" satisfies CampaignPermissionKey;

type CampaignFilter = { campaignId?: string | { in?: string[] } };

type TargetSettings = {
  passThreshold: number;
  targetPassRate: number;
  targetAvgScore: number;
  targetDailyRate: number;
  fatalFailuresAllowed: number;
};

// ─── Date filter helper ────────────────────────────────

function dateWhere(dateFrom?: string, dateTo?: string) {
  if (!dateFrom && !dateTo) return {};
  return {
    createdAt: {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59`) } : {}),
    },
  };
}

function passingResponseWhere(passThreshold: number) {
  return {
    ...submittedResponseWhere(),
    ...effectiveResultWhere("PASS", passThreshold),
  };
}

function isPassingResponse(
  score: number,
  result: string | null,
  hasFatalFail: boolean,
  passThreshold: number,
) {
  if (hasFatalFail || result === "FAIL") return false;
  if (result === "PASS") return true;
  return score >= passThreshold;
}

type EffectiveResultStatus = "PASS" | "FAIL";

function normalizeEffectiveResultStatus(value: unknown): EffectiveResultStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized === "PASS" || normalized === "FAIL" ? normalized : undefined;
}

function effectiveResultWhere(
  resultStatus: EffectiveResultStatus,
  passThreshold: number,
): Prisma.ResponseWhereInput {
  const scoreFallback = {
    OR: [{ result: null }, { result: { notIn: ["PASS", "FAIL"] } }],
  } satisfies Prisma.ResponseWhereInput;

  if (resultStatus === "PASS") {
    return {
      hasFatalFail: false,
      OR: [
        { result: "PASS" },
        {
          ...scoreFallback,
          score: { gte: passThreshold },
        },
      ],
    };
  }

  return {
    OR: [
      { hasFatalFail: true },
      { result: "FAIL" },
      {
        hasFatalFail: false,
        ...scoreFallback,
        score: { lt: passThreshold },
      },
    ],
  };
}

function responseRelationConditions(campaignId: string): Prisma.ResponseWhereInput[] {
  return [
    { form: { campaignId } },
    { agent: { campaignId } },
    {
      OR: [{ dispositionId: null }, { disposition: { campaignId } }],
    },
  ];
}

function responseRelationScopeWhere(campaignId: string): Prisma.ResponseWhereInput {
  return { AND: responseRelationConditions(campaignId) };
}

function responseCampaignScopeWhere(
  campaignId: string,
  passThreshold: number,
  resultStatus?: EffectiveResultStatus,
): Prisma.ResponseWhereInput {
  const conditions = responseRelationConditions(campaignId);
  if (resultStatus) conditions.push(effectiveResultWhere(resultStatus, passThreshold));
  return { AND: conditions };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function getRangeDays(dateFrom?: string, dateTo?: string) {
  if (dateFrom && dateTo) {
    return Math.max(
      1,
      Math.ceil(
        (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24),
      ) + 1,
    );
  }

  if (dateFrom) {
    return Math.max(
      1,
      Math.ceil((Date.now() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24)),
    );
  }

  return 30;
}

async function getTargetSettingsForCampaign(campaignId?: string): Promise<TargetSettings> {
  if (campaignId) {
    const settings = await getCampaignScoringSettings(campaignId);
    return {
      passThreshold: settings.passThreshold,
      targetPassRate: settings.targetPassRate,
      targetAvgScore: settings.targetAvgScore,
      targetDailyRate: settings.targetDailyRate,
      fatalFailuresAllowed: settings.fatalFailuresAllowed,
    };
  }

  const settings = await getSettings();
  return {
    ...settings,
    fatalFailuresAllowed: 0,
  };
}

async function getTargetSettingsMap(campaignIds: string[]) {
  const uniqueCampaignIds = [...new Set(campaignIds.filter(Boolean))];
  const entries = await Promise.all(
    uniqueCampaignIds.map(
      async (campaignId) => [campaignId, await getTargetSettingsForCampaign(campaignId)] as const,
    ),
  );
  return new Map(entries);
}

async function getCampaignIdsForFilter(campaignFilter: CampaignFilter) {
  const value = campaignFilter.campaignId;

  if (typeof value === "string") return [value];
  if (value && Array.isArray(value.in)) return value.in;

  const campaigns = await prisma.campaign.findMany({ select: { id: true } });
  return (campaigns ?? []).map((campaign) => campaign.id);
}

async function getResponseIntegrityFilter(
  campaignFilter: CampaignFilter,
): Promise<Prisma.ResponseWhereInput> {
  const campaignIds = await getCampaignIdsForFilter(campaignFilter);
  return campaignIds.length > 0
    ? { OR: campaignIds.map(responseRelationScopeWhere) }
    : { id: { in: [] } };
}

async function getAggregateTargetSettings(
  campaignFilter: CampaignFilter,
  campaignId?: string,
): Promise<TargetSettings> {
  if (campaignId) return getTargetSettingsForCampaign(campaignId);

  const [globalSettings, visibleCampaignIds] = await Promise.all([
    getSettings(),
    getCampaignIdsForFilter(campaignFilter),
  ]);

  if (visibleCampaignIds.length === 0) {
    return { ...globalSettings, fatalFailuresAllowed: 0 };
  }

  const settingsMap = await getTargetSettingsMap(visibleCampaignIds);
  const settings = visibleCampaignIds
    .map((id) => settingsMap.get(id))
    .filter((value): value is TargetSettings => Boolean(value));

  if (settings.length === 0) {
    return { ...globalSettings, fatalFailuresAllowed: 0 };
  }

  return {
    passThreshold: globalSettings.passThreshold,
    targetPassRate: round2(
      settings.reduce((sum, item) => sum + item.targetPassRate, 0) / settings.length,
    ),
    targetAvgScore: round2(
      settings.reduce((sum, item) => sum + item.targetAvgScore, 0) / settings.length,
    ),
    targetDailyRate: round2(settings.reduce((sum, item) => sum + item.targetDailyRate, 0)),
    fatalFailuresAllowed: settings.reduce((sum, item) => sum + item.fatalFailuresAllowed, 0),
  };
}

async function getPassThresholdMap(campaignIds: string[]) {
  const uniqueCampaignIds = [...new Set(campaignIds.filter(Boolean))];
  const entries = await Promise.all(
    uniqueCampaignIds.map(
      async (campaignId) => [campaignId, await getPassThresholdForCampaign(campaignId)] as const,
    ),
  );
  return new Map(entries);
}

async function getDashboardPassCount(args: {
  formFilter: CampaignFilter;
  dateFilter: ReturnType<typeof dateWhere>;
  campaignId?: string;
  selectedCampaignThreshold: number;
}) {
  const { formFilter, dateFilter, campaignId, selectedCampaignThreshold } = args;
  const campaignIds = campaignId ? [campaignId] : await getCampaignIdsForFilter(formFilter);
  if (campaignIds.length === 0) return 0;
  const thresholds = campaignId
    ? new Map([[campaignId, selectedCampaignThreshold]])
    : await getPassThresholdMap(campaignIds);
  const campaignScopes = campaignIds.map((visibleCampaignId) =>
    responseCampaignScopeWhere(visibleCampaignId, thresholds.get(visibleCampaignId) ?? 70, "PASS"),
  );

  return prisma.response.count({
    where: {
      form: formFilter,
      OR: campaignScopes,
      ...dateFilter,
      ...submittedResponseWhere(),
    },
  });
}

// ─── Dashboard Stats ────────────────────────────────

export async function getDashboardStats(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const formFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const targetSettings = await getAggregateTargetSettings(formFilter, campaignId);
  const visibleCampaignIds = campaignId ? [campaignId] : await getCampaignIdsForFilter(formFilter);
  const integrityScopes = visibleCampaignIds.map((visibleCampaignId) =>
    responseCampaignScopeWhere(visibleCampaignId, targetSettings.passThreshold),
  );
  const responseWhere = {
    form: formFilter,
    ...(integrityScopes.length > 0 ? { OR: integrityScopes } : { id: { in: [] as string[] } }),
    ...dw,
    ...submittedResponseWhere(),
  } satisfies Prisma.ResponseWhereInput;
  const rangeDays = getRangeDays(dateFrom, dateTo);

  const [formCount, responseCount, avgScore, passCount, fatalFailCount, recentResponses] =
    await Promise.all([
      prisma.form.count({ where: formFilter }),
      prisma.response.count({ where: responseWhere }),
      prisma.response.aggregate({
        where: responseWhere,
        _avg: { score: true },
      }),
      getDashboardPassCount({
        formFilter,
        dateFilter: dw,
        campaignId,
        selectedCampaignThreshold: targetSettings.passThreshold,
      }),
      prisma.response.count({
        where: { ...responseWhere, hasFatalFail: true },
      }),
      prisma.response.findMany({
        where: responseWhere,
        include: {
          form: { select: { title: true } },
          agent: { select: { name: true } },
          evaluator: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);
  const failCount = responseCount - passCount;

  return {
    formCount,
    responseCount,
    avgScore: Number(avgScore._avg.score ?? 0),
    passRate: responseCount > 0 ? Math.round((passCount / responseCount) * 100) : 0,
    passCount,
    failCount,
    fatalFailCount,
    dailyRate: round2(responseCount / rangeDays),
    ...targetSettings,
    recentResponses: recentResponses.map((r) => ({
      id: r.id,
      formTitle: r.form.title,
      agentName: r.agent.name,
      evaluatorName: r.evaluator.name,
      score: Number(r.score),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ─── Response Trends (daily) ───────────────────────

export async function getResponseTrends(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const formFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const integrityFilter = await getResponseIntegrityFilter(formFilter);

  const responses = await prisma.response.findMany({
    where: { form: formFilter, ...integrityFilter, ...dw, ...submittedResponseWhere() },
    select: { score: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const dayMap = new Map<string, { count: number; totalScore: number }>();
  for (const r of responses) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const existing = dayMap.get(day) ?? { count: 0, totalScore: 0 };
    existing.count++;
    existing.totalScore += Number(r.score);
    dayMap.set(day, existing);
  }

  return Array.from(dayMap.entries()).map(([date, data]) => ({
    date,
    count: data.count,
    avgScore: Math.round((data.totalScore / data.count) * 100) / 100,
  }));
}

// ─── Top / Bottom Performers ───────────────────────

export async function getTopBottomPerformers(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(
    DASHBOARD_READ_PERMISSION,
    campaignId,
  );
  const dw = dateWhere(dateFrom, dateTo);
  const integrityFilter = await getResponseIntegrityFilter(campaignFilter);

  const agents = await prisma.agent.findMany({
    where: { ...campaignFilter, active: true },
    include: {
      responses: {
        where: { ...integrityFilter, ...dw, ...submittedResponseWhere() },
        select: { score: true },
      },
    },
  });

  const ranked = agents
    .filter((a) => a.responses.length > 0)
    .map((a) => {
      const scores = a.responses.map((r) => Number(r.score));
      const avg = scores.reduce((x, y) => x + y, 0) / scores.length;
      return {
        id: a.id,
        name: a.name,
        agentCode: a.agentCode,
        avgScore: Math.round(avg * 100) / 100,
        totalEvaluations: scores.length,
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore);

  return {
    top10: ranked.slice(0, 10),
    bottom5: ranked.slice(-5).reverse(),
  };
}

// ─── Evaluator Activity ────────────────────────────

async function getEvaluatorActivityForPermission(
  permission: CampaignPermissionKey,
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const formFilter = await getCampaignFilterForPermission(permission, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const integrityFilter = await getResponseIntegrityFilter(formFilter);

  const evaluators = await prisma.user.findMany({
    where: {
      responses: {
        some: {
          form: formFilter,
          ...integrityFilter,
          ...dw,
          ...submittedResponseWhere(),
        },
      },
    },
    include: {
      responses: {
        where: {
          form: formFilter,
          ...integrityFilter,
          ...dw,
          ...submittedResponseWhere(),
        },
        select: { score: true },
      },
    },
  });

  return evaluators
    .map((e) => {
      const scores = e.responses.map((r) => Number(r.score));
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      // Standard deviation for consistency
      const variance =
        scores.length > 1 ? scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / scores.length : 0;
      const stdDev = Math.sqrt(variance);

      return {
        id: e.id,
        name: e.name ?? e.email,
        role: e.role,
        totalEvaluations: scores.length,
        avgScore: Math.round(avg * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
      };
    })
    .sort((a, b) => b.totalEvaluations - a.totalEvaluations);
}

export async function getDashboardEvaluatorActivity(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return getEvaluatorActivityForPermission(DASHBOARD_READ_PERMISSION, campaignId, dateFrom, dateTo);
}

export async function getEvaluatorActivity(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return getEvaluatorActivityForPermission(KPI_READ_PERMISSION, campaignId, dateFrom, dateTo);
}

// ─── Evaluations per Agent (volume) ────────────────

export async function getEvaluationsPerAgent(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(
    DASHBOARD_READ_PERMISSION,
    campaignId,
  );
  const dw = dateWhere(dateFrom, dateTo);

  const agents = await prisma.agent.findMany({
    where: { ...campaignFilter, active: true },
    include: {
      responses: {
        where: { ...dw, ...submittedResponseWhere() },
        select: {
          id: true,
          form: { select: { campaignId: true } },
          disposition: { select: { campaignId: true } },
        },
      },
    },
  });

  return agents
    .map((agent) => ({
      ...agent,
      responses: agent.responses.filter(
        (response) =>
          response.form.campaignId === agent.campaignId &&
          (!response.disposition || response.disposition.campaignId === agent.campaignId),
      ),
    }))
    .filter((agent) => agent.responses.length > 0)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      count: agent.responses.length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// ─── Top 5 Agent Score Trends ──────────────────────

export async function getAgentScoreTrends(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION);
  const dw = dateWhere(dateFrom, dateTo);

  // Get top 5 agents by avg score
  const agents = await prisma.agent.findMany({
    where: { ...campaignFilter, active: true },
    include: {
      responses: {
        where: { ...dw, ...submittedResponseWhere() },
        select: {
          score: true,
          createdAt: true,
          form: { select: { campaignId: true } },
          disposition: { select: { campaignId: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const ranked = agents
    .map((agent) => ({
      ...agent,
      responses: agent.responses.filter(
        (response) =>
          response.form.campaignId === agent.campaignId &&
          (!response.disposition || response.disposition.campaignId === agent.campaignId),
      ),
    }))
    .filter((a) => a.responses.length >= 2)
    .map((a) => {
      const scores = a.responses.map((r) => Number(r.score));
      const avg = scores.reduce((x, y) => x + y, 0) / scores.length;
      return { ...a, avg };
    })
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  // Build daily data for each agent
  const allDates = new Set<string>();
  for (const agent of ranked) {
    for (const r of agent.responses) {
      allDates.add(r.createdAt.toISOString().slice(0, 10));
    }
  }
  const sortedDates = Array.from(allDates).sort();

  const series = sortedDates.map((date) => {
    const point: Record<string, string | number | null> = { date };
    for (const agent of ranked) {
      const dayResponses = agent.responses.filter(
        (r) => r.createdAt.toISOString().slice(0, 10) === date,
      );
      if (dayResponses.length > 0) {
        const dayAvg =
          dayResponses.map((r) => Number(r.score)).reduce((a, b) => a + b, 0) / dayResponses.length;
        point[agent.name] = Math.round(dayAvg * 100) / 100;
      } else {
        point[agent.name] = null;
      }
    }
    return point;
  });

  return {
    agentNames: ranked.map((a) => a.name),
    series,
  };
}

// ─── Agent Performance (table) ─────────────────────

export async function getAgentPerformance(campaignId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION, campaignId);
  const where = { ...campaignFilter, active: true };

  const agents = await prisma.agent.findMany({
    where,
    include: {
      campaign: { select: { name: true } },
      responses: {
        where: submittedResponseWhere(),
        select: {
          score: true,
          result: true,
          hasFatalFail: true,
          createdAt: true,
          form: { select: { campaignId: true } },
          disposition: { select: { campaignId: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });
  const passThresholds = await getPassThresholdMap(agents.map((agent) => agent.campaignId));

  return agents.map((agent) => {
    const passThreshold = passThresholds.get(agent.campaignId) ?? 70;
    const responses = agent.responses.filter(
      (response) =>
        response.form.campaignId === agent.campaignId &&
        (!response.disposition || response.disposition.campaignId === agent.campaignId),
    );
    const scores = responses.map((r) => Number(r.score));
    const total = scores.length;
    const avgScore = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
    const passCount = responses.filter((response) =>
      isPassingResponse(
        Number(response.score),
        response.result,
        response.hasFatalFail,
        passThreshold,
      ),
    ).length;
    const lastScore = scores[0] ?? null;
    const minScore = total > 0 ? Math.min(...scores) : null;
    const maxScore = total > 0 ? Math.max(...scores) : null;

    // Trend: compare last 5 vs previous 5
    const recent5 = scores.slice(0, 5);
    const prev5 = scores.slice(5, 10);
    const recentAvg = recent5.length > 0 ? recent5.reduce((a, b) => a + b, 0) / recent5.length : 0;
    const prevAvg = prev5.length > 0 ? prev5.reduce((a, b) => a + b, 0) / prev5.length : 0;
    const trend = prev5.length > 0 ? recentAvg - prevAvg : 0;

    return {
      id: agent.id,
      name: agent.name,
      agentCode: agent.agentCode,
      campaignName: agent.campaign.name,
      totalEvaluations: total,
      avgScore: Math.round(avgScore * 100) / 100,
      passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
      lastScore,
      minScore,
      maxScore,
      trend: Math.round(trend * 100) / 100,
    };
  });
}

// ─── Reports ────────────────────────────────────────

export async function getReportData(filters: {
  campaignId?: string;
  formId?: string;
  agentId?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(
    REPORT_READ_PERMISSION,
    filters.campaignId,
  );
  const integrityFilter = await getResponseIntegrityFilter(campaignFilter);

  const where: Record<string, unknown> = {
    form: campaignFilter,
    ...integrityFilter,
    ...submittedResponseWhere(),
    ...(filters.formId ? { formId: filters.formId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...dateWhere(filters.dateFrom, filters.dateTo),
  };

  const responses = await prisma.response.findMany({
    where,
    include: {
      form: {
        select: {
          id: true,
          title: true,
          campaignId: true,
          campaign: { select: { name: true } },
        },
      },
      agent: { select: { name: true, agentCode: true, campaignId: true } },
      evaluator: { select: { name: true } },
      disposition: { select: { name: true, outcomeType: true, campaignId: true } },
      answers: {
        include: {
          question: {
            select: {
              label: true,
              formId: true,
              type: true,
              weight: true,
              fatal: true,
              criticalType: true,
              requiresCommentOnFail: true,
            },
          },
          category: { select: { id: true, name: true, systemColor: true, systemIcon: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const reportableResponses = responses.filter(
    (response) =>
      response.agent.campaignId === response.form.campaignId &&
      (!response.disposition || response.disposition.campaignId === response.form.campaignId) &&
      response.answers.every((answer) => answer.question.formId === response.form.id),
  );

  const targetSettingsMap = await getTargetSettingsMap(
    reportableResponses.map((response) => response.form.campaignId),
  );

  return reportableResponses.map((r) => {
    const targets = targetSettingsMap.get(r.form.campaignId) ?? {
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
      fatalFailuresAllowed: 0,
    };
    const score = Number(r.score);

    return {
      id: r.id,
      campaignId: r.form.campaignId,
      campaignName: r.form.campaign.name,
      formTitle: r.form.title,
      agentName: r.agent.name,
      agentCode: r.agent.agentCode,
      evaluatorName: r.evaluator.name,
      formVersion: r.formVersion,
      dispositionName: r.disposition?.name ?? null,
      dispositionOutcome: r.disposition?.outcomeType ?? null,
      score,
      result: r.result,
      hasFatalFail: r.hasFatalFail,
      passThreshold: targets.passThreshold,
      targetPassRate: targets.targetPassRate,
      targetAvgScore: targets.targetAvgScore,
      targetDailyRate: targets.targetDailyRate,
      fatalFailuresAllowed: targets.fatalFailuresAllowed,
      passesThreshold: isPassingResponse(score, r.result, r.hasFatalFail, targets.passThreshold),
      scoreTargetDelta: round2(score - targets.targetAvgScore),
      createdAt: r.createdAt.toISOString(),
      answers: r.answers.map((a) => ({
        question: a.question.label,
        questionType: a.question.type,
        criticalType: a.question.criticalType,
        value: a.notApplicable ? "N/A" : a.value,
        category: a.category
          ? {
              id: a.category.id,
              name: a.category.name,
              color: a.category.systemColor,
              icon: a.category.systemIcon,
            }
          : null,
        score: a.score === null ? null : Number(a.score),
        comment: a.comment,
        isFatalFail: a.isFatalFail,
        notApplicable: a.notApplicable,
        questionWeight: a.question.weight,
        fatal: a.question.fatal,
        requiresCommentOnFail: a.question.requiresCommentOnFail,
      })),
    };
  });
}

// ─── Score distribution for charts ──────────────────

export async function getScoreDistribution(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(
    DASHBOARD_READ_PERMISSION,
    campaignId,
  );
  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThresholdForCampaign(campaignId);
  const integrityFilter = await getResponseIntegrityFilter(campaignFilter);
  const where = {
    form: campaignFilter,
    ...integrityFilter,
    ...dw,
    ...submittedResponseWhere(),
  };

  const responses = await prisma.response.findMany({
    where,
    select: { score: true },
  });

  // Dynamic buckets: two below the threshold, two above.
  // e.g. threshold=70 => [0..34], [35..69], [70..84], [85..100]
  const t = passThreshold;
  const midLow = Math.floor(t / 2);
  const midHigh = Math.floor(t + (100 - t) / 2);
  const buckets = [
    { range: `0-${midLow - 1}`, min: 0, max: midLow - 1, count: 0 },
    { range: `${midLow}-${t - 1}`, min: midLow, max: t - 1, count: 0 },
    { range: `${t}-${midHigh - 1}`, min: t, max: midHigh - 1, count: 0 },
    { range: `${midHigh}-100`, min: midHigh, max: 100, count: 0 },
  ];

  for (const r of responses) {
    const score = Number(r.score);
    const bucket = buckets.find((b) => score >= b.min && score <= b.max);
    if (bucket) bucket.count++;
  }

  return buckets.map((b) => ({ range: b.range, count: b.count }));
}

// ─── Campaign KPIs ─────────────────────────────────

async function getCampaignKpisForPermission(
  permission: CampaignPermissionKey,
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(permission, campaignId);
  const dw = dateWhere(dateFrom, dateTo);

  const campaigns = await prisma.campaign.findMany({
    where: campaignFilter.campaignId ? { id: campaignFilter.campaignId } : {},
    include: {
      forms: { select: { id: true } },
      agents: { where: { active: true }, select: { id: true } },
      _count: { select: { users: true } },
    },
  });

  const rangeDays = getRangeDays(dateFrom, dateTo);

  const results = await Promise.all(
    campaigns.map(async (campaign) => {
      const formIds = campaign.forms.map((f) => f.id);
      const targetSettings = await getTargetSettingsForCampaign(campaign.id);
      const relationScope = responseRelationScopeWhere(campaign.id);

      if (formIds.length === 0) {
        return {
          id: campaign.id,
          name: campaign.name,
          totalForms: 0,
          totalAgents: campaign.agents.length,
          totalEvaluators: campaign._count.users,
          totalEvaluations: 0,
          avgScore: 0,
          passRate: 0,
          dailyRate: 0,
          fatalFailCount: 0,
          ...targetSettings,
        };
      }

      const [evalCount, avgScore, passCount, fatalFailCount] = await Promise.all([
        prisma.response.count({
          where: {
            formId: { in: formIds },
            ...dw,
            ...submittedResponseWhere(),
            AND: [relationScope],
          },
        }),
        prisma.response.aggregate({
          where: {
            formId: { in: formIds },
            ...dw,
            ...submittedResponseWhere(),
            AND: [relationScope],
          },
          _avg: { score: true },
        }),
        prisma.response.count({
          where: {
            formId: { in: formIds },
            ...dw,
            ...passingResponseWhere(targetSettings.passThreshold),
            AND: [relationScope],
          },
        }),
        prisma.response.count({
          where: {
            formId: { in: formIds },
            ...dw,
            ...submittedResponseWhere(),
            hasFatalFail: true,
            AND: [relationScope],
          },
        }),
      ]);

      return {
        id: campaign.id,
        name: campaign.name,
        totalForms: formIds.length,
        totalAgents: campaign.agents.length,
        totalEvaluators: campaign._count.users,
        totalEvaluations: evalCount,
        avgScore: Math.round(Number(avgScore._avg.score ?? 0) * 100) / 100,
        passRate: evalCount > 0 ? Math.round((passCount / evalCount) * 100) : 0,
        dailyRate: round2(evalCount / rangeDays),
        fatalFailCount,
        ...targetSettings,
      };
    }),
  );

  return results;
}

export async function getDashboardCampaignKpis(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return getCampaignKpisForPermission(DASHBOARD_READ_PERMISSION, campaignId, dateFrom, dateTo);
}

export async function getCampaignKpis(campaignId?: string, dateFrom?: string, dateTo?: string) {
  return getCampaignKpisForPermission(KPI_READ_PERMISSION, campaignId, dateFrom, dateTo);
}

// ─── Score by Question (per campaign) ──────────────

export async function getScoreByQuestion(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const integrityFilter = await getResponseIntegrityFilter(campaignFilter);

  const answers = await prisma.answer.findMany({
    where: {
      notApplicable: false,
      question: { type: "RATING", form: campaignFilter },
      response: {
        form: campaignFilter,
        ...integrityFilter,
        ...dw,
        ...submittedResponseWhere(),
      },
    },
    include: {
      question: { select: { label: true, formId: true } },
      response: {
        select: {
          formId: true,
          form: { select: { campaignId: true } },
          agent: { select: { campaignId: true } },
          disposition: { select: { campaignId: true } },
        },
      },
    },
  });

  const questionMap = new Map<string, { total: number; count: number }>();
  for (const a of answers) {
    if (
      a.question.formId !== a.response.formId ||
      a.response.agent.campaignId !== a.response.form.campaignId ||
      (a.response.disposition && a.response.disposition.campaignId !== a.response.form.campaignId)
    ) {
      continue;
    }
    // Use the engine-computed per-answer score (already a 0-100 %, correct for
    // any rating scale / weighted options); skip non-scored answers.
    if (a.score === null || a.score === undefined) continue;
    const pct = Number(a.score);
    if (Number.isNaN(pct)) continue;
    const existing = questionMap.get(a.question.label) ?? { total: 0, count: 0 };
    existing.total += pct;
    existing.count++;
    questionMap.set(a.question.label, existing);
  }

  return Array.from(questionMap.entries())
    .map(([label, data]) => ({
      question: label,
      avgScore: Math.round((data.total / data.count) * 100) / 100,
      totalAnswers: data.count,
    }))
    .sort((a, b) => a.avgScore - b.avgScore); // worst first
}

// ─── QA Category Metrics ───────────────────────────

export async function getQACategoryMetrics(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const integrityFilter = await getResponseIntegrityFilter(campaignFilter);

  const answers = await prisma.answer.findMany({
    where: {
      notApplicable: false,
      categoryId: { not: null },
      question: { form: campaignFilter },
      response: {
        form: campaignFilter,
        ...integrityFilter,
        ...dw,
        ...submittedResponseWhere(),
      },
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          systemColor: true,
          systemIcon: true,
          visibleInKPIs: true,
        },
      },
      question: { select: { formId: true } },
      response: {
        select: {
          id: true,
          form: { select: { id: true, campaignId: true } },
          agent: { select: { campaignId: true } },
          disposition: { select: { campaignId: true } },
        },
      },
    },
  });

  const campaignIds = answers.map((answer) => answer.response.form.campaignId);
  const passThresholds = await getPassThresholdMap(campaignIds);

  return buildQACategoryMetrics(
    answers
      .filter(
        (answer) =>
          answer.category?.visibleInKPIs !== false &&
          Boolean(answer.category) &&
          answer.question.formId === answer.response.form.id &&
          answer.response.agent.campaignId === answer.response.form.campaignId &&
          (!answer.response.disposition ||
            answer.response.disposition.campaignId === answer.response.form.campaignId),
      )
      .map((answer) => ({
        responseId: answer.response.id,
        categoryId: answer.category?.id ?? answer.categoryId ?? "uncategorized",
        categoryName: answer.category?.name ?? "Sin categoria",
        categoryColor: answer.category?.systemColor ?? null,
        categoryIcon: answer.category?.systemIcon ?? null,
        score: answer.score === null ? null : Number(answer.score),
        passThreshold: passThresholds.get(answer.response.form.campaignId) ?? 70,
        isFatalFail: answer.isFatalFail,
        comment: answer.comment,
      })),
  );
}

// ─── Team Performance ─────────────────────────────

export async function getTeamPerformance(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);

  const teams = await prisma.team.findMany({
    where: campaignFilter,
    include: {
      agents: {
        where: { active: true },
        include: {
          responses: {
            where: { ...dw, ...submittedResponseWhere() },
            select: {
              score: true,
              result: true,
              hasFatalFail: true,
              form: { select: { campaignId: true } },
              disposition: { select: { campaignId: true } },
            },
          },
        },
      },
    },
  });
  const passThresholds = await getPassThresholdMap(teams.map((team) => team.campaignId));

  return teams
    .map((team) => {
      const passThreshold = passThresholds.get(team.campaignId) ?? 70;
      const agents = team.agents.filter((agent) => agent.campaignId === team.campaignId);
      const allResponses = agents.flatMap((agent) =>
        agent.responses.filter(
          (response) =>
            response.form.campaignId === team.campaignId &&
            (!response.disposition || response.disposition.campaignId === team.campaignId),
        ),
      );
      const allScores = allResponses.map((response) => Number(response.score));
      const total = allScores.length;
      const avg = total > 0 ? allScores.reduce((a, b) => a + b, 0) / total : 0;
      const passCount = allResponses.filter((response) =>
        isPassingResponse(
          Number(response.score),
          response.result,
          response.hasFatalFail,
          passThreshold,
        ),
      ).length;

      return {
        id: team.id,
        name: team.name,
        agentCount: agents.length,
        evalCount: total,
        avgScore: Math.round(avg * 100) / 100,
        passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
      };
    })
    .filter((t) => t.evalCount > 0)
    .sort((a, b) => b.avgScore - a.avgScore);
}

// ─── Disposition Analytics ────────────────────────

async function getDispositionAnalyticsForPermission(
  permission: CampaignPermissionKey,
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(permission, campaignId);
  const dw = dateWhere(dateFrom, dateTo);

  const dispositions = await prisma.disposition.findMany({
    where: { ...campaignFilter, active: true },
    include: {
      category: { select: { name: true, campaignId: true } },
      responses: {
        where: { ...dw, ...submittedResponseWhere() },
        select: {
          score: true,
          result: true,
          hasFatalFail: true,
          form: { select: { campaignId: true } },
          agent: { select: { campaignId: true } },
        },
      },
    },
  });
  const passThresholds = await getPassThresholdMap(
    dispositions.map((disposition) => disposition.campaignId),
  );

  return dispositions
    .filter((disposition) =>
      disposition.category ? disposition.category.campaignId === disposition.campaignId : true,
    )
    .map((d) => {
      const passThreshold = passThresholds.get(d.campaignId) ?? 70;
      const responses = d.responses.filter(
        (response) =>
          response.form.campaignId === d.campaignId && response.agent.campaignId === d.campaignId,
      );
      const scores = responses.map((r) => Number(r.score));
      const total = scores.length;
      const avg = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
      const passCount = responses.filter((response) =>
        isPassingResponse(
          Number(response.score),
          response.result,
          response.hasFatalFail,
          passThreshold,
        ),
      ).length;

      return {
        id: d.id,
        name: d.name,
        code: d.code,
        categoryName: d.category?.name ?? null,
        totalEvaluations: total,
        avgScore: Math.round(avg * 100) / 100,
        passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
      };
    })
    .filter((d) => d.totalEvaluations > 0)
    .sort((a, b) => b.totalEvaluations - a.totalEvaluations);
}

export async function getDashboardDispositionAnalytics(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return getDispositionAnalyticsForPermission(
    DASHBOARD_READ_PERMISSION,
    campaignId,
    dateFrom,
    dateTo,
  );
}

export async function getDispositionAnalytics(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return getDispositionAnalyticsForPermission(KPI_READ_PERMISSION, campaignId, dateFrom, dateTo);
}

/**
 * Call-outcome KPIs derived from `Disposition.outcomeType` (COPC vocabulary):
 * Resolution Rate (FCR) and Escalation Rate over classified evaluations.
 * FCR excludes transfers/escalations by definition (only RESOLVED counts).
 */
export async function getDashboardOutcomeKpis(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const formFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const integrityFilter = await getResponseIntegrityFilter(formFilter);
  const base = {
    form: formFilter,
    ...integrityFilter,
    ...dw,
    ...submittedResponseWhere(),
  };
  const empty = {
    classifiedTotal: 0,
    resolved: 0,
    escalated: 0,
    resolutionRate: 0,
    escalationRate: 0,
  };

  try {
    const [classifiedTotal, resolved, escalated] = await Promise.all([
      prisma.response.count({ where: { ...base, disposition: { outcomeType: { not: null } } } }),
      prisma.response.count({ where: { ...base, disposition: { outcomeType: "RESOLVED" } } }),
      prisma.response.count({ where: { ...base, disposition: { outcomeType: "ESCALATED" } } }),
    ]);

    return {
      classifiedTotal,
      resolved,
      escalated,
      resolutionRate: classifiedTotal > 0 ? round2((resolved / classifiedTotal) * 100) : 0,
      escalationRate: classifiedTotal > 0 ? round2((escalated / classifiedTotal) * 100) : 0,
    };
  } catch {
    // `outcomeType` may be missing if the DB/Prisma client hasn't been migrated
    // yet — never let a KPI take down the whole dashboard.
    return empty;
  }
}

// ─── Agent Detail (drill-down) ────────────────────

type CoachingSeverity = "CRITICAL" | "WARNING" | "INFO";

function compareSeverity(a: CoachingSeverity, b: CoachingSeverity) {
  const rank: Record<CoachingSeverity, number> = { CRITICAL: 3, WARNING: 2, INFO: 1 };
  return rank[b] - rank[a];
}

function getCoachingSeverity(args: {
  avgScore: number;
  passRate: number;
  trendDelta: number;
  fatalFailCount: number;
  passThreshold: number;
  targetAvgScore: number;
  targetPassRate: number;
}): CoachingSeverity {
  if (
    args.fatalFailCount > 0 ||
    args.avgScore < args.passThreshold ||
    args.passRate < args.targetPassRate - 15
  ) {
    return "CRITICAL" satisfies CoachingSeverity;
  }

  if (
    args.avgScore < args.targetAvgScore ||
    args.passRate < args.targetPassRate ||
    args.trendDelta <= -5
  ) {
    return "WARNING" satisfies CoachingSeverity;
  }

  return "INFO" satisfies CoachingSeverity;
}

function buildCoachingReason(args: {
  avgScore: number;
  passRate: number;
  trendDelta: number;
  fatalFailCount: number;
  targetAvgScore: number;
  targetPassRate: number;
}) {
  const reasons: string[] = [];
  if (args.fatalFailCount > 0) reasons.push(`${args.fatalFailCount} falla(s) fatal(es)`);
  if (args.avgScore < args.targetAvgScore) {
    reasons.push(`${round2(args.targetAvgScore - args.avgScore)} pts bajo target de score`);
  }
  if (args.passRate < args.targetPassRate) {
    reasons.push(`${round2(args.targetPassRate - args.passRate)} pts bajo target de pass rate`);
  }
  if (args.trendDelta <= -5) reasons.push(`tendencia reciente ${args.trendDelta.toFixed(1)} pts`);
  return reasons.join(" · ") || "Dentro de target";
}

export async function getDashboardCoachingInsights(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(
    DASHBOARD_READ_PERMISSION,
    campaignId,
  );
  const dw = dateWhere(dateFrom, dateTo);
  const campaignIds = await getCampaignIdsForFilter(campaignFilter);
  const integrityFilter: Prisma.ResponseWhereInput =
    campaignIds.length > 0
      ? { OR: campaignIds.map(responseRelationScopeWhere) }
      : { id: { in: [] } };

  const [campaignKpis, agents, answers] = await Promise.all([
    getDashboardCampaignKpis(campaignId, dateFrom, dateTo),
    prisma.agent.findMany({
      where: { ...campaignFilter, active: true },
      include: {
        campaign: { select: { name: true } },
        responses: {
          where: { ...integrityFilter, ...dw, ...submittedResponseWhere() },
          select: {
            score: true,
            result: true,
            hasFatalFail: true,
            createdAt: true,
            form: { select: { campaignId: true } },
            disposition: { select: { campaignId: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 30,
        },
      },
    }),
    prisma.answer.findMany({
      where: {
        categoryId: { not: null },
        notApplicable: false,
        question: { form: campaignFilter },
        response: {
          form: campaignFilter,
          ...integrityFilter,
          ...dw,
          ...submittedResponseWhere(),
        },
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            systemColor: true,
            visibleInDashboard: true,
          },
        },
        question: { select: { formId: true } },
        response: {
          select: {
            agentId: true,
            form: { select: { id: true, campaignId: true } },
            agent: { select: { campaignId: true } },
            disposition: { select: { campaignId: true } },
          },
        },
      },
    }),
  ]);

  const settingsMap = await getTargetSettingsMap(campaignIds);

  const agentRisks = agents
    .map((agent) => {
      const settings = settingsMap.get(agent.campaignId) ?? {
        passThreshold: 70,
        targetPassRate: 85,
        targetAvgScore: 80,
        targetDailyRate: 20,
        fatalFailuresAllowed: 0,
      };
      const responses = agent.responses.filter(
        (response) =>
          response.form.campaignId === agent.campaignId &&
          (!response.disposition || response.disposition.campaignId === agent.campaignId),
      );
      const scores = responses.map((response) => Number(response.score));
      const totalEvaluations = scores.length;
      if (totalEvaluations === 0) return null;

      const avgScore = round2(scores.reduce((sum, score) => sum + score, 0) / totalEvaluations);
      const passCount = responses.filter((response) =>
        isPassingResponse(
          Number(response.score),
          response.result,
          response.hasFatalFail,
          settings.passThreshold,
        ),
      ).length;
      const passRate = totalEvaluations > 0 ? round2((passCount / totalEvaluations) * 100) : 0;
      const fatalFailCount = responses.filter((response) => response.hasFatalFail).length;
      const recentScores = scores.slice(0, 5);
      const previousScores = scores.slice(5, 10);
      const recentAvg =
        recentScores.length > 0
          ? recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length
          : avgScore;
      const previousAvg =
        previousScores.length > 0
          ? previousScores.reduce((sum, score) => sum + score, 0) / previousScores.length
          : recentAvg;
      const trendDelta = round2(recentAvg - previousAvg);
      const severity = getCoachingSeverity({
        avgScore,
        passRate,
        trendDelta,
        fatalFailCount,
        passThreshold: settings.passThreshold,
        targetAvgScore: settings.targetAvgScore,
        targetPassRate: settings.targetPassRate,
      });

      return {
        id: agent.id,
        name: agent.name,
        agentCode: agent.agentCode,
        campaignName: agent.campaign.name,
        totalEvaluations,
        avgScore,
        passRate,
        trendDelta,
        fatalFailCount,
        severity,
        reason: buildCoachingReason({
          avgScore,
          passRate,
          trendDelta,
          fatalFailCount,
          targetAvgScore: settings.targetAvgScore,
          targetPassRate: settings.targetPassRate,
        }),
        href: `/analytics/agents/${agent.id}`,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.severity !== "INFO")
    .sort((a, b) => compareSeverity(a.severity, b.severity) || a.avgScore - b.avgScore)
    .slice(0, 8);

  const categoryMap = new Map<
    string,
    {
      id: string;
      name: string;
      color: string | null;
      totalScore: number;
      scoredCount: number;
      totalAnswers: number;
      fatalFailCount: number;
      affectedAgents: Set<string>;
      campaignIds: Set<string>;
    }
  >();

  for (const answer of answers) {
    if (
      !answer.category?.visibleInDashboard ||
      answer.question.formId !== answer.response.form.id ||
      answer.response.agent.campaignId !== answer.response.form.campaignId ||
      (answer.response.disposition &&
        answer.response.disposition.campaignId !== answer.response.form.campaignId)
    ) {
      continue;
    }
    const entry = categoryMap.get(answer.category.id) ?? {
      id: answer.category.id,
      name: answer.category.name,
      color: answer.category.systemColor,
      totalScore: 0,
      scoredCount: 0,
      totalAnswers: 0,
      fatalFailCount: 0,
      affectedAgents: new Set<string>(),
      campaignIds: new Set<string>(),
    };

    entry.totalAnswers++;
    entry.affectedAgents.add(answer.response.agentId);
    entry.campaignIds.add(answer.response.form.campaignId);
    if (answer.score !== null) {
      entry.totalScore += Number(answer.score);
      entry.scoredCount++;
    }
    if (answer.isFatalFail) entry.fatalFailCount++;
    categoryMap.set(answer.category.id, entry);
  }

  const categoryOpportunities = Array.from(categoryMap.values())
    .map((category) => {
      const avgScore =
        category.scoredCount > 0 ? round2(category.totalScore / category.scoredCount) : 0;
      const targetAvg =
        Array.from(category.campaignIds)
          .map((id) => settingsMap.get(id)?.targetAvgScore ?? 80)
          .reduce((sum, target) => sum + target, 0) / Math.max(category.campaignIds.size, 1);
      const severity: CoachingSeverity =
        category.fatalFailCount > 0 || avgScore < targetAvg - 15
          ? "CRITICAL"
          : avgScore < targetAvg
            ? "WARNING"
            : "INFO";

      return {
        id: category.id,
        name: category.name,
        color: category.color,
        totalAnswers: category.totalAnswers,
        avgScore,
        fatalFailCount: category.fatalFailCount,
        affectedAgents: category.affectedAgents.size,
        severity,
        reason:
          severity === "INFO"
            ? "Dentro de target"
            : `${round2(targetAvg - avgScore)} pts bajo target en ${category.affectedAgents.size} agente(s)`,
      };
    })
    .filter((category) => category.severity !== "INFO")
    .sort((a, b) => compareSeverity(a.severity, b.severity) || a.avgScore - b.avgScore)
    .slice(0, 6);

  const campaignRisks = campaignKpis
    .map((campaign) => {
      // Campaigns with no evaluations are "sin datos", not a risk — don't flag them
      // (otherwise their zeroed metrics crowd "Necesita atención" with useless chips).
      if (campaign.totalEvaluations === 0) return null;
      const missedTargets = [
        campaign.avgScore < campaign.targetAvgScore ? "score" : null,
        campaign.passRate < campaign.targetPassRate ? "pass rate" : null,
        campaign.dailyRate < campaign.targetDailyRate ? "volumen diario" : null,
        campaign.fatalFailCount > campaign.fatalFailuresAllowed ? "fallas fatales" : null,
      ].filter((target): target is string => Boolean(target));

      if (missedTargets.length === 0) return null;

      return {
        id: campaign.id,
        name: campaign.name,
        avgScore: campaign.avgScore,
        passRate: campaign.passRate,
        dailyRate: campaign.dailyRate,
        fatalFailCount: campaign.fatalFailCount,
        missedTargets,
        severity:
          campaign.fatalFailCount > campaign.fatalFailuresAllowed ||
          campaign.avgScore < campaign.passThreshold
            ? ("CRITICAL" as CoachingSeverity)
            : ("WARNING" as CoachingSeverity),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => compareSeverity(a.severity, b.severity));

  return {
    summary: {
      criticalCount:
        agentRisks.filter((item) => item.severity === "CRITICAL").length +
        categoryOpportunities.filter((item) => item.severity === "CRITICAL").length +
        campaignRisks.filter((item) => item.severity === "CRITICAL").length,
      warningCount:
        agentRisks.filter((item) => item.severity === "WARNING").length +
        categoryOpportunities.filter((item) => item.severity === "WARNING").length +
        campaignRisks.filter((item) => item.severity === "WARNING").length,
      generatedAt: new Date().toISOString(),
    },
    agentRisks,
    categoryOpportunities,
    campaignRisks,
  };
}

// ─── Critical Error Accuracy — CEA (COPC 2.7.1.d) ──

const DEFAULT_CEA_TARGETS = { CUSTOMER: 95, BUSINESS: 90, COMPLIANCE: 99.5 } as const;
type CriticalFamily = keyof typeof DEFAULT_CEA_TARGETS;
const CRITICAL_FAMILIES: CriticalFamily[] = ["CUSTOMER", "BUSINESS", "COMPLIANCE"];

async function getCeaTargetsForCampaign(
  campaignId?: string,
): Promise<Record<CriticalFamily, number>> {
  if (!campaignId) return { ...DEFAULT_CEA_TARGETS };
  // Scoring configuration is authoritative. Storage/schema failures surface instead of
  // silently changing evaluation semantics during a rolling deployment.
  const settings = await getCampaignScoringSettings(campaignId);
  return {
    CUSTOMER: settings.customerCeaTarget,
    BUSINESS: settings.businessCeaTarget,
    COMPLIANCE: settings.complianceCeaTarget,
  };
}

/**
 * Transaction-level Critical Error Accuracy per family (Customer/Business/Compliance).
 * A response "fails" a family when it has any fatal-fail answer whose question carries that
 * criticalType. accuracy = (responses with a family question − responses that failed it) / …
 * Degrades to `configured=false` ("no configurado") when a scope has no such questions.
 */
export async function getCriticalErrorAccuracy(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const visibleCampaignIds = await getCampaignIdsForFilter(campaignFilter);
  const relationScopes = visibleCampaignIds.map(responseRelationScopeWhere);
  const responseWhere: Prisma.ResponseWhereInput = {
    form: campaignFilter,
    ...dw,
    ...submittedResponseWhere(),
    ...(relationScopes.length > 0 ? { OR: relationScopes } : { id: { in: [] } }),
  };

  const [answers, targets] = await Promise.all([
    prisma.answer.findMany({
      where: {
        notApplicable: false,
        question: { fatal: true, criticalType: { not: null }, form: campaignFilter },
        response: responseWhere,
      },
      select: {
        responseId: true,
        isFatalFail: true,
        question: { select: { criticalType: true, formId: true } },
        response: {
          select: {
            form: { select: { id: true, campaignId: true } },
            agent: { select: { campaignId: true } },
            disposition: { select: { campaignId: true } },
          },
        },
      },
    }),
    getCeaTargetsForCampaign(campaignId),
  ]);

  const perFamily = new Map<CriticalFamily, { responses: Set<string>; failed: Set<string> }>();
  for (const family of CRITICAL_FAMILIES) {
    perFamily.set(family, { responses: new Set(), failed: new Set() });
  }
  for (const answer of answers) {
    if (
      answer.question.formId !== answer.response.form.id ||
      answer.response.agent.campaignId !== answer.response.form.campaignId ||
      (answer.response.disposition &&
        answer.response.disposition.campaignId !== answer.response.form.campaignId)
    ) {
      continue;
    }
    const family = answer.question.criticalType as CriticalFamily | null;
    if (!family) continue;
    const entry = perFamily.get(family);
    if (!entry) continue;
    entry.responses.add(answer.responseId);
    if (answer.isFatalFail) entry.failed.add(answer.responseId);
  }

  return CRITICAL_FAMILIES.map((family) => {
    const entry = perFamily.get(family) ?? { responses: new Set(), failed: new Set() };
    const applicable = entry.responses.size;
    const failedCount = entry.failed.size;
    const configured = applicable > 0;
    const accuracy = configured ? round2(((applicable - failedCount) / applicable) * 100) : null;
    const target = targets[family];
    const status: "en objetivo" | "en riesgo" | "bajo benchmark" | "no configurado" = !configured
      ? "no configurado"
      : (accuracy as number) >= target
        ? "en objetivo"
        : (accuracy as number) >= target - 2
          ? "en riesgo"
          : "bajo benchmark";
    return { family, applicable, failedCount, accuracy, target, status, configured };
  });
}

// ─── "Mi trabajo" — evaluator self-scoped dashboard ─

/**
 * Self-scoped stats for the logged-in evaluator (evaluatorId = session user).
 * Never exposes peers: every metric and agent score is derived only from
 * evaluations created by the current user.
 */
export async function getMyDashboard(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  const userId = session.user.id;

  const campaignFilter = await getCampaignFilterForPermission(SELF_DASHBOARD_READ_PERMISSION);
  const dw = dateWhere(dateFrom, dateTo);
  const integrityFilter = await getResponseIntegrityFilter(campaignFilter);
  const rangeDays = getRangeDays(dateFrom, dateTo);
  const globalSettings = await getSettings();
  const passThreshold = globalSettings.passThreshold;
  const targetAvgScore = globalSettings.targetAvgScore;

  const myWhere = {
    evaluatorId: userId,
    form: campaignFilter,
    ...integrityFilter,
    ...dw,
    ...submittedResponseWhere(),
  };

  const queriedResponses = await prisma.response.findMany({
    where: myWhere,
    select: {
      id: true,
      score: true,
      result: true,
      hasFatalFail: true,
      createdAt: true,
      agent: { select: { id: true, name: true, agentCode: true, campaignId: true } },
      disposition: { select: { campaignId: true } },
      form: {
        select: {
          title: true,
          campaignId: true,
          campaign: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const responses = queriedResponses.filter(
    (response) =>
      response.agent.campaignId === response.form.campaignId &&
      (!response.disposition || response.disposition.campaignId === response.form.campaignId),
  );
  const responseCampaignIds = responses.map((response) => response.form.campaignId);
  const [passThresholds, targetSettings] = await Promise.all([
    getPassThresholdMap(responseCampaignIds),
    getTargetSettingsMap(responseCampaignIds),
  ]);

  const scores = responses.map((r) => Number(r.score));
  const evaluations = scores.length;
  const avgScore = evaluations > 0 ? round2(scores.reduce((a, b) => a + b, 0) / evaluations) : 0;
  const fatalCount = responses.filter((r) => r.hasFatalFail).length;
  const variance =
    evaluations > 1 ? scores.reduce((sum, s) => sum + (s - avgScore) ** 2, 0) / evaluations : 0;
  const stdDev = round2(Math.sqrt(variance));
  const dayMap = new Map<string, number>();
  for (const r of responses) {
    const day = r.createdAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const trend = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const midLow = Math.floor(passThreshold / 2);
  const midHigh = Math.floor(passThreshold + (100 - passThreshold) / 2);
  const buckets = [
    { range: `0-${midLow - 1}`, min: 0, max: midLow - 1, count: 0 },
    { range: `${midLow}-${passThreshold - 1}`, min: midLow, max: passThreshold - 1, count: 0 },
    { range: `${passThreshold}-${midHigh - 1}`, min: passThreshold, max: midHigh - 1, count: 0 },
    { range: `${midHigh}-100`, min: midHigh, max: 100, count: 0 },
  ];
  for (const s of scores) {
    const b = buckets.find((x) => s >= x.min && s <= x.max);
    if (b) b.count++;
  }

  const recentActivity = responses.slice(0, 8).map((r) => ({
    id: r.id,
    agentName: r.agent.name,
    formTitle: r.form.title,
    score: Number(r.score),
    result: isPassingResponse(
      Number(r.score),
      r.result,
      r.hasFatalFail,
      passThresholds.get(r.form.campaignId) ?? passThreshold,
    )
      ? "PASS"
      : "FAIL",
    createdAt: r.createdAt.toISOString(),
  }));

  const myAgentScores = new Map<
    string,
    {
      id: string;
      name: string;
      agentCode: string | null;
      campaignId: string;
      campaignName: string;
      scores: number[];
    }
  >();
  for (const response of responses) {
    const entry = myAgentScores.get(response.agent.id) ?? {
      id: response.agent.id,
      name: response.agent.name,
      agentCode: response.agent.agentCode,
      campaignId: response.form.campaignId,
      campaignName: response.form.campaign.name,
      scores: [],
    };
    entry.scores.push(Number(response.score));
    myAgentScores.set(entry.id, entry);
  }

  const agentsBelowTarget = Array.from(myAgentScores.values())
    .map((agent) => {
      return {
        id: agent.id,
        name: agent.name,
        agentCode: agent.agentCode,
        campaignId: agent.campaignId,
        campaignName: agent.campaignName,
        avgScore: round2(agent.scores.reduce((sum, score) => sum + score, 0) / agent.scores.length),
      };
    })
    .filter(
      (agent) =>
        agent.avgScore < (targetSettings.get(agent.campaignId)?.targetAvgScore ?? targetAvgScore),
    )
    .sort((a, b) => a.avgScore - b.avgScore)
    .slice(0, 5);

  return {
    evaluations,
    avgScore,
    fatalCount,
    dailyRate: round2(evaluations / rangeDays),
    passThreshold,
    targetAvgScore,
    stdDev,
    calibrationTolerance: 8,
    trend,
    distribution: buckets.map((b) => ({ range: b.range, count: b.count })),
    recentActivity,
    agentsBelowTarget,
  };
}

/**
 * Deep CEA breakdown for the KPIs surface: overall + per campaign + per agent (worst first)
 * + trend over time, all transaction-level per critical family. Single answer scan, grouped
 * in memory. Degrades to configured=false when no criticalType questions exist in scope.
 */
export async function getCriticalErrorAccuracyDetail(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const targets = await getCeaTargetsForCampaign(campaignId);
  const visibleCampaignIds = await getCampaignIdsForFilter(campaignFilter);
  const relationScopes = visibleCampaignIds.map(responseRelationScopeWhere);
  const responseWhere: Prisma.ResponseWhereInput = {
    form: campaignFilter,
    ...dw,
    ...submittedResponseWhere(),
    ...(relationScopes.length > 0 ? { OR: relationScopes } : { id: { in: [] } }),
  };

  const answers = await prisma.answer.findMany({
    where: {
      notApplicable: false,
      question: { fatal: true, criticalType: { not: null }, form: campaignFilter },
      response: responseWhere,
    },
    select: {
      responseId: true,
      isFatalFail: true,
      question: { select: { criticalType: true, formId: true } },
      response: {
        select: {
          agentId: true,
          createdAt: true,
          agent: { select: { name: true, agentCode: true, campaignId: true } },
          disposition: { select: { campaignId: true } },
          form: {
            select: { id: true, campaignId: true, campaign: { select: { name: true } } },
          },
        },
      },
    },
  });

  type FamSets = Record<CriticalFamily, { resp: Set<string>; failed: Set<string> }>;
  const newFam = (): FamSets => ({
    CUSTOMER: { resp: new Set(), failed: new Set() },
    BUSINESS: { resp: new Set(), failed: new Set() },
    COMPLIANCE: { resp: new Set(), failed: new Set() },
  });
  const acc = (s: { resp: Set<string>; failed: Set<string> }): number | null =>
    s.resp.size === 0 ? null : round2(((s.resp.size - s.failed.size) / s.resp.size) * 100);
  const famAccuracies = (f: FamSets) => ({
    CUSTOMER: acc(f.CUSTOMER),
    BUSINESS: acc(f.BUSINESS),
    COMPLIANCE: acc(f.COMPLIANCE),
  });

  const overall = newFam();
  const byCampaignMap = new Map<string, { name: string; fam: FamSets }>();
  const byAgentMap = new Map<string, { name: string; agentCode: string | null; fam: FamSets }>();
  const byDayMap = new Map<string, FamSets>();

  for (const a of answers) {
    if (
      a.question.formId !== a.response.form.id ||
      a.response.agent.campaignId !== a.response.form.campaignId ||
      (a.response.disposition && a.response.disposition.campaignId !== a.response.form.campaignId)
    ) {
      continue;
    }
    const family = a.question.criticalType as CriticalFamily | null;
    if (!family) continue;
    const rid = a.responseId;
    const cid = a.response.form.campaignId;
    const aid = a.response.agentId;
    const day = a.response.createdAt.toISOString().slice(0, 10);
    const add = (f: FamSets) => {
      f[family].resp.add(rid);
      if (a.isFatalFail) f[family].failed.add(rid);
    };
    add(overall);
    const camp = byCampaignMap.get(cid) ?? { name: a.response.form.campaign.name, fam: newFam() };
    add(camp.fam);
    byCampaignMap.set(cid, camp);
    const ag = byAgentMap.get(aid) ?? {
      name: a.response.agent.name,
      agentCode: a.response.agent.agentCode,
      fam: newFam(),
    };
    add(ag.fam);
    byAgentMap.set(aid, ag);
    const dd = byDayMap.get(day) ?? newFam();
    add(dd);
    byDayMap.set(day, dd);
  }

  const overallList = CRITICAL_FAMILIES.map((family) => {
    const s = overall[family];
    const applicable = s.resp.size;
    const configured = applicable > 0;
    const accuracy = acc(s);
    const target = targets[family];
    const status: "en objetivo" | "en riesgo" | "bajo benchmark" | "no configurado" = !configured
      ? "no configurado"
      : (accuracy as number) >= target
        ? "en objetivo"
        : (accuracy as number) >= target - 2
          ? "en riesgo"
          : "bajo benchmark";
    return { family, applicable, failedCount: s.failed.size, accuracy, target, status, configured };
  });

  const byCampaign = Array.from(byCampaignMap.entries()).map(([id, v]) => ({
    id,
    name: v.name,
    ...famAccuracies(v.fam),
  }));

  const byAgent = Array.from(byAgentMap.entries())
    .map(([id, v]) => {
      const fa = famAccuracies(v.fam);
      const configured = [fa.CUSTOMER, fa.BUSINESS, fa.COMPLIANCE].filter(
        (x): x is number => x !== null,
      );
      const worst = configured.length ? Math.min(...configured) : null;
      return { id, name: v.name, agentCode: v.agentCode, ...fa, worst };
    })
    .filter((a): a is typeof a & { worst: number } => a.worst !== null)
    .sort((a, b) => a.worst - b.worst)
    .slice(0, 10);

  const trend = Array.from(byDayMap.entries())
    .map(([date, f]) => ({ date, ...famAccuracies(f) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    configured: overallList.some((o) => o.configured),
    targets: {
      CUSTOMER: targets.CUSTOMER,
      BUSINESS: targets.BUSINESS,
      COMPLIANCE: targets.COMPLIANCE,
    },
    overall: overallList,
    byCampaign,
    byAgent,
    trend,
  };
}

export async function getAgentDetail(agentId: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const dw = dateWhere(dateFrom, dateTo);

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      campaign: { select: { name: true } },
      team: { select: { name: true, campaignId: true } },
      responses: {
        where: { ...dw, ...submittedResponseWhere() },
        include: {
          form: { select: { id: true, title: true, campaignId: true } },
          evaluator: { select: { id: true, name: true } },
          disposition: { select: { id: true, name: true, campaignId: true } },
          answers: {
            include: { question: { select: { label: true, type: true, formId: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!agent) throw new Error("Agente no encontrado");
  await assertCampaignPermissionForUser(session.user, agent.campaignId, KPI_READ_PERMISSION);
  const passThreshold = await getPassThresholdForCampaign(agent.campaignId);
  const responses = agent.responses.filter(
    (response) =>
      response.form.campaignId === agent.campaignId &&
      (!response.disposition || response.disposition.campaignId === agent.campaignId) &&
      response.answers.every((answer) => answer.question.formId === response.form.id),
  );

  // Score trend (daily)
  const dayMap = new Map<string, { total: number; count: number }>();
  for (const r of responses) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const ex = dayMap.get(day) ?? { total: 0, count: 0 };
    ex.total += Number(r.score);
    ex.count++;
    dayMap.set(day, ex);
  }
  const scoreTrend = Array.from(dayMap.entries())
    .map(([date, d]) => ({ date, avgScore: Math.round((d.total / d.count) * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Score by question (RATING only). Uses the engine-computed per-answer score
  // (already a 0-100 %, correct for any rating scale) instead of value/5.
  const questionMap = new Map<string, { total: number; count: number }>();
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.question.type !== "RATING" || a.notApplicable || a.score === null) continue;
      const pct = Number(a.score);
      if (Number.isNaN(pct)) continue;
      const ex = questionMap.get(a.question.label) ?? { total: 0, count: 0 };
      ex.total += pct;
      ex.count++;
      questionMap.set(a.question.label, ex);
    }
  }
  const scoreByQuestion = Array.from(questionMap.entries())
    .map(([question, d]) => ({
      question,
      avgScore: Math.round((d.total / d.count) * 100) / 100,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // Disposition breakdown
  const dispMap = new Map<string, { name: string; count: number; totalScore: number }>();
  for (const r of responses) {
    if (!r.disposition) continue;
    const ex = dispMap.get(r.disposition.id) ?? {
      name: r.disposition.name,
      count: 0,
      totalScore: 0,
    };
    ex.count++;
    ex.totalScore += Number(r.score);
    dispMap.set(r.disposition.id, ex);
  }
  const dispositionBreakdown = Array.from(dispMap.values())
    .map((d) => ({
      name: d.name,
      count: d.count,
      avgScore: Math.round((d.totalScore / d.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Evaluators
  const evalMap = new Map<string, { name: string; count: number; avgScore: number }>();
  for (const r of responses) {
    const ex = evalMap.get(r.evaluator.id) ?? { name: r.evaluator.name, count: 0, avgScore: 0 };
    ex.count++;
    ex.avgScore += Number(r.score);
    evalMap.set(r.evaluator.id, ex);
  }
  const evaluators = Array.from(evalMap.entries())
    .map(([id, d]) => ({
      id,
      name: d.name,
      count: d.count,
      avgScore: Math.round((d.avgScore / d.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Recent responses (last 10)
  const recentResponses = responses.slice(0, 10).map((r) => ({
    id: r.id,
    formTitle: r.form.title,
    evaluatorName: r.evaluator.name,
    dispositionName: r.disposition?.name ?? null,
    score: Number(r.score),
    result: isPassingResponse(Number(r.score), r.result, r.hasFatalFail, passThreshold)
      ? ("PASS" as const)
      : ("FAIL" as const),
    createdAt: r.createdAt.toISOString(),
  }));

  const allScores = responses.map((r) => Number(r.score));
  const avgScore =
    allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  return {
    name: agent.name,
    agentCode: agent.agentCode,
    campaignName: agent.campaign.name,
    teamName: agent.team?.campaignId === agent.campaignId ? agent.team.name : null,
    totalEvaluations: responses.length,
    avgScore: Math.round(avgScore * 100) / 100,
    passThreshold,
    scoreTrend,
    scoreByQuestion,
    dispositionBreakdown,
    evaluators,
    recentResponses,
  };
}

// ─── Evaluator Detail (drill-down) ────────────────

export async function getEvaluatorDetail(userId: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION);
  const dw = dateWhere(dateFrom, dateTo);
  const integrityFilter = await getResponseIntegrityFilter(campaignFilter);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) throw new Error("Evaluador no encontrado");

  if (session.user.role !== "ADMIN") {
    const visibilityCandidates = await prisma.response.findMany({
      where: {
        evaluatorId: userId,
        form: campaignFilter,
        ...integrityFilter,
        ...submittedResponseWhere(),
      },
      select: {
        form: { select: { campaignId: true } },
        agent: { select: { campaignId: true } },
        disposition: { select: { campaignId: true } },
      },
    });
    const hasVisibleResponse = visibilityCandidates.some(
      (response) =>
        response.agent.campaignId === response.form.campaignId &&
        (!response.disposition || response.disposition.campaignId === response.form.campaignId),
    );

    if (!hasVisibleResponse) throw new Error("Evaluador no encontrado");
  }

  const queriedResponses = await prisma.response.findMany({
    where: {
      evaluatorId: userId,
      form: campaignFilter,
      ...integrityFilter,
      ...dw,
      ...submittedResponseWhere(),
    },
    include: {
      form: { select: { campaignId: true } },
      agent: { select: { id: true, name: true, campaignId: true } },
      disposition: { select: { name: true, campaignId: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const responses = queriedResponses.filter(
    (response) =>
      response.agent.campaignId === response.form.campaignId &&
      (!response.disposition || response.disposition.campaignId === response.form.campaignId),
  );

  // Activity by day
  const dayMap = new Map<string, number>();
  for (const r of responses) {
    const day = r.createdAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const activityByDay = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Agents evaluated
  const agentMap = new Map<
    string,
    { id: string; name: string; count: number; totalScore: number }
  >();
  for (const r of responses) {
    const ex = agentMap.get(r.agent.id) ?? {
      id: r.agent.id,
      name: r.agent.name,
      count: 0,
      totalScore: 0,
    };
    ex.count++;
    ex.totalScore += Number(r.score);
    agentMap.set(r.agent.id, ex);
  }
  const agentsEvaluated = Array.from(agentMap.values())
    .map((a) => ({ ...a, avgScore: Math.round((a.totalScore / a.count) * 100) / 100 }))
    .sort((a, b) => b.count - a.count);

  // Disposition frequency
  const dispMap = new Map<string, number>();
  for (const r of responses) {
    if (r.disposition) dispMap.set(r.disposition.name, (dispMap.get(r.disposition.name) ?? 0) + 1);
  }
  const dispositionFrequency = Array.from(dispMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Calibration: this evaluator's avg vs global avg
  const allScores = responses.map((r) => Number(r.score));
  const myAvg = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  const globalAvg = await prisma.response.aggregate({
    where: {
      form: campaignFilter,
      ...integrityFilter,
      ...dw,
      ...submittedResponseWhere(),
    },
    _avg: { score: true },
  });

  return {
    name: user.name,
    email: user.email,
    role: user.role,
    totalEvaluations: responses.length,
    avgScore: Math.round(myAvg * 100) / 100,
    globalAvgScore: Math.round(Number(globalAvg._avg.score ?? 0) * 100) / 100,
    calibrationDelta: Math.round((myAvg - Number(globalAvg._avg.score ?? 0)) * 100) / 100,
    activityByDay,
    agentsEvaluated,
    dispositionFrequency,
  };
}

// ─── Team Detail (drill-down) ─────────────────────

export async function getTeamDetail(teamId: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const dw = dateWhere(dateFrom, dateTo);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      campaign: { select: { name: true } },
      agents: {
        where: { active: true },
        include: {
          responses: {
            where: { ...dw, ...submittedResponseWhere() },
            select: {
              score: true,
              result: true,
              hasFatalFail: true,
              createdAt: true,
              form: { select: { campaignId: true } },
              disposition: { select: { campaignId: true } },
            },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!team) throw new Error("Equipo no encontrado");
  await assertCampaignPermissionForUser(session.user, team.campaignId, KPI_READ_PERMISSION);
  const passThreshold = await getPassThresholdForCampaign(team.campaignId);
  const agents = team.agents
    .filter((agent) => agent.campaignId === team.campaignId)
    .map((agent) => ({
      ...agent,
      responses: agent.responses.filter(
        (response) =>
          response.form.campaignId === team.campaignId &&
          (!response.disposition || response.disposition.campaignId === team.campaignId),
      ),
    }));

  // Agent ranking
  const agentRanking = agents
    .map((a) => {
      const scores = a.responses.map((r) => Number(r.score));
      const total = scores.length;
      const avg = total > 0 ? scores.reduce((x, y) => x + y, 0) / total : 0;
      const passCount = a.responses.filter((response) =>
        isPassingResponse(
          Number(response.score),
          response.result,
          response.hasFatalFail,
          passThreshold,
        ),
      ).length;
      return {
        id: a.id,
        name: a.name,
        agentCode: a.agentCode,
        totalEvaluations: total,
        avgScore: Math.round(avg * 100) / 100,
        passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore);

  // Score trend (team-level daily)
  const dayMap = new Map<string, { total: number; count: number }>();
  for (const a of agents) {
    for (const r of a.responses) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const ex = dayMap.get(day) ?? { total: 0, count: 0 };
      ex.total += Number(r.score);
      ex.count++;
      dayMap.set(day, ex);
    }
  }
  const scoreTrend = Array.from(dayMap.entries())
    .map(([date, d]) => ({ date, avgScore: Math.round((d.total / d.count) * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const allScores = agents.flatMap((a) => a.responses.map((r) => Number(r.score)));
  const totalAvg =
    allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  return {
    name: team.name,
    campaignName: team.campaign.name,
    agentCount: agents.length,
    totalEvaluations: allScores.length,
    avgScore: Math.round(totalAvg * 100) / 100,
    agentRanking,
    scoreTrend,
  };
}

// ─── Disposition Detail (drill-down) ───────────────

export async function getDispositionDetail(
  dispositionId: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION);
  const dw = dateWhere(dateFrom, dateTo);

  const disposition = await prisma.disposition.findUnique({
    where: { id: dispositionId },
    include: {
      category: { select: { name: true, campaignId: true } },
      campaign: { select: { id: true, name: true } },
    },
  });

  if (!disposition) throw new Error("Disposición no encontrada");

  await assertCampaignPermissionForUser(session.user, disposition.campaignId, KPI_READ_PERMISSION);
  const passThreshold = await getPassThresholdForCampaign(disposition.campaignId);

  const queriedResponses = await prisma.response.findMany({
    where: {
      dispositionId,
      form: { campaignId: disposition.campaignId },
      agent: { campaignId: disposition.campaignId },
      ...dw,
      ...submittedResponseWhere(),
    },
    select: {
      id: true,
      score: true,
      result: true,
      hasFatalFail: true,
      createdAt: true,
      agent: { select: { id: true, name: true } },
      evaluator: { select: { id: true, name: true } },
      form: { select: { id: true, title: true } },
      answers: {
        include: { question: { select: { label: true, type: true, formId: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const responses = queriedResponses.filter((response) =>
    response.answers.every((answer) => answer.question.formId === response.form.id),
  );

  const dayMap = new Map<string, { total: number; count: number }>();
  for (const r of responses) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const ex = dayMap.get(day) ?? { total: 0, count: 0 };
    ex.total += Number(r.score);
    ex.count++;
    dayMap.set(day, ex);
  }
  const scoreTrend = Array.from(dayMap.entries())
    .map(([date, d]) => ({
      date,
      avgScore: Math.round((d.total / d.count) * 100) / 100,
      count: d.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const agentMap = new Map<
    string,
    { id: string; name: string; count: number; totalScore: number }
  >();
  for (const r of responses) {
    const ex = agentMap.get(r.agent.id) ?? {
      id: r.agent.id,
      name: r.agent.name,
      count: 0,
      totalScore: 0,
    };
    ex.count++;
    ex.totalScore += Number(r.score);
    agentMap.set(r.agent.id, ex);
  }
  const topAgents = Array.from(agentMap.values())
    .map((a) => ({
      id: a.id,
      name: a.name,
      count: a.count,
      avgScore: Math.round((a.totalScore / a.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top evaluadores que usan esta disposición
  const evaluatorMap = new Map<
    string,
    { id: string; name: string; count: number; totalScore: number }
  >();
  for (const r of responses) {
    const ex = evaluatorMap.get(r.evaluator.id) ?? {
      id: r.evaluator.id,
      name: r.evaluator.name,
      count: 0,
      totalScore: 0,
    };
    ex.count++;
    ex.totalScore += Number(r.score);
    evaluatorMap.set(r.evaluator.id, ex);
  }
  const topEvaluators = Array.from(evaluatorMap.values())
    .map((e) => ({
      id: e.id,
      name: e.name,
      count: e.count,
      avgScore: Math.round((e.totalScore / e.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Score por pregunta (solo RATING). Usa el score por respuesta ya calculado
  // por el motor (0-100 %, correcto para cualquier escala) en vez de value/5.
  const questionMap = new Map<string, { total: number; count: number }>();
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.question.type !== "RATING" || a.notApplicable || a.score === null) continue;
      const pct = Number(a.score);
      if (Number.isNaN(pct)) continue;
      const ex = questionMap.get(a.question.label) ?? { total: 0, count: 0 };
      ex.total += pct;
      ex.count++;
      questionMap.set(a.question.label, ex);
    }
  }
  const scoreByQuestion = Array.from(questionMap.entries())
    .map(([question, d]) => ({
      question,
      avgScore: Math.round((d.total / d.count) * 100) / 100,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // Promedio global (mismo dateRange, respetando RBAC) para comparación
  const globalAgg = await prisma.response.aggregate({
    where: {
      form: campaignFilter,
      ...(await getResponseIntegrityFilter(campaignFilter)),
      ...dw,
      ...submittedResponseWhere(),
    },
    _avg: { score: true },
    _count: { _all: true },
  });
  const globalAvgScore = Math.round(Number(globalAgg._avg.score ?? 0) * 100) / 100;

  // Disposiciones hermanas (misma categoría)
  let sisterDispositions: {
    id: string;
    name: string;
    code: string | null;
    totalEvaluations: number;
    avgScore: number;
  }[] = [];
  const hasValidCategory = disposition.category?.campaignId === disposition.campaignId;
  if (disposition.categoryId && hasValidCategory) {
    const sisters = await prisma.disposition.findMany({
      where: {
        categoryId: disposition.categoryId,
        campaignId: disposition.campaignId,
        id: { not: dispositionId },
      },
      include: {
        responses: {
          where: {
            form: { campaignId: disposition.campaignId },
            agent: { campaignId: disposition.campaignId },
            ...dw,
            ...submittedResponseWhere(),
          },
          select: { score: true },
        },
      },
    });
    sisterDispositions = sisters
      .map((s) => {
        const scores = s.responses.map((r) => Number(r.score));
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return {
          id: s.id,
          name: s.name,
          code: s.code,
          totalEvaluations: scores.length,
          avgScore: Math.round(avg * 100) / 100,
        };
      })
      .filter((s) => s.totalEvaluations > 0)
      .sort((a, b) => b.totalEvaluations - a.totalEvaluations);
  }

  const recentResponses = responses.slice(0, 20).map((r) => ({
    id: r.id,
    agentName: r.agent.name,
    evaluatorName: r.evaluator.name,
    formTitle: r.form.title,
    score: Number(r.score),
    result: isPassingResponse(Number(r.score), r.result, r.hasFatalFail, passThreshold)
      ? ("PASS" as const)
      : ("FAIL" as const),
    createdAt: r.createdAt.toISOString(),
  }));

  const allScores = responses.map((r) => Number(r.score));
  const avgScore =
    allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
  const passCount = responses.filter((response) =>
    isPassingResponse(
      Number(response.score),
      response.result,
      response.hasFatalFail,
      passThreshold,
    ),
  ).length;
  const passRate = allScores.length > 0 ? Math.round((passCount / allScores.length) * 100) : 0;

  return {
    id: disposition.id,
    name: disposition.name,
    code: disposition.code,
    campaignName: disposition.campaign.name,
    categoryName: hasValidCategory ? (disposition.category?.name ?? null) : null,
    active: disposition.active,
    totalEvaluations: responses.length,
    avgScore: Math.round(avgScore * 100) / 100,
    passThreshold,
    globalAvgScore,
    scoreDelta: Math.round((Math.round(avgScore * 100) / 100 - globalAvgScore) * 100) / 100,
    passRate,
    scoreTrend,
    topAgents,
    topEvaluators,
    scoreByQuestion,
    sisterDispositions,
    recentResponses,
  };
}

// ─── Response Detail (drill-down) ──────────────────

export async function getResponseDetail(responseId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const response = await prisma.response.findUnique({
    where: { id: responseId },
    include: {
      form: {
        select: {
          id: true,
          title: true,
          campaignId: true,
          status: true,
          campaign: { select: { active: true } },
        },
      },
      agent: {
        select: {
          id: true,
          name: true,
          agentCode: true,
          campaignId: true,
          campaign: { select: { name: true } },
        },
      },
      evaluator: { select: { id: true, name: true, email: true } },
      disposition: { select: { id: true, name: true, code: true, campaignId: true } },
      answers: {
        include: {
          question: {
            select: {
              id: true,
              formId: true,
              label: true,
              type: true,
              order: true,
              weight: true,
              fatal: true,
              requiresCommentOnFail: true,
              ratingMax: true,
            },
          },
          category: { select: { id: true, name: true, systemColor: true, systemIcon: true } },
        },
        orderBy: { question: { order: "asc" } },
      },
    },
  });

  if (!response) throw new Error("Evaluación no encontrada");

  if (
    response.agent.campaignId !== response.form.campaignId ||
    (response.disposition && response.disposition.campaignId !== response.form.campaignId) ||
    response.answers.some((answer) => answer.question.formId !== response.form.id)
  ) {
    throw new Error("La evaluación contiene relaciones de otra campaña");
  }

  const readPermission =
    response.status === RESPONSE_STATUS.DRAFT ? "canEditEvaluations" : REPORT_READ_PERMISSION;
  await assertCampaignPermissionForUser(session.user, response.form.campaignId, readPermission);

  const canEditContext =
    response.status === RESPONSE_STATUS.SUBMITTED
      ? response.form.status === "PUBLISHED" || response.form.status === "ARCHIVED"
      : response.status === RESPONSE_STATUS.DRAFT &&
        response.form.status === "PUBLISHED" &&
        response.form.campaign.active;
  const canEdit = canEditContext
    ? await assertCampaignPermissionForUser(
        session.user,
        response.form.campaignId,
        "canEditEvaluations",
      )
        .then(() => true)
        .catch(() => false)
    : false;
  const passThreshold = await getPassThresholdForCampaign(response.form.campaignId);
  const effectiveResult =
    response.status === RESPONSE_STATUS.DRAFT
      ? response.result
      : isPassingResponse(
            Number(response.score),
            response.result,
            response.hasFatalFail,
            passThreshold,
          )
        ? "PASS"
        : "FAIL";

  return {
    id: response.id,
    score: Number(response.score),
    result: effectiveResult,
    hasFatalFail: response.hasFatalFail,
    status: response.status,
    createdAt: response.createdAt.toISOString(),
    updatedAt: response.updatedAt.toISOString(),
    submittedAt: response.submittedAt?.toISOString() ?? null,
    cancelledAt: response.cancelledAt?.toISOString() ?? null,
    cancellationReason: response.cancellationReason,
    canEdit,
    scoringSnapshot: response.scoringSnapshot,
    settingsSnapshot: response.settingsSnapshot,
    formSnapshot: response.formSnapshot,
    form: { id: response.form.id, title: response.form.title },
    agent: {
      id: response.agent.id,
      name: response.agent.name,
      agentCode: response.agent.agentCode,
      campaignName: response.agent.campaign.name,
    },
    evaluator: {
      id: response.evaluator.id,
      name: response.evaluator.name,
      email: response.evaluator.email,
    },
    disposition: response.disposition
      ? {
          id: response.disposition.id,
          name: response.disposition.name,
          code: response.disposition.code,
        }
      : null,
    answers: response.answers.map((a) => ({
      id: a.id,
      questionLabel: a.question.label,
      questionType: a.question.type,
      value: a.notApplicable ? "N/A" : a.value,
      category: a.category
        ? {
            id: a.category.id,
            name: a.category.name,
            color: a.category.systemColor,
            icon: a.category.systemIcon,
          }
        : null,
      score: a.score === null ? null : Number(a.score),
      comment: a.comment,
      isFatalFail: a.isFatalFail,
      notApplicable: a.notApplicable,
      questionWeight: a.question.weight,
      fatal: a.question.fatal,
      requiresCommentOnFail: a.question.requiresCommentOnFail,
      ratingMax: a.question.ratingMax ?? null,
    })),
  };
}

// ─── Filtered Responses List (drill-down from charts) ──

export async function getFilteredResponses(params: {
  minScore?: number;
  maxScore?: number;
  campaignId?: string;
  dateFrom?: string;
  dateTo?: string;
  resultStatus?: string;
  limit?: number;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const { minScore, maxScore, campaignId, dateFrom, dateTo } = params;
  const requestedLimit = params.limit ?? 200;
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 200;
  const resultStatus = normalizeEffectiveResultStatus(params.resultStatus);

  const formFilter = await getCampaignFilterForPermission(REPORT_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const campaignIds = await getCampaignIdsForFilter(formFilter);
  const passThresholds = await getPassThresholdMap(campaignIds);

  const scoreFilter: { gte?: number; lte?: number } = {};
  if (minScore !== undefined) scoreFilter.gte = minScore;
  if (maxScore !== undefined) scoreFilter.lte = maxScore;

  const campaignScopes = campaignIds.map((visibleCampaignId) =>
    responseCampaignScopeWhere(
      visibleCampaignId,
      passThresholds.get(visibleCampaignId) ?? 70,
      resultStatus,
    ),
  );
  const where = {
    form: formFilter,
    ...(campaignScopes.length > 0 ? { OR: campaignScopes } : { id: { in: [] } }),
    ...(Object.keys(scoreFilter).length > 0 ? { score: scoreFilter } : {}),
    ...dw,
    ...submittedResponseWhere(),
  } satisfies Prisma.ResponseWhereInput;

  const [responses, totalCount] = await Promise.all([
    prisma.response.findMany({
      where,
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            campaign: { select: { name: true } },
          },
        },
        evaluator: { select: { id: true, name: true } },
        form: { select: { id: true, title: true, campaignId: true } },
        disposition: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.response.count({ where }),
  ]);

  return {
    responses: responses.map((r) => {
      const passThreshold = passThresholds.get(r.form.campaignId) ?? 70;
      const result: EffectiveResultStatus = isPassingResponse(
        Number(r.score),
        r.result,
        r.hasFatalFail,
        passThreshold,
      )
        ? "PASS"
        : "FAIL";

      return {
        id: r.id,
        score: Number(r.score),
        result,
        hasFatalFail: r.hasFatalFail,
        campaignId: r.form.campaignId,
        passThreshold,
        createdAt: r.createdAt.toISOString(),
        agent: {
          id: r.agent.id,
          name: r.agent.name,
          campaignName: r.agent.campaign.name,
        },
        evaluator: { id: r.evaluator.id, name: r.evaluator.name },
        form: { id: r.form.id, title: r.form.title },
        disposition: r.disposition ? { id: r.disposition.id, name: r.disposition.name } : null,
      };
    }),
    totalCount,
    shownCount: responses.length,
    limit,
  };
}
