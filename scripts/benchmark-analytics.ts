import { Prisma, PrismaClient } from "@prisma/client";
import {
  buildCampaignResponseAggregateQuery,
  buildCoachingAgentQuery,
  buildCoachingCategoryQuery,
  buildCriticalErrorAccuracyQuery,
  buildDispositionAggregateQuery,
  buildEvaluatorActivityQuery,
  buildQACategoryMetricQuery,
  buildResponseTrendQuery,
  buildScopedResponsePageIdsQuery,
  buildScoreByQuestionQuery,
  buildScoreDistributionQuery,
  buildSelfDashboardAgentQuery,
  buildSelfDashboardSummaryQuery,
} from "../src/server/queries/analytics-sql";

type ExplainPlan = {
  Plan: {
    "Node Type": string;
    "Actual Rows": number;
    "Shared Hit Blocks"?: number;
    "Shared Read Blocks"?: number;
  };
  "Planning Time": number;
  "Execution Time": number;
};

type ExplainRow = { "QUERY PLAN": ExplainPlan[] };

const databaseUrl = process.env.BENCHMARK_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Define BENCHMARK_DATABASE_URL para ejecutar el benchmark.");

const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.replace(/^\//, "");
const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
const explicitlyEphemeral = process.env.BENCHMARK_ALLOW_EPHEMERAL === "true";
if (
  !isLocalHost ||
  (!/benchmark|_ci(?:$|\?)/i.test(`${databaseName}${parsedUrl.search}`) && !explicitlyEphemeral)
) {
  throw new Error(
    "Benchmark bloqueado: usa una base local con nombre benchmark/_ci o BENCHMARK_ALLOW_EPHEMERAL=true.",
  );
}

function positiveInteger(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} debe ser un entero entre 1 y ${maximum}.`);
  }
  return value;
}

const campaignCount = positiveInteger("BENCHMARK_CAMPAIGNS", 10, 50);
const responseCount = positiveInteger("BENCHMARK_RESPONSES", 50_000, 250_000);
const aggregateBudgetMs = positiveInteger("BENCHMARK_AGGREGATE_MAX_MS", 1_500, 60_000);
const pageBudgetMs = positiveInteger("BENCHMARK_PAGE_MAX_MS", 1_000, 60_000);
const bundleQueryBudgetMs = positiveInteger("BENCHMARK_BUNDLE_QUERY_MAX_MS", 2_000, 60_000);
const bundleTotalBudgetMs = positiveInteger("BENCHMARK_BUNDLE_TOTAL_MAX_MS", 12_000, 120_000);
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

function unwrapPlan(rows: ExplainRow[]) {
  const plan = rows[0]?.["QUERY PLAN"]?.[0];
  if (!plan) throw new Error("PostgreSQL no devolvio un plan JSON valido.");
  return plan;
}

async function main() {
  const existing = await prisma.campaign.count({ where: { id: { startsWith: "p2bench-" } } });
  if (existing > 0) {
    throw new Error("Existen fixtures p2bench previos; usa una base efimera limpia.");
  }

  const campaignThresholds = Array.from({ length: campaignCount }, (_, index) => ({
    campaignId: `p2bench-c-${index + 1}`,
    passThreshold: 70 + (index % 5),
  }));

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "User" (
          "id", "email", "name", "role", "active", "sessionVersion", "createdAt", "updatedAt"
        ) VALUES (
          'p2bench-user', 'p2bench@invalid.local', 'P2 Benchmark', 'ADMIN'::"Role",
          true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      await tx.$executeRaw`
        INSERT INTO "Campaign" ("id", "name", "active", "createdAt", "updatedAt")
        SELECT
          'p2bench-c-' || campaign_number,
          'P2 Benchmark Campaign ' || campaign_number,
          true,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM generate_series(1, ${campaignCount}::integer) campaign_number
      `;
      await tx.$executeRaw`
        INSERT INTO "QACategory" (
          "id", "name", "systemColor", "visibleInDashboard", "visibleInKPIs", "createdAt", "updatedAt"
        ) VALUES (
          'p2bench-category', 'P2 Benchmark Quality', '#2563eb', true, true,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      await tx.$executeRaw`
        INSERT INTO "DispositionCategory" ("id", "name", "campaignId", "createdAt")
        SELECT
          'p2bench-dc-' || campaign_number,
          'P2 Benchmark Outcome',
          'p2bench-c-' || campaign_number,
          CURRENT_TIMESTAMP
        FROM generate_series(1, ${campaignCount}::integer) campaign_number
      `;
      await tx.$executeRaw`
        INSERT INTO "Disposition" (
          "id", "name", "code", "categoryId", "campaignId", "active", "createdAt"
        )
        SELECT
          'p2bench-d-' || campaign_number,
          'P2 Benchmark Resolved',
          'RES-' || campaign_number,
          'p2bench-dc-' || campaign_number,
          'p2bench-c-' || campaign_number,
          true,
          CURRENT_TIMESTAMP
        FROM generate_series(1, ${campaignCount}::integer) campaign_number
      `;
      await tx.$executeRaw`
        INSERT INTO "Form" (
          "id", "title", "campaignId", "createdById", "status", "version", "createdAt", "updatedAt"
        )
        SELECT
          'p2bench-f-' || campaign_number,
          'P2 Benchmark Form ' || campaign_number,
          'p2bench-c-' || campaign_number,
          'p2bench-user',
          'PUBLISHED',
          '1.0.0',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM generate_series(1, ${campaignCount}::integer) campaign_number
      `;
      await tx.$executeRaw`
        INSERT INTO "Question" (
          "id", "formId", "type", "label", "required", "weight", "fatal",
          "criticalType", "requiresCommentOnFail", "order"
        )
        SELECT
          'p2bench-q-' || campaign_number,
          'p2bench-f-' || campaign_number,
          'RATING'::"QuestionType",
          'Benchmark question',
          true,
          100,
          true,
          'CUSTOMER'::"CriticalType",
          false,
          0
        FROM generate_series(1, ${campaignCount}::integer) campaign_number
      `;
      await tx.$executeRaw`
        INSERT INTO "Agent" (
          "id", "name", "agentCode", "campaignId", "active", "createdAt"
        )
        SELECT
          'p2bench-a-' || campaign_number || '-' || agent_number,
          'Benchmark Agent ' || campaign_number || '-' || agent_number,
          'A-' || agent_number,
          'p2bench-c-' || campaign_number,
          true,
          CURRENT_TIMESTAMP
        FROM generate_series(1, ${campaignCount}::integer) campaign_number
        CROSS JOIN generate_series(1, 20) agent_number
      `;
      await tx.$executeRaw`
        INSERT INTO "Response" (
          "id", "formId", "formVersion", "agentId", "evaluatorId", "dispositionId", "score", "result",
          "hasFatalFail", "status", "createdAt", "updatedAt", "submittedAt"
        )
        SELECT
          'p2bench-r-' || response_number,
          'p2bench-f-' || (((response_number - 1) % ${campaignCount}::integer) + 1),
          '1.0.0',
          'p2bench-a-' || (((response_number - 1) % ${campaignCount}::integer) + 1)
            || '-' || (((response_number - 1) % 20) + 1),
          'p2bench-user',
          'p2bench-d-' || (((response_number - 1) % ${campaignCount}::integer) + 1),
          (60 + (response_number % 41))::numeric(5, 2),
          CASE WHEN response_number % 5 = 0 THEN 'FAIL' ELSE 'PASS' END,
          response_number % 37 = 0,
          'SUBMITTED',
          CURRENT_TIMESTAMP - ((response_number % 180)::text || ' days')::interval,
          CURRENT_TIMESTAMP - ((response_number % 180)::text || ' days')::interval,
          CURRENT_TIMESTAMP - ((response_number % 180)::text || ' days')::interval
        FROM generate_series(1, ${responseCount}::integer) response_number
      `;
      await tx.$executeRaw`
        INSERT INTO "Answer" (
          "id", "responseId", "questionId", "categoryId", "value", "score", "comment",
          "isFatalFail", "notApplicable"
        )
        SELECT
          'p2bench-answer-' || response_number,
          'p2bench-r-' || response_number,
          'p2bench-q-' || (((response_number - 1) % ${campaignCount}::integer) + 1),
          'p2bench-category',
          '5',
          (60 + (response_number % 41))::numeric(5, 2),
          CASE WHEN response_number % 19 = 0 THEN 'Benchmark observation' ELSE NULL END,
          response_number % 37 = 0,
          false
        FROM generate_series(1, ${responseCount}::integer) response_number
      `;

      // Flush deferred integrity checks while all referenced fixtures still exist.
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

      await tx.$executeRawUnsafe(
        'ANALYZE "Campaign", "Form", "Agent", "Question", "Response", "Answer", "QACategory", "Disposition", "DispositionCategory"',
      );

      const filters = { campaigns: campaignThresholds };
      const aggregateQuery = buildCampaignResponseAggregateQuery(filters);
      const pageQuery = buildScopedResponsePageIdsQuery({
        ...filters,
        page: 1,
        pageSize: 50,
      });
      if (!aggregateQuery || !pageQuery) throw new Error("No se pudieron construir las consultas.");

      const bundleQueries = {
        responseTrends: buildResponseTrendQuery(filters),
        scoreDistribution: buildScoreDistributionQuery(filters, 70),
        evaluatorActivity: buildEvaluatorActivityQuery(filters),
        scoreByQuestion: buildScoreByQuestionQuery(filters),
        qaCategoryMetrics: buildQACategoryMetricQuery(filters),
        criticalErrorAccuracy: buildCriticalErrorAccuracyQuery(filters, true),
        coachingAgents: buildCoachingAgentQuery(filters),
        coachingCategories: buildCoachingCategoryQuery(filters),
        dispositions: buildDispositionAggregateQuery(filters),
        qaSelfSummary: buildSelfDashboardSummaryQuery({
          ...filters,
          evaluatorId: "p2bench-user",
        }),
        qaSelfTrends: buildResponseTrendQuery({
          ...filters,
          evaluatorId: "p2bench-user",
        }),
        qaSelfDistribution: buildScoreDistributionQuery(
          { ...filters, evaluatorId: "p2bench-user" },
          70,
        ),
        qaSelfAgentScores: buildSelfDashboardAgentQuery({
          ...filters,
          evaluatorId: "p2bench-user",
        }),
      };
      if (Object.values(bundleQueries).some((query) => query === null)) {
        throw new Error("No se pudieron construir las consultas del bundle.");
      }

      const aggregateRows = await tx.$queryRaw<ExplainRow[]>(
        Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${aggregateQuery}`,
      );
      const pageRows = await tx.$queryRaw<ExplainRow[]>(
        Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${pageQuery}`,
      );
      const aggregatePlan = unwrapPlan(aggregateRows);
      const pagePlan = unwrapPlan(pageRows);
      const bundlePlans: Record<string, ExplainPlan> = {};
      for (const [name, query] of Object.entries(bundleQueries)) {
        const rows = await tx.$queryRaw<ExplainRow[]>(
          Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query as Prisma.Sql}`,
        );
        bundlePlans[name] = unwrapPlan(rows);
      }

      await tx.answer.deleteMany({ where: { id: { startsWith: "p2bench-" } } });
      await tx.response.deleteMany({ where: { id: { startsWith: "p2bench-" } } });
      await tx.question.deleteMany({ where: { id: { startsWith: "p2bench-" } } });
      await tx.agent.deleteMany({ where: { id: { startsWith: "p2bench-" } } });
      await tx.form.deleteMany({ where: { id: { startsWith: "p2bench-" } } });
      await tx.disposition.deleteMany({ where: { id: { startsWith: "p2bench-" } } });
      await tx.dispositionCategory.deleteMany({ where: { id: { startsWith: "p2bench-" } } });
      await tx.campaign.deleteMany({ where: { id: { startsWith: "p2bench-" } } });
      await tx.qACategory.delete({ where: { id: "p2bench-category" } });
      await tx.user.delete({ where: { id: "p2bench-user" } });

      return { aggregatePlan, pagePlan, bundlePlans };
    },
    { maxWait: 10_000, timeout: 180_000 },
  );

  const report = {
    postgres: "16",
    campaigns: campaignCount,
    responses: responseCount,
    answers: responseCount,
    generatedAt: new Date().toISOString(),
    aggregate: {
      node: result.aggregatePlan.Plan["Node Type"],
      rows: result.aggregatePlan.Plan["Actual Rows"],
      planningMs: result.aggregatePlan["Planning Time"],
      executionMs: result.aggregatePlan["Execution Time"],
      sharedHitBlocks: result.aggregatePlan.Plan["Shared Hit Blocks"] ?? 0,
      sharedReadBlocks: result.aggregatePlan.Plan["Shared Read Blocks"] ?? 0,
      budgetMs: aggregateBudgetMs,
    },
    firstPage: {
      node: result.pagePlan.Plan["Node Type"],
      rows: result.pagePlan.Plan["Actual Rows"],
      planningMs: result.pagePlan["Planning Time"],
      executionMs: result.pagePlan["Execution Time"],
      sharedHitBlocks: result.pagePlan.Plan["Shared Hit Blocks"] ?? 0,
      sharedReadBlocks: result.pagePlan.Plan["Shared Read Blocks"] ?? 0,
      budgetMs: pageBudgetMs,
    },
    dashboardKpiBundle: {
      queries: Object.fromEntries(
        Object.entries(result.bundlePlans).map(([name, plan]) => [
          name,
          {
            node: plan.Plan["Node Type"],
            rows: plan.Plan["Actual Rows"],
            planningMs: plan["Planning Time"],
            executionMs: plan["Execution Time"],
            sharedHitBlocks: plan.Plan["Shared Hit Blocks"] ?? 0,
            sharedReadBlocks: plan.Plan["Shared Read Blocks"] ?? 0,
            budgetMs: bundleQueryBudgetMs,
          },
        ]),
      ),
      executionMs: Object.values(result.bundlePlans).reduce(
        (sum, plan) => sum + plan["Execution Time"],
        0,
      ),
      budgetMs: bundleTotalBudgetMs,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (report.aggregate.executionMs > aggregateBudgetMs) {
    throw new Error(
      `La agregacion excedio el presupuesto: ${report.aggregate.executionMs}ms > ${aggregateBudgetMs}ms.`,
    );
  }
  if (report.firstPage.executionMs > pageBudgetMs) {
    throw new Error(
      `La pagina excedio el presupuesto: ${report.firstPage.executionMs}ms > ${pageBudgetMs}ms.`,
    );
  }
  for (const [name, query] of Object.entries(report.dashboardKpiBundle.queries)) {
    if (query.executionMs > bundleQueryBudgetMs) {
      throw new Error(
        `${name} excedio el presupuesto del bundle: ${query.executionMs}ms > ${bundleQueryBudgetMs}ms.`,
      );
    }
  }
  if (report.dashboardKpiBundle.executionMs > bundleTotalBudgetMs) {
    throw new Error(
      `El perfil compuesto Dashboard/KPI excedio el presupuesto: ${report.dashboardKpiBundle.executionMs}ms > ${bundleTotalBudgetMs}ms.`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
