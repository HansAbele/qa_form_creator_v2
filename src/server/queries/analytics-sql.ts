import { Prisma } from "@prisma/client";
import { getOperationalDateBounds, getOperationalTimeZone } from "@/lib/operational-time";
import { prisma } from "@/lib/prisma";

export type EffectiveResultFilter = "PASS" | "FAIL";

export type AuthorizedCampaignThreshold = {
  campaignId: string;
  passThreshold: number;
};

export type ScopedResponseFilters = {
  campaigns: AuthorizedCampaignThreshold[];
  dateFrom?: string;
  dateTo?: string;
  formId?: string;
  agentId?: string;
  evaluatorId?: string;
  dispositionId?: string;
  resultStatus?: EffectiveResultFilter;
  fatalOnly?: boolean;
};

export type CampaignResponseAggregate = {
  campaignId: string;
  totalEvaluations: number;
  avgScore: number;
  passCount: number;
  fatalFailCount: number;
  minCreatedAt: Date | null;
  maxCreatedAt: Date | null;
};

type RawCampaignResponseAggregate = {
  campaignId: string;
  totalEvaluations: bigint | number;
  avgScore: number | string | null;
  passCount: bigint | number;
  fatalFailCount: bigint | number;
  minCreatedAt: Date | null;
  maxCreatedAt: Date | null;
};

type RawResponseId = { id: string };

type RawResponseTrend = {
  date: string;
  count: bigint | number;
  avgScore: number | string | null;
};

type RawScoreDistribution = {
  bucket0: bigint | number;
  bucket1: bigint | number;
  bucket2: bigint | number;
  bucket3: bigint | number;
};

type RawEvaluatorActivity = {
  id: string;
  name: string;
  role: string;
  totalEvaluations: bigint | number;
  avgScore: number | string | null;
  stdDev: number | string | null;
};

type RawQuestionScore = {
  question: string;
  avgScore: number | string | null;
  totalAnswers: bigint | number;
};

type RawQACategoryMetric = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  totalAnswers: bigint | number;
  totalEvaluations: bigint | number;
  avgScore: number | string | null;
  failedAnswers: bigint | number;
  fatalFailCount: bigint | number;
  commentCount: bigint | number;
};

export type CriticalErrorAccuracyAggregate = {
  scopeType: "OVERALL" | "CAMPAIGN" | "AGENT" | "DAY";
  scopeId: string | null;
  scopeName: string | null;
  agentCode: string | null;
  date: string | null;
  family: "CUSTOMER" | "BUSINESS" | "COMPLIANCE";
  applicable: number;
  failedCount: number;
};

type RawCriticalErrorAccuracyAggregate = Omit<
  CriticalErrorAccuracyAggregate,
  "applicable" | "failedCount"
> & {
  applicable: bigint | number;
  failedCount: bigint | number;
};

export type CoachingAgentAggregate = {
  id: string;
  name: string;
  agentCode: string | null;
  campaignId: string;
  campaignName: string;
  totalEvaluations: number;
  avgScore: number;
  passCount: number;
  fatalFailCount: number;
  recentAvg: number | null;
  previousAvg: number | null;
};

type RawCoachingAgentAggregate = Omit<
  CoachingAgentAggregate,
  "totalEvaluations" | "avgScore" | "passCount" | "fatalFailCount" | "recentAvg" | "previousAvg"
> & {
  totalEvaluations: bigint | number;
  avgScore: number | string | null;
  passCount: bigint | number;
  fatalFailCount: bigint | number;
  recentAvg: number | string | null;
  previousAvg: number | string | null;
};

export type CoachingCategoryAggregate = {
  id: string;
  name: string;
  color: string | null;
  campaignId: string;
  totalScore: number;
  scoredCount: number;
  totalAnswers: number;
  fatalFailCount: number;
  affectedAgents: number;
};

type RawCoachingCategoryAggregate = Omit<
  CoachingCategoryAggregate,
  "totalScore" | "scoredCount" | "totalAnswers" | "fatalFailCount" | "affectedAgents"
> & {
  totalScore: number | string | null;
  scoredCount: bigint | number;
  totalAnswers: bigint | number;
  fatalFailCount: bigint | number;
  affectedAgents: bigint | number;
};

