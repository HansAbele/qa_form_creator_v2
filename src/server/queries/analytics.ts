"use server";

import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";
import {
  getOperationalDateBounds,
  getOperationalRangeDays,
  toOperationalDateKey,
} from "@/lib/operational-time";
import { prisma } from "@/lib/prisma";
import { RESPONSE_STATUS, submittedResponseWhere } from "@/lib/response-status";
import {
  getCampaignScoringSettings,
  getCampaignScoringSettingsMap,
  getPassThresholdForCampaign,
  getSettings,
} from "@/lib/settings";
import {
  type EffectiveResultFilter,
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
import { getCampaignFilterForPermission } from "./campaign-filter";

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
  return {
    submittedAt: {
      not: null,
      ...getOperationalDateBounds(dateFrom, dateTo),
    },
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

function normalizeScoreBoundary(value: unknown, fieldName: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${fieldName} debe ser un numero entre 0 y 100`);
  }
  return value;
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
    {
      agent: {
        campaignId,
        OR: [{ teamId: null }, { team: { campaignId } }],
      },
    },
    {
      OR: [
        { dispositionId: null },
        {
          disposition: {
            campaignId,
            OR: [{ categoryId: null }, { category: { campaignId } }],
          },
        },
      ],
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

function getRangeDays(
  dateFrom?: string,
  dateTo?: string,
  minDate?: Date | null,
  maxDate?: Date | null,
) {
  return getOperationalRangeDays({ dateFrom, dateTo, minDate, maxDate });
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
  const settingsMap = await getCampaignScoringSettingsMap(campaignIds);
  return new Map(
    Array.from(settingsMap, ([campaignId, settings]) => [
      campaignId,
      {
        passThreshold: settings.passThreshold,
        targetPassRate: settings.targetPassRate,
        targetAvgScore: settings.targetAvgScore,
        targetDailyRate: settings.targetDailyRate,
        fatalFailuresAllowed: settings.fatalFailuresAllowed,
      },
    ]),
  );
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
  const settingsMap = await getCampaignScoringSettingsMap(campaignIds);
  return new Map(
    Array.from(settingsMap, ([campaignId, settings]) => [campaignId, settings.passThreshold]),
  );
}

async function getAuthorizedCampaignThresholds(campaignFilter: CampaignFilter) {
  const campaignIds = await getCampaignIdsForFilter(campaignFilter);
  const thresholds = await getPassThresholdMap(campaignIds);
  return campaignIds.map((campaignId) => ({
    campaignId,
    passThreshold: thresholds.get(campaignId) ?? 70,
  }));
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
  const [formCount, responseCount, avgScore, passCount, fatalFailCount, recentResponses] =
    await Promise.all([
      prisma.form.count({ where: formFilter }),
      prisma.response.count({ where: responseWhere }),
      prisma.response.aggregate({
        where: responseWhere,
        _avg: { score: true },
        _min: { submittedAt: true },
        _max: { submittedAt: true },
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
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        take: 10,
      }),
    ]);
  const failCount = responseCount - passCount;
  const rangeDays = getRangeDays(
    dateFrom,
    dateTo,
    avgScore._min?.submittedAt ?? null,
    avgScore._max?.submittedAt ?? null,
  );

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
    recentResponses: recentResponses.map((r) => {
      if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
      return {
        id: r.id,
        formTitle: r.form.title,
        agentName: r.agent.name,
        evaluatorName: r.evaluator.name,
        score: Number(r.score),
        submittedAt: r.submittedAt.toISOString(),
      };
    }),
  };
}

// ─── Response Trends (daily) ───────────────────────

export async function getResponseTrends(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const formFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION, campaignId);
  const campaigns = await getAuthorizedCampaignThresholds(formFilter);
  return getResponseTrendAggregates({ campaigns, dateFrom, dateTo });
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
  const campaigns = await getAuthorizedCampaignThresholds(formFilter);
  return getEvaluatorActivityAggregates({ campaigns, dateFrom, dateTo });
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
          submittedAt: true,
          form: { select: { campaignId: true } },
          disposition: { select: { campaignId: true } },
        },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
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
      if (r.submittedAt) allDates.add(toOperationalDateKey(r.submittedAt));
    }
  }
  const sortedDates = Array.from(allDates).sort();

  const series = sortedDates.map((date) => {
    const point: Record<string, string | number | null> = { date };
    for (const agent of ranked) {
      const dayResponses = agent.responses.filter(
        (r) => r.submittedAt && toOperationalDateKey(r.submittedAt) === date,
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
          submittedAt: true,
          form: { select: { campaignId: true } },
          disposition: { select: { campaignId: true } },
        },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
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
  dispositionId?: string;
  dateFrom?: string;
  dateTo?: string;
  resultStatus?: string;
  fatalOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const requestedPage = filters.page ?? 1;
  const requestedPageSize = filters.pageSize ?? 50;
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize =
    Number.isInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, 100)
      : 50;
  const resultStatus = normalizeEffectiveResultStatus(filters.resultStatus);
  const campaignFilter = await getCampaignFilterForPermission(
    REPORT_READ_PERMISSION,
    filters.campaignId,
  );
  const campaignIds = await getCampaignIdsForFilter(campaignFilter);
  const targetSettingsMap = await getTargetSettingsMap(campaignIds);
  const scopedFilters = {
    campaigns: campaignIds.map((visibleCampaignId) => ({
      campaignId: visibleCampaignId,
      passThreshold: targetSettingsMap.get(visibleCampaignId)?.passThreshold ?? 70,
    })),
    dateField: "submittedAt" as const,
    formId: filters.formId,
    agentId: filters.agentId,
    dispositionId: filters.dispositionId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    resultStatus: resultStatus as EffectiveResultFilter | undefined,
    fatalOnly: Boolean(filters.fatalOnly),
  };
  const [pageIds, aggregateRows] = await Promise.all([
    getScopedResponsePageIds({ ...scopedFilters, page, pageSize }),
    getCampaignResponseAggregates(scopedFilters),
  ]);
  const queriedResponses =
    pageIds.length === 0
      ? []
      : await prisma.response.findMany({
          // Re-apply the complete authorization and integrity scope while
          // hydrating the raw-SQL page. An entity can change between the two
          // statements; an ID alone must never become an authorization token.
          where: {
            id: { in: pageIds },
            form: campaignFilter,
            OR: scopedFilters.campaigns.map(({ campaignId, passThreshold }) =>
              responseCampaignScopeWhere(campaignId, passThreshold, resultStatus),
            ),
            ...(filters.formId ? { formId: filters.formId } : {}),
            ...(filters.agentId ? { agentId: filters.agentId } : {}),
            ...(filters.dispositionId ? { dispositionId: filters.dispositionId } : {}),
            submittedAt: {
              not: null,
              ...getOperationalDateBounds(filters.dateFrom, filters.dateTo),
            },
            ...submittedResponseWhere(),
            ...(filters.fatalOnly ? { hasFatalFail: true } : {}),
          },
          select: {
            id: true,
            formVersion: true,
            score: true,
            result: true,
            hasFatalFail: true,
            submittedAt: true,
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
            disposition: {
              select: { id: true, name: true, outcomeType: true, campaignId: true },
            },
          },
        });
  const order = new Map(pageIds.map((id, index) => [id, index]));
  const responses = queriedResponses.sort(
    (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
  );
  const items = responses.map((r) => {
    if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
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
      dispositionId: r.disposition?.id ?? null,
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
      submittedAt: r.submittedAt.toISOString(),
    };
  });

  const totalCount = aggregateRows.reduce((sum, row) => sum + row.totalEvaluations, 0);
  const totalScore = aggregateRows.reduce(
    (sum, row) => sum + row.avgScore * row.totalEvaluations,
    0,
  );
  const passCount = aggregateRows.reduce((sum, row) => sum + row.passCount, 0);
  const fatalFailCount = aggregateRows.reduce((sum, row) => sum + row.fatalFailCount, 0);
  const minCreatedAt = aggregateRows.reduce<Date | null>(
    (current, row) =>
      !current || (row.minCreatedAt && row.minCreatedAt < current) ? row.minCreatedAt : current,
    null,
  );
  const maxCreatedAt = aggregateRows.reduce<Date | null>(
    (current, row) =>
      !current || (row.maxCreatedAt && row.maxCreatedAt > current) ? row.maxCreatedAt : current,
    null,
  );
  const activeCampaignRows = aggregateRows.filter((row) => row.totalEvaluations > 0);
  const weightedTarget = (key: "targetPassRate" | "targetAvgScore") =>
    totalCount > 0
      ? round2(
          activeCampaignRows.reduce(
            (sum, row) =>
              sum + (targetSettingsMap.get(row.campaignId)?.[key] ?? 0) * row.totalEvaluations,
            0,
          ) / totalCount,
        )
      : 0;
  const dailyRateDays = getRangeDays(filters.dateFrom, filters.dateTo, minCreatedAt, maxCreatedAt);

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    summary: {
      totalEvaluations: totalCount,
      avgScore: totalCount > 0 ? round2(totalScore / totalCount) : 0,
      passRate: totalCount > 0 ? round2((passCount / totalCount) * 100) : 0,
      fatalFailCount,
      dailyRate: totalCount > 0 ? round2(totalCount / dailyRateDays) : 0,
      targetPassRate: weightedTarget("targetPassRate"),
      targetAvgScore: weightedTarget("targetAvgScore"),
      targetDailyRate: activeCampaignRows.reduce(
        (sum, row) => sum + (targetSettingsMap.get(row.campaignId)?.targetDailyRate ?? 0),
        0,
      ),
      fatalFailuresAllowed: activeCampaignRows.reduce(
        (sum, row) => sum + (targetSettingsMap.get(row.campaignId)?.fatalFailuresAllowed ?? 0),
        0,
      ),
    },
  };
}

export async function getReportResponseDetail(responseId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  const campaignFilter = await getCampaignFilterForPermission(REPORT_READ_PERMISSION);
  const response = await prisma.response.findFirst({
    where: { id: responseId, form: campaignFilter, ...submittedResponseWhere() },
    select: {
      id: true,
      formId: true,
      formVersion: true,
      score: true,
      result: true,
      hasFatalFail: true,
      createdAt: true,
      form: {
        select: {
          id: true,
          title: true,
          campaignId: true,
          campaign: { select: { name: true } },
        },
      },
      agent: {
        select: {
          name: true,
          agentCode: true,
          campaignId: true,
          teamId: true,
          team: { select: { campaignId: true } },
        },
      },
      evaluator: { select: { name: true } },
      disposition: {
        select: {
          id: true,
          name: true,
          outcomeType: true,
          campaignId: true,
          category: { select: { campaignId: true } },
        },
      },
      answers: {
        select: {
          id: true,
          value: true,
          score: true,
          comment: true,
          isFatalFail: true,
          notApplicable: true,
          question: {
            select: {
              id: true,
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
        orderBy: { question: { order: "asc" } },
      },
    },
  });
  const isValid =
    response &&
    response.agent.campaignId === response.form.campaignId &&
    (!response.agent.teamId || response.agent.team?.campaignId === response.form.campaignId) &&
    (!response.disposition ||
      (response.disposition.campaignId === response.form.campaignId &&
        (!response.disposition.category ||
          response.disposition.category.campaignId === response.form.campaignId))) &&
    response.answers.every((answer) => answer.question.formId === response.form.id);
  if (!response || !isValid) throw new Error("Evaluacion no disponible");

  const targets = await getTargetSettingsForCampaign(response.form.campaignId);
  const score = Number(response.score);
  return {
    id: response.id,
    campaignId: response.form.campaignId,
    campaignName: response.form.campaign.name,
    formTitle: response.form.title,
    agentName: response.agent.name,
    agentCode: response.agent.agentCode,
    evaluatorName: response.evaluator.name,
    formVersion: response.formVersion,
    dispositionId: response.disposition?.id ?? null,
    dispositionName: response.disposition?.name ?? null,
    dispositionOutcome: response.disposition?.outcomeType ?? null,
    score,
    result: response.result,
    hasFatalFail: response.hasFatalFail,
    passThreshold: targets.passThreshold,
    targetAvgScore: targets.targetAvgScore,
    passesThreshold: isPassingResponse(
      score,
      response.result,
      response.hasFatalFail,
      targets.passThreshold,
    ),
    createdAt: response.createdAt.toISOString(),
    answers: response.answers.map((answer) => ({
      questionId: answer.question.id,
      question: answer.question.label,
      questionType: answer.question.type,
      criticalType: answer.question.criticalType,
      value: answer.notApplicable ? "N/A" : answer.value,
      category: answer.category
        ? {
            id: answer.category.id,
            name: answer.category.name,
            color: answer.category.systemColor,
            icon: answer.category.systemIcon,
          }
        : null,
      score: answer.score === null ? null : Number(answer.score),
      comment: answer.comment,
      isFatalFail: answer.isFatalFail,
      notApplicable: answer.notApplicable,
      questionWeight: answer.question.weight,
      fatal: answer.question.fatal,
      requiresCommentOnFail: answer.question.requiresCommentOnFail,
    })),
  };
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
  const [passThreshold, campaigns] = await Promise.all([
    getPassThresholdForCampaign(campaignId),
    getAuthorizedCampaignThresholds(campaignFilter),
  ]);

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
  const counts = await getScoreDistributionCounts({ campaigns, dateFrom, dateTo }, passThreshold);
  buckets.forEach((bucket, index) => {
    bucket.count = counts[index] ?? 0;
  });

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
  const campaigns = await prisma.campaign.findMany({
    where: campaignFilter.campaignId ? { id: campaignFilter.campaignId } : {},
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          forms: true,
          agents: { where: { active: true } },
          users: true,
        },
      },
    },
  });
  const targetSettings = await getTargetSettingsMap(campaigns.map((campaign) => campaign.id));
  const aggregateRows = await getCampaignResponseAggregates({
    campaigns: campaigns.map((campaign) => ({
      campaignId: campaign.id,
      passThreshold: targetSettings.get(campaign.id)?.passThreshold ?? 70,
    })),
    dateFrom,
    dateTo,
  });
  const aggregates = new Map(aggregateRows.map((aggregate) => [aggregate.campaignId, aggregate]));

  return campaigns.map((campaign) => {
    const targets = targetSettings.get(campaign.id) ?? {
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
      fatalFailuresAllowed: 0,
    };
    const aggregate = aggregates.get(campaign.id);
    const totalEvaluations = aggregate?.totalEvaluations ?? 0;
    const rangeDays = getRangeDays(
      dateFrom,
      dateTo,
      aggregate?.minCreatedAt,
      aggregate?.maxCreatedAt,
    );

    return {
      id: campaign.id,
      name: campaign.name,
      totalForms: campaign._count.forms,
      totalAgents: campaign._count.agents,
      totalEvaluators: campaign._count.users,
      totalEvaluations,
      avgScore: round2(aggregate?.avgScore ?? 0),
      passRate:
        totalEvaluations > 0
          ? Math.round(((aggregate?.passCount ?? 0) / totalEvaluations) * 100)
          : 0,
      dailyRate: totalEvaluations > 0 ? round2(totalEvaluations / rangeDays) : 0,
      fatalFailCount: aggregate?.fatalFailCount ?? 0,
      ...targets,
    };
  });
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
  const campaigns = await getAuthorizedCampaignThresholds(campaignFilter);
  return getScoreByQuestionAggregates({ campaigns, dateFrom, dateTo });
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
  const campaigns = await getAuthorizedCampaignThresholds(campaignFilter);
  return getQACategoryMetricAggregates({ campaigns, dateFrom, dateTo });
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
  const campaigns = await getAuthorizedCampaignThresholds(campaignFilter);
  return getDispositionAggregates({ campaigns, dateFrom, dateTo });
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

async function getDashboardCoachingInsightsInternal(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
  campaignKpisOverride?:
    | Awaited<ReturnType<typeof getDashboardCampaignKpis>>
    | Promise<Awaited<ReturnType<typeof getDashboardCampaignKpis>>>,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(
    DASHBOARD_READ_PERMISSION,
    campaignId,
  );
  const campaignIds = await getCampaignIdsForFilter(campaignFilter);
  const settingsMap = await getTargetSettingsMap(campaignIds);
  const campaigns = campaignIds.map((visibleCampaignId) => ({
    campaignId: visibleCampaignId,
    passThreshold: settingsMap.get(visibleCampaignId)?.passThreshold ?? 70,
  }));

  const [campaignKpis, agents, categoryRows] = await Promise.all([
    campaignKpisOverride ?? getDashboardCampaignKpis(campaignId, dateFrom, dateTo),
    getCoachingAgentAggregates({ campaigns, dateFrom, dateTo }),
    getCoachingCategoryAggregates({ campaigns, dateFrom, dateTo }),
  ]);

  const agentRisks = agents
    .map((agent) => {
      const settings = settingsMap.get(agent.campaignId) ?? {
        passThreshold: 70,
        targetPassRate: 85,
        targetAvgScore: 80,
        targetDailyRate: 20,
        fatalFailuresAllowed: 0,
      };
      const totalEvaluations = agent.totalEvaluations;
      if (totalEvaluations === 0) return null;

      const avgScore = round2(agent.avgScore);
      const passRate = round2((agent.passCount / totalEvaluations) * 100);
      const fatalFailCount = agent.fatalFailCount;
      const recentAvg = agent.recentAvg ?? avgScore;
      const previousAvg = agent.previousAvg ?? recentAvg;
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
        campaignName: agent.campaignName,
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
      affectedAgents: number;
      campaignIds: Set<string>;
    }
  >();

  for (const row of categoryRows) {
    const entry = categoryMap.get(row.id) ?? {
      id: row.id,
      name: row.name,
      color: row.color,
      totalScore: 0,
      scoredCount: 0,
      totalAnswers: 0,
      fatalFailCount: 0,
      affectedAgents: 0,
      campaignIds: new Set<string>(),
    };

    entry.totalAnswers += row.totalAnswers;
    entry.affectedAgents += row.affectedAgents;
    entry.campaignIds.add(row.campaignId);
    entry.totalScore += row.totalScore;
    entry.scoredCount += row.scoredCount;
    entry.fatalFailCount += row.fatalFailCount;
    categoryMap.set(row.id, entry);
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
        affectedAgents: category.affectedAgents,
        severity,
        reason:
          severity === "INFO"
            ? "Dentro de target"
            : `${round2(targetAvg - avgScore)} pts bajo target en ${category.affectedAgents} agente(s)`,
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

export async function getDashboardCoachingInsights(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return getDashboardCoachingInsightsInternal(campaignId, dateFrom, dateTo);
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
  const campaigns = await getAuthorizedCampaignThresholds(campaignFilter);
  const [rows, targets] = await Promise.all([
    getCriticalErrorAccuracyAggregates({ campaigns, dateFrom, dateTo }),
    getCeaTargetsForCampaign(campaignId),
  ]);
  const perFamily = new Map(
    rows.filter((row) => row.scopeType === "OVERALL").map((row) => [row.family, row] as const),
  );

  return CRITICAL_FAMILIES.map((family) => {
    const entry = perFamily.get(family);
    const applicable = entry?.applicable ?? 0;
    const failedCount = entry?.failedCount ?? 0;
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
  const [globalSettings, campaignIds] = await Promise.all([
    getSettings(),
    getCampaignIdsForFilter(campaignFilter),
  ]);
  const passThreshold = globalSettings.passThreshold;
  const targetAvgScore = globalSettings.targetAvgScore;
  const targetSettings = await getTargetSettingsMap(campaignIds);
  const campaigns = campaignIds.map((campaignId) => ({
    campaignId,
    passThreshold: targetSettings.get(campaignId)?.passThreshold ?? passThreshold,
  }));
  const sqlFilters = { campaigns, evaluatorId: userId, dateFrom, dateTo };
  const integrityFilter: Prisma.ResponseWhereInput =
    campaignIds.length > 0
      ? { OR: campaignIds.map(responseRelationScopeWhere) }
      : { id: { in: [] } };

  const [summary, trend, distributionCounts, agentScores, recentResponses] = await Promise.all([
    getSelfDashboardSummary(sqlFilters),
    getResponseTrendAggregates(sqlFilters),
    getScoreDistributionCounts(sqlFilters, passThreshold),
    getSelfDashboardAgentAggregates(sqlFilters),
    prisma.response.findMany({
      where: {
        evaluatorId: userId,
        form: campaignFilter,
        ...integrityFilter,
        ...dateWhere(dateFrom, dateTo),
        ...submittedResponseWhere(),
      },
      select: {
        id: true,
        score: true,
        result: true,
        hasFatalFail: true,
        submittedAt: true,
        agent: { select: { name: true } },
        form: { select: { title: true, campaignId: true } },
      },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: 8,
    }),
  ]);

  const rangeDays = getRangeDays(dateFrom, dateTo, summary.minCreatedAt, summary.maxCreatedAt);

  const midLow = Math.floor(passThreshold / 2);
  const midHigh = Math.floor(passThreshold + (100 - passThreshold) / 2);
  const buckets = [
    { range: `0-${midLow - 1}`, count: distributionCounts[0] },
    { range: `${midLow}-${passThreshold - 1}`, count: distributionCounts[1] },
    { range: `${passThreshold}-${midHigh - 1}`, count: distributionCounts[2] },
    { range: `${midHigh}-100`, count: distributionCounts[3] },
  ];

  const recentActivity = recentResponses.map((r) => {
    if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
    return {
      id: r.id,
      agentName: r.agent.name,
      formTitle: r.form.title,
      score: Number(r.score),
      result: isPassingResponse(
        Number(r.score),
        r.result,
        r.hasFatalFail,
        targetSettings.get(r.form.campaignId)?.passThreshold ?? passThreshold,
      )
        ? "PASS"
        : "FAIL",
      submittedAt: r.submittedAt.toISOString(),
    };
  });

  const agentsBelowTarget = agentScores
    .filter(
      (agent) =>
        agent.avgScore < (targetSettings.get(agent.campaignId)?.targetAvgScore ?? targetAvgScore),
    )
    .sort((a, b) => a.avgScore - b.avgScore || a.id.localeCompare(b.id))
    .slice(0, 5);

  return {
    evaluations: summary.evaluations,
    avgScore: round2(summary.avgScore),
    fatalCount: summary.fatalCount,
    dailyRate: round2(summary.evaluations / rangeDays),
    passThreshold,
    targetAvgScore,
    stdDev: round2(summary.stdDev),
    calibrationTolerance: 8,
    trend: trend.map(({ date, count }) => ({ date, count })),
    distribution: buckets,
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
  const campaigns = await getAuthorizedCampaignThresholds(campaignFilter);
  const [targets, rows] = await Promise.all([
    getCeaTargetsForCampaign(campaignId),
    getCriticalErrorAccuracyAggregates({ campaigns, dateFrom, dateTo }, true),
  ]);
  type CeaRow = (typeof rows)[number];
  const accuracy = (row?: CeaRow): number | null =>
    !row || row.applicable === 0
      ? null
      : round2(((row.applicable - row.failedCount) / row.applicable) * 100);
  const familyAccuracies = (familyRows: Partial<Record<CriticalFamily, CeaRow>>) => ({
    CUSTOMER: accuracy(familyRows.CUSTOMER),
    BUSINESS: accuracy(familyRows.BUSINESS),
    COMPLIANCE: accuracy(familyRows.COMPLIANCE),
  });
  const overallRows = Object.fromEntries(
    rows.filter((row) => row.scopeType === "OVERALL").map((row) => [row.family, row]),
  ) as Partial<Record<CriticalFamily, CeaRow>>;

  const overallList = CRITICAL_FAMILIES.map((family) => {
    const row = overallRows[family];
    const applicable = row?.applicable ?? 0;
    const configured = applicable > 0;
    const familyAccuracy = accuracy(row);
    const target = targets[family];
    const status: "en objetivo" | "en riesgo" | "bajo benchmark" | "no configurado" = !configured
      ? "no configurado"
      : (familyAccuracy as number) >= target
        ? "en objetivo"
        : (familyAccuracy as number) >= target - 2
          ? "en riesgo"
          : "bajo benchmark";
    return {
      family,
      applicable,
      failedCount: row?.failedCount ?? 0,
      accuracy: familyAccuracy,
      target,
      status,
      configured,
    };
  });

  const groupRows = (scopeType: CeaRow["scopeType"]) => {
    const groups = new Map<
      string,
      { name: string; agentCode: string | null; fam: Partial<Record<CriticalFamily, CeaRow>> }
    >();
    for (const row of rows.filter((candidate) => candidate.scopeType === scopeType)) {
      if (!row.scopeId) continue;
      const group = groups.get(row.scopeId) ?? {
        name: row.scopeName ?? row.scopeId,
        agentCode: row.agentCode,
        fam: {},
      };
      group.fam[row.family] = row;
      groups.set(row.scopeId, group);
    }
    return groups;
  };

  const byCampaign = Array.from(groupRows("CAMPAIGN").entries())
    .map(([id, value]) => ({ id, name: value.name, ...familyAccuracies(value.fam) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const byAgent = Array.from(groupRows("AGENT").entries())
    .map(([id, value]) => {
      const fa = familyAccuracies(value.fam);
      const configured = [fa.CUSTOMER, fa.BUSINESS, fa.COMPLIANCE].filter(
        (x): x is number => x !== null,
      );
      const worst = configured.length ? Math.min(...configured) : null;
      return { id, name: value.name, agentCode: value.agentCode, ...fa, worst };
    })
    .filter((a): a is typeof a & { worst: number } => a.worst !== null)
    .sort((a, b) => a.worst - b.worst || a.id.localeCompare(b.id))
    .slice(0, 10);

  const trend = Array.from(groupRows("DAY").entries())
    .map(([date, value]) => ({ date, ...familyAccuracies(value.fam) }))
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

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION);
  const campaignIds = await getCampaignIdsForFilter(campaignFilter);
  const dw = dateWhere(dateFrom, dateTo);

  const scopedAgent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      OR: campaignIds.map((campaignId) => ({
        campaignId,
        OR: [{ teamId: null }, { team: { campaignId } }],
      })),
    },
    select: { id: true, campaignId: true },
  });
  if (!scopedAgent) throw new Error("Agente no disponible");

  const agent = await prisma.agent.findFirst({
    where: {
      id: scopedAgent.id,
      campaignId: scopedAgent.campaignId,
      OR: [{ teamId: null }, { team: { campaignId: scopedAgent.campaignId } }],
    },
    include: {
      campaign: { select: { name: true } },
      team: { select: { name: true, campaignId: true } },
      responses: {
        where: {
          ...responseRelationScopeWhere(scopedAgent.campaignId),
          ...dw,
          ...submittedResponseWhere(),
        },
        include: {
          form: { select: { id: true, title: true, campaignId: true } },
          evaluator: { select: { id: true, name: true } },
          disposition: { select: { id: true, name: true, campaignId: true } },
          answers: {
            include: { question: { select: { label: true, type: true, formId: true } } },
          },
        },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      },
    },
  });

  if (!agent) throw new Error("Agente no disponible");
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
    if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
    const day = toOperationalDateKey(r.submittedAt);
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
  const recentResponses = responses.slice(0, 10).map((r) => {
    if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
    return {
      id: r.id,
      formTitle: r.form.title,
      evaluatorName: r.evaluator.name,
      dispositionName: r.disposition?.name ?? null,
      score: Number(r.score),
      result: isPassingResponse(Number(r.score), r.result, r.hasFatalFail, passThreshold)
        ? ("PASS" as const)
        : ("FAIL" as const),
      submittedAt: r.submittedAt.toISOString(),
    };
  });

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
  const canViewEvaluatorEmail = session.user.role === "ADMIN";

  // Select evaluator PII only when the caller can see at least one submitted
  // response through the KPI campaign scope.
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      responses: {
        some: {
          form: campaignFilter,
          ...integrityFilter,
          ...submittedResponseWhere(),
        },
      },
    },
    select: {
      id: true,
      name: true,
      role: true,
      ...(canViewEvaluatorEmail ? { email: true } : {}),
    },
  });
  if (!user) throw new Error("Evaluador no disponible");

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
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
  });
  const responses = queriedResponses.filter(
    (response) =>
      response.agent.campaignId === response.form.campaignId &&
      (!response.disposition || response.disposition.campaignId === response.form.campaignId),
  );

  // Activity by day
  const dayMap = new Map<string, number>();
  for (const r of responses) {
    if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
    const day = toOperationalDateKey(r.submittedAt);
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
    email: canViewEvaluatorEmail && "email" in user ? user.email : null,
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

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION);
  const dw = dateWhere(dateFrom, dateTo);

  const scopedTeam = await prisma.team.findFirst({
    where: { id: teamId, ...campaignFilter },
    select: { id: true, campaignId: true },
  });
  if (!scopedTeam) throw new Error("Equipo no disponible");

  const team = await prisma.team.findFirst({
    where: { id: scopedTeam.id, campaignId: scopedTeam.campaignId },
    include: {
      campaign: { select: { name: true } },
      agents: {
        where: { active: true, campaignId: scopedTeam.campaignId },
        include: {
          responses: {
            where: {
              ...responseRelationScopeWhere(scopedTeam.campaignId),
              ...dw,
              ...submittedResponseWhere(),
            },
            select: {
              score: true,
              result: true,
              hasFatalFail: true,
              submittedAt: true,
              form: { select: { campaignId: true } },
              disposition: { select: { campaignId: true } },
            },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!team) throw new Error("Equipo no disponible");
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
      if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
      const day = toOperationalDateKey(r.submittedAt);
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
  const campaignIds = await getCampaignIdsForFilter(campaignFilter);
  const dw = dateWhere(dateFrom, dateTo);

  const scopedDisposition = await prisma.disposition.findFirst({
    where: {
      id: dispositionId,
      OR: campaignIds.map((campaignId) => ({
        campaignId,
        OR: [{ categoryId: null }, { category: { campaignId } }],
      })),
    },
    select: { id: true, campaignId: true },
  });
  if (!scopedDisposition) throw new Error("Disposicion no disponible");

  const disposition = await prisma.disposition.findFirst({
    where: {
      id: scopedDisposition.id,
      campaignId: scopedDisposition.campaignId,
      OR: [{ categoryId: null }, { category: { campaignId: scopedDisposition.campaignId } }],
    },
    include: {
      category: { select: { name: true, campaignId: true } },
      campaign: { select: { id: true, name: true } },
    },
  });

  if (!disposition) throw new Error("Disposicion no disponible");
  const passThreshold = await getPassThresholdForCampaign(disposition.campaignId);

  const queriedResponses = await prisma.response.findMany({
    where: {
      dispositionId,
      ...responseRelationScopeWhere(disposition.campaignId),
      ...dw,
      ...submittedResponseWhere(),
    },
    select: {
      id: true,
      score: true,
      result: true,
      hasFatalFail: true,
      submittedAt: true,
      agent: { select: { id: true, name: true } },
      evaluator: { select: { id: true, name: true } },
      form: { select: { id: true, title: true } },
      answers: {
        include: { question: { select: { label: true, type: true, formId: true } } },
      },
    },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
  });
  const responses = queriedResponses.filter((response) =>
    response.answers.every((answer) => answer.question.formId === response.form.id),
  );

  const dayMap = new Map<string, { total: number; count: number }>();
  for (const r of responses) {
    if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
    const day = toOperationalDateKey(r.submittedAt);
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
            ...responseRelationScopeWhere(disposition.campaignId),
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

  const recentResponses = responses.slice(0, 20).map((r) => {
    if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
    return {
      id: r.id,
      agentName: r.agent.name,
      evaluatorName: r.evaluator.name,
      formTitle: r.form.title,
      score: Number(r.score),
      result: isPassingResponse(Number(r.score), r.result, r.hasFatalFail, passThreshold)
        ? ("PASS" as const)
        : ("FAIL" as const),
      submittedAt: r.submittedAt.toISOString(),
    };
  });

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

  const [draftFilter, reportFilter, ownHistoryFilter, auditFilter] = await Promise.all([
    getCampaignFilterForPermission("canEditEvaluations"),
    getCampaignFilterForPermission(REPORT_READ_PERMISSION),
    getCampaignFilterForPermission(SELF_DASHBOARD_READ_PERMISSION),
    getCampaignFilterForPermission("canViewAudit"),
  ]);
  const authorizationScope = {
    OR: [
      { status: RESPONSE_STATUS.DRAFT, form: draftFilter },
      { status: RESPONSE_STATUS.SUBMITTED, form: reportFilter },
      {
        status: RESPONSE_STATUS.SUBMITTED,
        evaluatorId: session.user.id,
        form: ownHistoryFilter,
      },
      { status: RESPONSE_STATUS.CANCELLED, form: auditFilter },
    ],
  } satisfies Prisma.ResponseWhereInput;
  const scopedResponse = await prisma.response.findFirst({
    where: {
      id: responseId,
      ...authorizationScope,
    },
    select: {
      id: true,
      formId: true,
      status: true,
      form: { select: { campaignId: true } },
    },
  });
  if (!scopedResponse) throw new Error("Evaluacion no disponible");

  const campaignId = scopedResponse.form.campaignId;
  const response = await prisma.response.findFirst({
    where: {
      id: scopedResponse.id,
      formId: scopedResponse.formId,
      status: scopedResponse.status,
      AND: [
        authorizationScope,
        { form: { campaignId } },
        {
          agent: {
            campaignId,
            OR: [{ teamId: null }, { team: { campaignId } }],
          },
        },
        {
          OR: [
            { dispositionId: null },
            {
              disposition: {
                campaignId,
                OR: [{ categoryId: null }, { category: { campaignId } }],
              },
            },
          ],
        },
        { answers: { every: { question: { formId: scopedResponse.formId } } } },
      ],
    },
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
      evaluator: { select: { id: true, name: true } },
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

  if (!response) throw new Error("Evaluacion no disponible");

  const canEditContext =
    response.status === RESPONSE_STATUS.SUBMITTED
      ? response.form.status === "PUBLISHED" || response.form.status === "ARCHIVED"
      : response.status === RESPONSE_STATUS.DRAFT &&
        response.form.status === "PUBLISHED" &&
        response.form.campaign.active;
  const editCampaignFilter = draftFilter.campaignId;
  const canEditCampaign =
    editCampaignFilter === undefined ||
    editCampaignFilter === response.form.campaignId ||
    (typeof editCampaignFilter !== "string" &&
      editCampaignFilter.in?.includes(response.form.campaignId) === true);
  const canEdit = canEditContext && canEditCampaign;
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
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    prisma.response.count({ where }),
  ]);

  return {
    responses: responses.map((r) => {
      if (!r.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
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
        submittedAt: r.submittedAt.toISOString(),
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

export type EvaluationHistoryScope = "own" | "managed";

export type EvaluationHistoryFilterOptions = {
  agents: Array<{ id: string; name: string; campaignId: string; campaignName: string }>;
  evaluators: Array<{ id: string; name: string; campaignIds: string[] }>;
  forms: Array<{ id: string; name: string; campaignId: string; campaignName: string }>;
  dispositions: Array<{ id: string; name: string; campaignId: string; campaignName: string }>;
};

export async function getEvaluationHistoryFilterOptions(scopeInput: EvaluationHistoryScope) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const scope: EvaluationHistoryScope = scopeInput === "managed" ? "managed" : "own";
  const permission = scope === "managed" ? REPORT_READ_PERMISSION : SELF_DASHBOARD_READ_PERMISSION;
  const formFilter = await getCampaignFilterForPermission(permission);
  const campaignIds = await getCampaignIdsForFilter(formFilter);
  const integrityScopes = campaignIds.map(responseRelationScopeWhere);
  const responseScope = {
    form: formFilter,
    ...(scope === "own" ? { evaluatorId: session.user.id } : {}),
    ...(integrityScopes.length > 0 ? { OR: integrityScopes } : { id: { in: [] } }),
    submittedAt: { not: null },
    ...submittedResponseWhere(),
  } satisfies Prisma.ResponseWhereInput;

  const [agentRows, evaluatorRows, formRows, dispositionRows] = await Promise.all([
    prisma.response.findMany({
      where: responseScope,
      distinct: ["agentId"],
      select: {
        agent: {
          select: {
            id: true,
            name: true,
            campaignId: true,
            campaign: { select: { name: true } },
          },
        },
      },
    }),
    prisma.response.findMany({
      where: responseScope,
      distinct: ["evaluatorId", "formId"],
      select: {
        evaluator: { select: { id: true, name: true } },
        form: { select: { campaignId: true } },
      },
    }),
    prisma.response.findMany({
      where: responseScope,
      distinct: ["formId"],
      select: {
        form: {
          select: {
            id: true,
            title: true,
            campaignId: true,
            campaign: { select: { name: true } },
          },
        },
      },
    }),
    prisma.response.findMany({
      where: { AND: [responseScope, { dispositionId: { not: null } }] },
      distinct: ["dispositionId"],
      select: {
        disposition: {
          select: {
            id: true,
            name: true,
            campaignId: true,
            campaign: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const evaluatorMap = new Map<string, { id: string; name: string; campaignIds: Set<string> }>();
  for (const { evaluator, form } of evaluatorRows) {
    const option = evaluatorMap.get(evaluator.id) ?? {
      id: evaluator.id,
      name: evaluator.name,
      campaignIds: new Set<string>(),
    };
    option.campaignIds.add(form.campaignId);
    evaluatorMap.set(evaluator.id, option);
  }

  const options: EvaluationHistoryFilterOptions = {
    agents: agentRows
      .map(({ agent }) => ({
        id: agent.id,
        name: agent.name,
        campaignId: agent.campaignId,
        campaignName: agent.campaign.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    evaluators: Array.from(evaluatorMap.values())
      .map((evaluator) => ({
        id: evaluator.id,
        name: evaluator.name,
        campaignIds: Array.from(evaluator.campaignIds).sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    forms: formRows
      .map(({ form }) => ({
        id: form.id,
        name: form.title,
        campaignId: form.campaignId,
        campaignName: form.campaign.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    dispositions: dispositionRows
      .flatMap(({ disposition }) =>
        disposition
          ? [
              {
                id: disposition.id,
                name: disposition.name,
                campaignId: disposition.campaignId,
                campaignName: disposition.campaign.name,
              },
            ]
          : [],
      )
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  };

  return options;
}

export async function getEvaluationHistory(params: {
  scope: EvaluationHistoryScope;
  minScore?: number;
  maxScore?: number;
  campaignId?: string;
  dateFrom?: string;
  dateTo?: string;
  resultStatus?: string;
  agentId?: string;
  evaluatorId?: string;
  formId?: string;
  dispositionId?: string;
  fatalOnly?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const scope: EvaluationHistoryScope = params.scope === "managed" ? "managed" : "own";
  const permission = scope === "managed" ? REPORT_READ_PERMISSION : SELF_DASHBOARD_READ_PERMISSION;
  const formFilter = await getCampaignFilterForPermission(permission, params.campaignId);
  const campaignIds = await getCampaignIdsForFilter(formFilter);
  const passThresholds = await getPassThresholdMap(campaignIds);
  const resultStatus = normalizeEffectiveResultStatus(params.resultStatus);
  if (params.resultStatus !== undefined && !resultStatus) {
    throw new Error("resultStatus debe ser PASS o FAIL");
  }

  const requestedPage = params.page ?? 1;
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 10_000) {
    throw new Error("page debe ser un entero entre 1 y 10000");
  }
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedPageSize = params.pageSize ?? 25;
  const pageSize =
    Number.isInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, 100)
      : 25;

  const minScore = normalizeScoreBoundary(params.minScore, "minScore");
  const maxScore = normalizeScoreBoundary(params.maxScore, "maxScore");
  if (minScore !== undefined && maxScore !== undefined && minScore > maxScore) {
    throw new Error("minScore no puede ser mayor que maxScore");
  }
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
    ...(scope === "own" ? { evaluatorId: session.user.id } : {}),
    ...(scope === "managed" && params.evaluatorId ? { evaluatorId: params.evaluatorId } : {}),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.formId ? { formId: params.formId } : {}),
    ...(params.dispositionId ? { dispositionId: params.dispositionId } : {}),
    ...(params.fatalOnly === true ? { hasFatalFail: true } : {}),
    ...(campaignScopes.length > 0 ? { OR: campaignScopes } : { id: { in: [] } }),
    ...(Object.keys(scoreFilter).length > 0 ? { score: scoreFilter } : {}),
    submittedAt: {
      not: null,
      ...getOperationalDateBounds(params.dateFrom, params.dateTo),
    },
    ...submittedResponseWhere(),
  } satisfies Prisma.ResponseWhereInput;

  const passScopes = campaignIds.map((visibleCampaignId) =>
    responseCampaignScopeWhere(
      visibleCampaignId,
      passThresholds.get(visibleCampaignId) ?? 70,
      "PASS",
    ),
  );
  const passWhere = {
    AND: [where, passScopes.length > 0 ? { OR: passScopes } : { id: { in: [] } }],
  } satisfies Prisma.ResponseWhereInput;

  const [responses, totalCount, scoreAggregate, passCount] = await Promise.all([
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
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.response.count({ where }),
    prisma.response.aggregate({ where, _avg: { score: true } }),
    prisma.response.count({ where: passWhere }),
  ]);

  return {
    scope,
    responses: responses.map((response) => {
      if (!response.submittedAt) throw new Error("Evaluacion enviada sin fecha de envio");
      const passThreshold = passThresholds.get(response.form.campaignId) ?? 70;
      const result: EffectiveResultStatus = isPassingResponse(
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
        result,
        hasFatalFail: response.hasFatalFail,
        campaignId: response.form.campaignId,
        passThreshold,
        createdAt: response.createdAt.toISOString(),
        submittedAt: response.submittedAt.toISOString(),
        agent: {
          id: response.agent.id,
          name: response.agent.name,
          campaignName: response.agent.campaign.name,
        },
        evaluator: { id: response.evaluator.id, name: response.evaluator.name },
        form: { id: response.form.id, title: response.form.title },
        disposition: response.disposition
          ? { id: response.disposition.id, name: response.disposition.name }
          : null,
      };
    }),
    summary: {
      totalEvaluations: totalCount,
      avgScore: Number(scoreAggregate._avg.score ?? 0),
      passRate: totalCount > 0 ? Math.round((passCount / totalCount) * 10_000) / 100 : 0,
    },
    totalCount,
    shownCount: responses.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

export async function getDashboardManagerBundle(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const campaignKpisPromise = getDashboardCampaignKpis(campaignId, dateFrom, dateTo);
  const [
    stats,
    trends,
    distribution,
    criticalErrorAccuracy,
    coachingInsights,
    evaluatorActivity,
    campaignKpis,
    dispositionAnalytics,
    outcomeKpis,
  ] = await Promise.all([
    getDashboardStats(campaignId, dateFrom, dateTo),
    getResponseTrends(campaignId, dateFrom, dateTo),
    getScoreDistribution(campaignId, dateFrom, dateTo),
    getCriticalErrorAccuracy(campaignId, dateFrom, dateTo),
    getDashboardCoachingInsightsInternal(campaignId, dateFrom, dateTo, campaignKpisPromise),
    getDashboardEvaluatorActivity(campaignId, dateFrom, dateTo),
    campaignKpisPromise,
    getDashboardDispositionAnalytics(campaignId, dateFrom, dateTo),
    getDashboardOutcomeKpis(campaignId, dateFrom, dateTo),
  ]);

  return {
    stats,
    trends,
    distribution,
    criticalErrorAccuracy,
    coachingInsights,
    evaluatorActivity,
    campaignKpis,
    dispositionAnalytics,
    outcomeKpis,
  };
}

export async function getKpiBundle(dateFrom?: string, dateTo?: string) {
  const [campaignKpis, scoreByQuestion, evaluatorActivity, qaCategoryMetrics, ceaDetail] =
    await Promise.all([
      getCampaignKpis(undefined, dateFrom, dateTo),
      getScoreByQuestion(undefined, dateFrom, dateTo),
      getEvaluatorActivity(undefined, dateFrom, dateTo),
      getQACategoryMetrics(undefined, dateFrom, dateTo),
      getCriticalErrorAccuracyDetail(undefined, dateFrom, dateTo),
    ]);

  return {
    campaignKpis,
    scoreByQuestion,
    evaluatorActivity,
    qaCategoryMetrics,
    ceaDetail,
  };
}