type RawDispositionAggregate = {
  id: string;
  name: string;
  code: string | null;
  categoryName: string | null;
  totalEvaluations: bigint | number;
  avgScore: number | string | null;
  passCount: bigint | number;
};

type RawSelfDashboardSummary = {
  evaluations: bigint | number;
  avgScore: number | string | null;
  fatalCount: bigint | number;
  stdDev: number | string | null;
  minCreatedAt: Date | null;
  maxCreatedAt: Date | null;
};

type RawSelfDashboardAgent = {
  id: string;
  name: string;
  agentCode: string | null;
  campaignId: string;
  campaignName: string;
  avgScore: number | string | null;
};

function uniqueCampaigns(campaigns: AuthorizedCampaignThreshold[]) {
  return Array.from(
    new Map(
      campaigns
        .filter(({ campaignId }) => Boolean(campaignId))
        .map((campaign) => [campaign.campaignId, campaign]),
    ).values(),
  );
}

function authorizedCampaignCte(campaigns: AuthorizedCampaignThreshold[]) {
  const rows = campaigns.map(
    ({ campaignId, passThreshold }) => Prisma.sql`(${campaignId}, ${passThreshold}::numeric)`,
  );
  return Prisma.sql`authorized_campaign("campaignId", "passThreshold") AS (VALUES ${Prisma.join(rows)})`;
}

function effectivePassCondition() {
  return Prisma.sql`
    r."hasFatalFail" = false
    AND (
      r."result" = 'PASS'
      OR (
        (r."result" IS NULL OR r."result" NOT IN ('PASS', 'FAIL'))
        AND r."score" >= ac."passThreshold"
      )
    )
  `;
}

function scopedConditions(filters: ScopedResponseFilters) {
  // Answer/question form consistency is enforced by PostgreSQL constraint triggers and the
  // production integrity preflight. Rechecking it as a correlated subquery for every historical
  // response made both aggregates and page reads linear in the full Answer table.
  const conditions: Prisma.Sql[] = [
    Prisma.sql`r."status" = 'SUBMITTED'`,
    Prisma.sql`ag."campaignId" = f."campaignId"`,
    Prisma.sql`(ag."teamId" IS NULL OR t."campaignId" = f."campaignId")`,
    Prisma.sql`(r."dispositionId" IS NULL OR d."campaignId" = f."campaignId")`,
    Prisma.sql`(d."categoryId" IS NULL OR dc."campaignId" = f."campaignId")`,
  ];

  const dateBounds = getOperationalDateBounds(filters.dateFrom, filters.dateTo);
  if (dateBounds.gte) conditions.push(Prisma.sql`r."createdAt" >= ${dateBounds.gte}`);
  if (dateBounds.lt) conditions.push(Prisma.sql`r."createdAt" < ${dateBounds.lt}`);
  if (filters.formId) conditions.push(Prisma.sql`r."formId" = ${filters.formId}`);
  if (filters.agentId) conditions.push(Prisma.sql`r."agentId" = ${filters.agentId}`);
  if (filters.evaluatorId) {
    conditions.push(Prisma.sql`r."evaluatorId" = ${filters.evaluatorId}`);
  }
  if (filters.dispositionId) {
    conditions.push(Prisma.sql`r."dispositionId" = ${filters.dispositionId}`);
  }
  if (filters.fatalOnly) conditions.push(Prisma.sql`r."hasFatalFail" = true`);

  if (filters.resultStatus === "PASS") {
    conditions.push(effectivePassCondition());
  } else if (filters.resultStatus === "FAIL") {
    conditions.push(Prisma.sql`NOT (${effectivePassCondition()})`);
  }

  return Prisma.join(conditions, " AND ");
}

function scopedResponseFrom() {
  return Prisma.sql`
    FROM "Response" r
    JOIN "Form" f ON f."id" = r."formId"
    JOIN authorized_campaign ac ON ac."campaignId" = f."campaignId"
    JOIN "Agent" ag ON ag."id" = r."agentId"
    LEFT JOIN "Team" t ON t."id" = ag."teamId"
    LEFT JOIN "Disposition" d ON d."id" = r."dispositionId"
    LEFT JOIN "DispositionCategory" dc ON dc."id" = d."categoryId"
  `;
}

function operationalDateExpression(column: Prisma.Sql = Prisma.sql`r."createdAt"`) {
  return Prisma.sql`TO_CHAR(${column} AT TIME ZONE ${getOperationalTimeZone()}, 'YYYY-MM-DD')`;
}

function numberValue(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function scopedResponseCte(
  filters: ScopedResponseFilters,
  campaigns: AuthorizedCampaignThreshold[],
) {
  return Prisma.sql`
    scoped_response AS MATERIALIZED (
      SELECT
        r."id" AS "responseId",
        r."formId" AS "formId",
        r."agentId" AS "agentId",
        r."createdAt" AS "createdAt",
        f."campaignId" AS "campaignId",
        ac."passThreshold" AS "passThreshold",
        ag."name" AS "agentName",
        ag."agentCode" AS "agentCode"
      ${scopedResponseFrom()}
      WHERE ${scopedConditions({ ...filters, campaigns })}
    )
  `;
}

export async function getResponseTrendAggregates(filters: ScopedResponseFilters) {
  const query = buildResponseTrendQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawResponseTrend[]>(query);

  return (rows ?? []).map((row) => ({
    date: row.date,
    count: Number(row.count),
    avgScore: Math.round(numberValue(row.avgScore) * 100) / 100,
  }));
}

export function buildResponseTrendQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  const day = operationalDateExpression();
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}
    SELECT
      ${day} AS "date",
      COUNT(*)::bigint AS "count",
      AVG(r."score")::double precision AS "avgScore"
    ${scopedResponseFrom()}
    WHERE ${scopedConditions({ ...filters, campaigns })}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
}

export async function getScoreDistributionCounts(
  filters: ScopedResponseFilters,
  passThreshold: number,
) {
  const query = buildScoreDistributionQuery(filters, passThreshold);
  if (!query) return [0, 0, 0, 0] as const;
  const rows = await prisma.$queryRaw<RawScoreDistribution[]>(query);
  const row = rows?.[0];
  return [
    Number(row?.bucket0 ?? 0),
    Number(row?.bucket1 ?? 0),
    Number(row?.bucket2 ?? 0),
    Number(row?.bucket3 ?? 0),
  ] as const;
}

export function buildScoreDistributionQuery(filters: ScopedResponseFilters, passThreshold: number) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  const midLow = Math.floor(passThreshold / 2);
  const midHigh = Math.floor(passThreshold + (100 - passThreshold) / 2);
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}
    SELECT
      COUNT(*) FILTER (WHERE r."score" >= 0 AND r."score" <= ${midLow - 1})::bigint AS "bucket0",
      COUNT(*) FILTER (WHERE r."score" >= ${midLow} AND r."score" <= ${passThreshold - 1})::bigint AS "bucket1",
      COUNT(*) FILTER (WHERE r."score" >= ${passThreshold} AND r."score" <= ${midHigh - 1})::bigint AS "bucket2",
      COUNT(*) FILTER (WHERE r."score" >= ${midHigh} AND r."score" <= 100)::bigint AS "bucket3"
    ${scopedResponseFrom()}
    WHERE ${scopedConditions({ ...filters, campaigns })}
  `;
}

export async function getEvaluatorActivityAggregates(filters: ScopedResponseFilters) {
  const query = buildEvaluatorActivityQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawEvaluatorActivity[]>(query);

  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    totalEvaluations: Number(row.totalEvaluations),
    avgScore: Math.round(numberValue(row.avgScore) * 100) / 100,
    stdDev: Math.round(numberValue(row.stdDev) * 100) / 100,
  }));
}

export function buildEvaluatorActivityQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}
    SELECT
      u."id",
      COALESCE(u."name", u."email") AS "name",
      u."role"::text AS "role",
      COUNT(*)::bigint AS "totalEvaluations",
      AVG(r."score")::double precision AS "avgScore",
      COALESCE(STDDEV_POP(r."score"), 0)::double precision AS "stdDev"
    ${scopedResponseFrom()}
    JOIN "User" u ON u."id" = r."evaluatorId"
    WHERE ${scopedConditions({ ...filters, campaigns })}
    GROUP BY u."id", u."name", u."email", u."role"
    ORDER BY COUNT(*) DESC, u."id" ASC
  `;
}

export async function getScoreByQuestionAggregates(filters: ScopedResponseFilters) {
  const query = buildScoreByQuestionQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawQuestionScore[]>(query);

  return (rows ?? []).map((row) => ({
    question: row.question,
    avgScore: Math.round(numberValue(row.avgScore) * 100) / 100,
    totalAnswers: Number(row.totalAnswers),
  }));
}

export function buildScoreByQuestionQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}, ${scopedResponseCte(filters, campaigns)}
    SELECT
      q."label" AS "question",
      AVG(a."score")::double precision AS "avgScore",
      COUNT(*)::bigint AS "totalAnswers"
    FROM scoped_response sr
    JOIN "Answer" a ON a."responseId" = sr."responseId"
    JOIN "Question" q ON q."id" = a."questionId" AND q."formId" = sr."formId"
    WHERE a."notApplicable" = false
      AND a."score" IS NOT NULL
      AND q."type" = 'RATING'
    GROUP BY q."label"
    ORDER BY AVG(a."score") ASC, q."label" ASC
  `;
}

export async function getQACategoryMetricAggregates(filters: ScopedResponseFilters) {
  const query = buildQACategoryMetricQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawQACategoryMetric[]>(query);

  return (rows ?? [])
    .map((row) => {
      const totalAnswers = Number(row.totalAnswers);
      const failedAnswers = Number(row.failedAnswers);
      return {
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        totalAnswers,
        totalEvaluations: Number(row.totalEvaluations),
        avgScore: Math.round(numberValue(row.avgScore) * 100) / 100,
        failedAnswers,
        failRate: totalAnswers > 0 ? Math.round((failedAnswers / totalAnswers) * 100) : 0,
        fatalFailCount: Number(row.fatalFailCount),
        commentCount: Number(row.commentCount),
      };
    })
    .sort(
      (a, b) =>
        b.fatalFailCount - a.fatalFailCount ||
        a.avgScore - b.avgScore ||
        b.failedAnswers - a.failedAnswers ||
        b.totalAnswers - a.totalAnswers ||
        a.name.localeCompare(b.name),
    );
}

export function buildQACategoryMetricQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}, ${scopedResponseCte(filters, campaigns)}
    SELECT
      qc."id",
      qc."name",
      qc."systemColor" AS "color",
      qc."systemIcon" AS "icon",
      COUNT(*)::bigint AS "totalAnswers",
      COUNT(DISTINCT sr."responseId")::bigint AS "totalEvaluations",
      COALESCE(AVG(a."score") FILTER (WHERE a."score" IS NOT NULL), 0)::double precision AS "avgScore",
      COUNT(*) FILTER (
        WHERE a."isFatalFail" = true
           OR (a."score" IS NOT NULL AND a."score" < sr."passThreshold")
      )::bigint AS "failedAnswers",
      COUNT(*) FILTER (WHERE a."isFatalFail" = true)::bigint AS "fatalFailCount",
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(a."comment"), '') IS NOT NULL)::bigint AS "commentCount"
    FROM scoped_response sr
    JOIN "Answer" a ON a."responseId" = sr."responseId"
    JOIN "Question" q ON q."id" = a."questionId" AND q."formId" = sr."formId"
    JOIN "QACategory" qc ON qc."id" = a."categoryId"
    WHERE a."notApplicable" = false
      AND qc."visibleInKPIs" = true
      AND (a."score" IS NOT NULL OR a."isFatalFail" = true)
    GROUP BY qc."id", qc."name", qc."systemColor", qc."systemIcon"
  `;
}

export async function getCriticalErrorAccuracyAggregates(
  filters: ScopedResponseFilters,
  includeDetail = false,
): Promise<CriticalErrorAccuracyAggregate[]> {
  const query = buildCriticalErrorAccuracyQuery(filters, includeDetail);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawCriticalErrorAccuracyAggregate[]>(query);

  return (rows ?? []).map((row) => ({
    ...row,
    applicable: Number(row.applicable),
    failedCount: Number(row.failedCount),
  }));
}

export function buildCriticalErrorAccuracyQuery(
  filters: ScopedResponseFilters,
  includeDetail = false,
) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  const day = operationalDateExpression(Prisma.sql`sr."createdAt"`);
  const detailSelects = includeDetail
    ? Prisma.sql`
      UNION ALL
      SELECT 'CAMPAIGN', b."campaignId", b."campaignName", NULL, NULL, b."family",
             COUNT(*)::bigint, COUNT(*) FILTER (WHERE b."failed")::bigint
      FROM base b GROUP BY b."campaignId", b."campaignName", b."family"
      UNION ALL
      SELECT 'AGENT', b."agentId", b."agentName", b."agentCode", NULL, b."family",
             COUNT(*)::bigint, COUNT(*) FILTER (WHERE b."failed")::bigint
      FROM base b GROUP BY b."agentId", b."agentName", b."agentCode", b."family"
      UNION ALL
      SELECT 'DAY', b."day", NULL, NULL, b."day", b."family",
             COUNT(*)::bigint, COUNT(*) FILTER (WHERE b."failed")::bigint
      FROM base b GROUP BY b."day", b."family"
    `
    : Prisma.empty;

  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}, ${scopedResponseCte(filters, campaigns)},
    base AS (
      SELECT
        sr."responseId" AS "responseId",
        sr."campaignId" AS "campaignId",
        c."name" AS "campaignName",
        sr."agentId" AS "agentId",
        sr."agentName" AS "agentName",
        sr."agentCode" AS "agentCode",
        ${day} AS "day",
        q."criticalType"::text AS "family",
        BOOL_OR(a."isFatalFail") AS "failed"
      FROM scoped_response sr
      JOIN "Campaign" c ON c."id" = sr."campaignId"
      JOIN "Answer" a ON a."responseId" = sr."responseId"
      JOIN "Question" q ON q."id" = a."questionId" AND q."formId" = sr."formId"
      WHERE a."notApplicable" = false
        AND q."fatal" = true
        AND q."criticalType" IS NOT NULL
      GROUP BY sr."responseId", sr."createdAt", sr."campaignId", c."name",
               sr."agentId", sr."agentName", sr."agentCode", q."criticalType"
    )
    SELECT
      'OVERALL' AS "scopeType", NULL::text AS "scopeId", NULL::text AS "scopeName",
      NULL::text AS "agentCode", NULL::text AS "date", b."family" AS "family",
      COUNT(*)::bigint AS "applicable",
      COUNT(*) FILTER (WHERE b."failed")::bigint AS "failedCount"
    FROM base b
    GROUP BY b."family"
    ${detailSelects}
  `;
}

export async function getCoachingAgentAggregates(filters: ScopedResponseFilters) {
  const query = buildCoachingAgentQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawCoachingAgentAggregate[]>(query);

  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    agentCode: row.agentCode,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    totalEvaluations: Number(row.totalEvaluations),
    avgScore: numberValue(row.avgScore),
    passCount: Number(row.passCount),
    fatalFailCount: Number(row.fatalFailCount),
    recentAvg: row.recentAvg === null ? null : Number(row.recentAvg),
    previousAvg: row.previousAvg === null ? null : Number(row.previousAvg),
  }));
}

export function buildCoachingAgentQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)},
    ranked AS (
      SELECT
        ag."id",
        ag."name",
        ag."agentCode",
        f."campaignId",
        c."name" AS "campaignName",
        r."score",
        r."hasFatalFail",
        (${effectivePassCondition()}) AS "isPassing",
        ROW_NUMBER() OVER (
          PARTITION BY ag."id"
          ORDER BY r."createdAt" DESC, r."id" DESC
        ) AS "position"
      ${scopedResponseFrom()}
      JOIN "Campaign" c ON c."id" = f."campaignId"
      WHERE ${scopedConditions({ ...filters, campaigns })}
        AND ag."active" = true
    )
    SELECT
      "id", "name", "agentCode", "campaignId", "campaignName",
      COUNT(*)::bigint AS "totalEvaluations",
      AVG("score")::double precision AS "avgScore",
      COUNT(*) FILTER (WHERE "isPassing")::bigint AS "passCount",
      COUNT(*) FILTER (WHERE "hasFatalFail")::bigint AS "fatalFailCount",
      AVG("score") FILTER (WHERE "position" <= 5)::double precision AS "recentAvg",
      AVG("score") FILTER (WHERE "position" BETWEEN 6 AND 10)::double precision AS "previousAvg"
    FROM ranked
    WHERE "position" <= 30
    GROUP BY "id", "name", "agentCode", "campaignId", "campaignName"
  `;
}

export async function getCoachingCategoryAggregates(filters: ScopedResponseFilters) {
  const query = buildCoachingCategoryQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawCoachingCategoryAggregate[]>(query);

  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    campaignId: row.campaignId,
    totalScore: numberValue(row.totalScore),
    scoredCount: Number(row.scoredCount),
    totalAnswers: Number(row.totalAnswers),
    fatalFailCount: Number(row.fatalFailCount),
    affectedAgents: Number(row.affectedAgents),
  }));
}

export function buildCoachingCategoryQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}, ${scopedResponseCte(filters, campaigns)}
    SELECT
      qc."id",
      qc."name",
      qc."systemColor" AS "color",
      sr."campaignId",
      COALESCE(SUM(a."score") FILTER (WHERE a."score" IS NOT NULL), 0)::double precision AS "totalScore",
      COUNT(*) FILTER (WHERE a."score" IS NOT NULL)::bigint AS "scoredCount",
      COUNT(*)::bigint AS "totalAnswers",
      COUNT(*) FILTER (WHERE a."isFatalFail")::bigint AS "fatalFailCount",
      COUNT(DISTINCT sr."agentId")::bigint AS "affectedAgents"
    FROM scoped_response sr
    JOIN "Answer" a ON a."responseId" = sr."responseId"
    JOIN "Question" q ON q."id" = a."questionId" AND q."formId" = sr."formId"
    JOIN "QACategory" qc ON qc."id" = a."categoryId"
    WHERE a."notApplicable" = false
      AND qc."visibleInDashboard" = true
    GROUP BY qc."id", qc."name", qc."systemColor", sr."campaignId"
  `;
}

export async function getDispositionAggregates(filters: ScopedResponseFilters) {
  const query = buildDispositionAggregateQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawDispositionAggregate[]>(query);

  return (rows ?? []).map((row) => {
    const totalEvaluations = Number(row.totalEvaluations);
    const passCount = Number(row.passCount);
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      categoryName: row.categoryName,
      totalEvaluations,
      avgScore: Math.round(numberValue(row.avgScore) * 100) / 100,
      passRate: totalEvaluations > 0 ? Math.round((passCount / totalEvaluations) * 100) : 0,
    };
  });
}

export function buildDispositionAggregateQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}
    SELECT
      d."id",
      d."name",
      d."code",
      dc."name" AS "categoryName",
      COUNT(*)::bigint AS "totalEvaluations",
      AVG(r."score")::double precision AS "avgScore",
      COUNT(*) FILTER (WHERE ${effectivePassCondition()})::bigint AS "passCount"
    ${scopedResponseFrom()}
    WHERE ${scopedConditions({ ...filters, campaigns })}
      AND d."id" IS NOT NULL
      AND d."active" = true
    GROUP BY d."id", d."name", d."code", dc."name"
    ORDER BY COUNT(*) DESC, d."id" ASC
  `;
}

export async function getSelfDashboardSummary(filters: ScopedResponseFilters) {
  const query = buildSelfDashboardSummaryQuery(filters);
  if (!query) {
    return {
      evaluations: 0,
      avgScore: 0,
      fatalCount: 0,
      stdDev: 0,
      minCreatedAt: null,
      maxCreatedAt: null,
    };
  }
  const rows = await prisma.$queryRaw<RawSelfDashboardSummary[]>(query);
  const row = rows?.[0];
  return {
    evaluations: Number(row?.evaluations ?? 0),
    avgScore: numberValue(row?.avgScore),
    fatalCount: Number(row?.fatalCount ?? 0),
    stdDev: numberValue(row?.stdDev),
    minCreatedAt: row?.minCreatedAt ?? null,
    maxCreatedAt: row?.maxCreatedAt ?? null,
  };
}

export function buildSelfDashboardSummaryQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}
    SELECT
      COUNT(*)::bigint AS "evaluations",
      COALESCE(AVG(r."score"), 0)::double precision AS "avgScore",
      COUNT(*) FILTER (WHERE r."hasFatalFail")::bigint AS "fatalCount",
      COALESCE(STDDEV_POP(r."score"), 0)::double precision AS "stdDev",
      MIN(r."createdAt") AS "minCreatedAt",
      MAX(r."createdAt") AS "maxCreatedAt"
    ${scopedResponseFrom()}
    WHERE ${scopedConditions({ ...filters, campaigns })}
  `;
}

export async function getSelfDashboardAgentAggregates(filters: ScopedResponseFilters) {
  const query = buildSelfDashboardAgentQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawSelfDashboardAgent[]>(query);
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    agentCode: row.agentCode,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    avgScore: Math.round(numberValue(row.avgScore) * 100) / 100,
  }));
}

export function buildSelfDashboardAgentQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}
    SELECT
      ag."id",
      ag."name",
      ag."agentCode",
      f."campaignId",
      c."name" AS "campaignName",
      AVG(r."score")::double precision AS "avgScore"
    ${scopedResponseFrom()}
    JOIN "Campaign" c ON c."id" = f."campaignId"
    WHERE ${scopedConditions({ ...filters, campaigns })}
    GROUP BY ag."id", ag."name", ag."agentCode", f."campaignId", c."name"
  `;
}

export async function getCampaignResponseAggregates(
  filters: ScopedResponseFilters,
): Promise<CampaignResponseAggregate[]> {
  const query = buildCampaignResponseAggregateQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawCampaignResponseAggregate[]>(query);

  return rows.map((row) => ({
    campaignId: row.campaignId,
    totalEvaluations: Number(row.totalEvaluations),
    avgScore: Number(row.avgScore ?? 0),
    passCount: Number(row.passCount),
    fatalFailCount: Number(row.fatalFailCount),
    minCreatedAt: row.minCreatedAt,
    maxCreatedAt: row.maxCreatedAt,
  }));
}

export function buildCampaignResponseAggregateQuery(filters: ScopedResponseFilters) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;

  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}
    SELECT
      f."campaignId" AS "campaignId",
      COUNT(*)::bigint AS "totalEvaluations",
      COALESCE(AVG(r."score")::double precision, 0) AS "avgScore",
      COUNT(*) FILTER (WHERE ${effectivePassCondition()})::bigint AS "passCount",
      COUNT(*) FILTER (WHERE r."hasFatalFail" = true)::bigint AS "fatalFailCount",
      MIN(r."createdAt") AS "minCreatedAt",
      MAX(r."createdAt") AS "maxCreatedAt"
    ${scopedResponseFrom()}
    WHERE ${scopedConditions({ ...filters, campaigns })}
    GROUP BY f."campaignId"
  `;
}

export async function getScopedResponsePageIds(
  filters: ScopedResponseFilters & { page: number; pageSize: number },
) {
  const query = buildScopedResponsePageIdsQuery(filters);
  if (!query) return [];
  const rows = await prisma.$queryRaw<RawResponseId[]>(query);

  return rows.map((row) => row.id);
}

export function buildScopedResponsePageIdsQuery(
  filters: ScopedResponseFilters & { page: number; pageSize: number },
) {
  const campaigns = uniqueCampaigns(filters.campaigns);
  if (campaigns.length === 0) return null;
  const offset = (filters.page - 1) * filters.pageSize;

  return Prisma.sql`
    WITH ${authorizedCampaignCte(campaigns)}
    SELECT r."id"
    ${scopedResponseFrom()}
    WHERE ${scopedConditions({ ...filters, campaigns })}
    ORDER BY r."createdAt" DESC, r."id" DESC
    LIMIT ${filters.pageSize}
    OFFSET ${offset}
  `;
}
