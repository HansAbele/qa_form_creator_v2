"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getPassThreshold } from "@/lib/settings";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
} from "./campaign-filter";

const DASHBOARD_READ_PERMISSION = "canViewDashboard" satisfies CampaignPermissionKey;
const KPI_READ_PERMISSION = "canViewKPIs" satisfies CampaignPermissionKey;
const REPORT_READ_PERMISSION = "canViewReports" satisfies CampaignPermissionKey;

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

// ─── Dashboard Stats ────────────────────────────────

export async function getDashboardStats(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const formFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const [formCount, responseCount, avgScore, passCount, failCount, recentResponses] =
    await Promise.all([
      prisma.form.count({ where: formFilter }),
      prisma.response.count({ where: { form: formFilter, ...dw } }),
      prisma.response.aggregate({
        where: { form: formFilter, ...dw },
        _avg: { score: true },
      }),
      prisma.response.count({
        where: { form: formFilter, ...dw, score: { gte: passThreshold } },
      }),
      prisma.response.count({
        where: { form: formFilter, ...dw, score: { lt: passThreshold } },
      }),
      prisma.response.findMany({
        where: { form: formFilter, ...dw },
        include: {
          form: { select: { title: true } },
          agent: { select: { name: true } },
          evaluator: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

  return {
    formCount,
    responseCount,
    avgScore: Number(avgScore._avg.score ?? 0),
    passRate: responseCount > 0 ? Math.round((passCount / responseCount) * 100) : 0,
    passCount,
    failCount,
    passThreshold,
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

  const responses = await prisma.response.findMany({
    where: { form: formFilter, ...dw },
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

export async function getTopBottomPerformers(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);

  const agents = await prisma.agent.findMany({
    where: { ...campaignFilter, active: true },
    include: {
      responses: {
        where: dw,
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

  const evaluators = await prisma.user.findMany({
    where: {
      responses: {
        some: { form: formFilter, ...dw },
      },
    },
    include: {
      responses: {
        where: { form: formFilter, ...dw },
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
        scores.length > 1
          ? scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / scores.length
          : 0;
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
  return getEvaluatorActivityForPermission(
    DASHBOARD_READ_PERMISSION,
    campaignId,
    dateFrom,
    dateTo,
  );
}

export async function getEvaluatorActivity(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return getEvaluatorActivityForPermission(KPI_READ_PERMISSION, campaignId, dateFrom, dateTo);
}

// ─── Evaluations per Agent (volume) ────────────────

export async function getEvaluationsPerAgent(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);

  const agents = await prisma.agent.findMany({
    where: { ...campaignFilter, active: true },
    include: {
      responses: {
        where: dw,
        select: { id: true },
      },
    },
  });

  return agents
    .filter((a) => a.responses.length > 0)
    .map((a) => ({
      id: a.id,
      name: a.name,
      count: a.responses.length,
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
        where: dw,
        select: { score: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const ranked = agents
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
          dayResponses.map((r) => Number(r.score)).reduce((a, b) => a + b, 0) /
          dayResponses.length;
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
  const passThreshold = await getPassThreshold();
  const where = { ...campaignFilter, active: true };

  const agents = await prisma.agent.findMany({
    where,
    include: {
      campaign: { select: { name: true } },
      responses: {
        select: { score: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return agents.map((agent) => {
    const scores = agent.responses.map((r) => Number(r.score));
    const total = scores.length;
    const avgScore = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
    const passCount = scores.filter((s) => s >= passThreshold).length;
    const lastScore = scores[0] ?? null;
    const minScore = total > 0 ? Math.min(...scores) : null;
    const maxScore = total > 0 ? Math.max(...scores) : null;

    // Trend: compare last 5 vs previous 5
    const recent5 = scores.slice(0, 5);
    const prev5 = scores.slice(5, 10);
    const recentAvg =
      recent5.length > 0 ? recent5.reduce((a, b) => a + b, 0) / recent5.length : 0;
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

  const where: Record<string, unknown> = {
    form: campaignFilter,
    ...(filters.formId ? { formId: filters.formId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...dateWhere(filters.dateFrom, filters.dateTo),
  };

  const responses = await prisma.response.findMany({
    where,
    include: {
      form: { select: { title: true, campaignId: true } },
      agent: { select: { name: true, agentCode: true } },
      evaluator: { select: { name: true } },
      answers: {
        include: {
          question: { select: { label: true, type: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return responses.map((r) => ({
    id: r.id,
    formTitle: r.form.title,
    agentName: r.agent.name,
    agentCode: r.agent.agentCode,
    evaluatorName: r.evaluator.name,
    score: Number(r.score),
    createdAt: r.createdAt.toISOString(),
    answers: r.answers.map((a) => ({
      question: a.question.label,
      questionType: a.question.type,
      value: a.value,
    })),
  }));
}

// ─── Score distribution for charts ──────────────────

export async function getScoreDistribution(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(DASHBOARD_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();
  const where = { form: campaignFilter, ...dw };

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
  const passThreshold = await getPassThreshold();

  const campaigns = await prisma.campaign.findMany({
    where: campaignFilter.campaignId ? { id: campaignFilter.campaignId } : {},
    include: {
      forms: { select: { id: true } },
      agents: { where: { active: true }, select: { id: true } },
      _count: { select: { users: true } },
    },
  });

  // Calculate date range days for daily rate
  let rangeDays = 30; // default
  if (dateFrom && dateTo) {
    rangeDays = Math.max(
      1,
      Math.ceil(
        (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24),
      ) + 1,
    );
  } else if (dateFrom) {
    rangeDays = Math.max(
      1,
      Math.ceil((Date.now() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24)),
    );
  }

  const results = await Promise.all(
    campaigns.map(async (campaign) => {
      const formIds = campaign.forms.map((f) => f.id);

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
        };
      }

      const [evalCount, avgScore, passCount] = await Promise.all([
        prisma.response.count({ where: { formId: { in: formIds }, ...dw } }),
        prisma.response.aggregate({
          where: { formId: { in: formIds }, ...dw },
          _avg: { score: true },
        }),
        prisma.response.count({
          where: { formId: { in: formIds }, ...dw, score: { gte: passThreshold } },
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
        dailyRate: Math.round((evalCount / rangeDays) * 100) / 100,
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

export async function getCampaignKpis(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  return getCampaignKpisForPermission(KPI_READ_PERMISSION, campaignId, dateFrom, dateTo);
}

// ─── Score by Question (per campaign) ──────────────

export async function getScoreByQuestion(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);

  const answers = await prisma.answer.findMany({
    where: {
      question: { type: "RATING" },
      response: {
        form: campaignFilter,
        ...dw,
      },
    },
    include: {
      question: { select: { label: true } },
    },
  });

  const questionMap = new Map<string, { total: number; count: number }>();
  for (const a of answers) {
    const val = Number(a.value);
    if (Number.isNaN(val)) continue;
    const existing = questionMap.get(a.question.label) ?? { total: 0, count: 0 };
    existing.total += val;
    existing.count++;
    questionMap.set(a.question.label, existing);
  }

  return Array.from(questionMap.entries())
    .map(([label, data]) => ({
      question: label,
      avgScore: Math.round((data.total / data.count / 5) * 100 * 100) / 100, // rating is 1-5, convert to %
      totalAnswers: data.count,
    }))
    .sort((a, b) => a.avgScore - b.avgScore); // worst first
}

// ─── Team Performance ─────────────────────────────

export async function getTeamPerformance(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const teams = await prisma.team.findMany({
    where: campaignFilter,
    include: {
      agents: {
        where: { active: true },
        include: {
          responses: { where: dw, select: { score: true } },
        },
      },
    },
  });

  return teams
    .map((team) => {
      const allScores = team.agents.flatMap((a) => a.responses.map((r) => Number(r.score)));
      const total = allScores.length;
      const avg = total > 0 ? allScores.reduce((a, b) => a + b, 0) / total : 0;
      const passCount = allScores.filter((s) => s >= passThreshold).length;

      return {
        id: team.id,
        name: team.name,
        agentCount: team.agents.length,
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
  const passThreshold = await getPassThreshold();

  const dispositions = await prisma.disposition.findMany({
    where: { ...campaignFilter, active: true },
    include: {
      category: { select: { name: true } },
      responses: {
        where: dw,
        select: { score: true },
      },
    },
  });

  return dispositions
    .map((d) => {
      const scores = d.responses.map((r) => Number(r.score));
      const total = scores.length;
      const avg = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
      const passCount = scores.filter((s) => s >= passThreshold).length;

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

// ─── Agent Detail (drill-down) ────────────────────

export async function getAgentDetail(
  agentId: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const dw = dateWhere(dateFrom, dateTo);

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      campaign: { select: { name: true } },
      team: { select: { name: true } },
      responses: {
        where: dw,
        include: {
          form: { select: { title: true } },
          evaluator: { select: { id: true, name: true } },
          disposition: { select: { id: true, name: true } },
          answers: {
            include: { question: { select: { label: true, type: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!agent) throw new Error("Agente no encontrado");
  await assertCampaignPermissionForUser(session.user, agent.campaignId, KPI_READ_PERMISSION);

  // Score trend (daily)
  const dayMap = new Map<string, { total: number; count: number }>();
  for (const r of agent.responses) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const ex = dayMap.get(day) ?? { total: 0, count: 0 };
    ex.total += Number(r.score);
    ex.count++;
    dayMap.set(day, ex);
  }
  const scoreTrend = Array.from(dayMap.entries())
    .map(([date, d]) => ({ date, avgScore: Math.round((d.total / d.count) * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Score by question (RATING only)
  const questionMap = new Map<string, { total: number; count: number }>();
  for (const r of agent.responses) {
    for (const a of r.answers) {
      if (a.question.type !== "RATING") continue;
      const val = Number(a.value);
      if (Number.isNaN(val)) continue;
      const ex = questionMap.get(a.question.label) ?? { total: 0, count: 0 };
      ex.total += val;
      ex.count++;
      questionMap.set(a.question.label, ex);
    }
  }
  const scoreByQuestion = Array.from(questionMap.entries())
    .map(([question, d]) => ({
      question,
      avgScore: Math.round((d.total / d.count / 5) * 100 * 100) / 100,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // Disposition breakdown
  const dispMap = new Map<string, { name: string; count: number; totalScore: number }>();
  for (const r of agent.responses) {
    if (!r.disposition) continue;
    const ex = dispMap.get(r.disposition.id) ?? { name: r.disposition.name, count: 0, totalScore: 0 };
    ex.count++;
    ex.totalScore += Number(r.score);
    dispMap.set(r.disposition.id, ex);
  }
  const dispositionBreakdown = Array.from(dispMap.values())
    .map((d) => ({ name: d.name, count: d.count, avgScore: Math.round((d.totalScore / d.count) * 100) / 100 }))
    .sort((a, b) => b.count - a.count);

  // Evaluators
  const evalMap = new Map<string, { name: string; count: number; avgScore: number }>();
  for (const r of agent.responses) {
    const ex = evalMap.get(r.evaluator.id) ?? { name: r.evaluator.name, count: 0, avgScore: 0 };
    ex.count++;
    ex.avgScore += Number(r.score);
    evalMap.set(r.evaluator.id, ex);
  }
  const evaluators = Array.from(evalMap.entries())
    .map(([id, d]) => ({ id, name: d.name, count: d.count, avgScore: Math.round((d.avgScore / d.count) * 100) / 100 }))
    .sort((a, b) => b.count - a.count);

  // Recent responses (last 10)
  const recentResponses = agent.responses.slice(0, 10).map((r) => ({
    id: r.id,
    formTitle: r.form.title,
    evaluatorName: r.evaluator.name,
    dispositionName: r.disposition?.name ?? null,
    score: Number(r.score),
    createdAt: r.createdAt.toISOString(),
  }));

  const allScores = agent.responses.map((r) => Number(r.score));
  const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  return {
    name: agent.name,
    agentCode: agent.agentCode,
    campaignName: agent.campaign.name,
    teamName: agent.team?.name ?? null,
    totalEvaluations: agent.responses.length,
    avgScore: Math.round(avgScore * 100) / 100,
    scoreTrend,
    scoreByQuestion,
    dispositionBreakdown,
    evaluators,
    recentResponses,
  };
}

// ─── Evaluator Detail (drill-down) ────────────────

export async function getEvaluatorDetail(
  userId: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission(KPI_READ_PERMISSION);
  const dw = dateWhere(dateFrom, dateTo);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) throw new Error("Evaluador no encontrado");

  if (session.user.role !== "ADMIN") {
    const visibleResponseCount = await prisma.response.count({
      where: { evaluatorId: userId, form: campaignFilter },
    });

    if (visibleResponseCount === 0) {
      throw new Error("Evaluador no encontrado");
    }
  }

  const responses = await prisma.response.findMany({
    where: { evaluatorId: userId, form: campaignFilter, ...dw },
    include: {
      agent: { select: { id: true, name: true } },
      disposition: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

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
  const agentMap = new Map<string, { id: string; name: string; count: number; totalScore: number }>();
  for (const r of responses) {
    const ex = agentMap.get(r.agent.id) ?? { id: r.agent.id, name: r.agent.name, count: 0, totalScore: 0 };
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
    where: { form: campaignFilter, ...dw },
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

export async function getTeamDetail(
  teamId: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      campaign: { select: { name: true } },
      agents: {
        where: { active: true },
        include: {
          responses: { where: dw, select: { score: true, createdAt: true } },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!team) throw new Error("Equipo no encontrado");
  await assertCampaignPermissionForUser(session.user, team.campaignId, KPI_READ_PERMISSION);

  // Agent ranking
  const agentRanking = team.agents
    .map((a) => {
      const scores = a.responses.map((r) => Number(r.score));
      const total = scores.length;
      const avg = total > 0 ? scores.reduce((x, y) => x + y, 0) / total : 0;
      const passCount = scores.filter((s) => s >= passThreshold).length;
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
  for (const a of team.agents) {
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

  const allScores = team.agents.flatMap((a) => a.responses.map((r) => Number(r.score)));
  const totalAvg = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  return {
    name: team.name,
    campaignName: team.campaign.name,
    agentCount: team.agents.length,
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
  const passThreshold = await getPassThreshold();

  const disposition = await prisma.disposition.findUnique({
    where: { id: dispositionId },
    include: {
      category: { select: { name: true } },
      campaign: { select: { id: true, name: true } },
    },
  });

  if (!disposition) throw new Error("Disposición no encontrada");

  await assertCampaignPermissionForUser(session.user, disposition.campaignId, KPI_READ_PERMISSION);

  const responses = await prisma.response.findMany({
    where: { dispositionId, ...dw },
    include: {
      agent: { select: { id: true, name: true } },
      evaluator: { select: { id: true, name: true } },
      form: { select: { title: true } },
      answers: {
        include: { question: { select: { label: true, type: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

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
    const ex =
      agentMap.get(r.agent.id) ??
      { id: r.agent.id, name: r.agent.name, count: 0, totalScore: 0 };
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
    const ex =
      evaluatorMap.get(r.evaluator.id) ??
      { id: r.evaluator.id, name: r.evaluator.name, count: 0, totalScore: 0 };
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

  // Score por pregunta (solo RATING, normalizado a %)
  const questionMap = new Map<string, { total: number; count: number }>();
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.question.type !== "RATING") continue;
      const val = Number(a.value);
      if (Number.isNaN(val)) continue;
      const ex = questionMap.get(a.question.label) ?? { total: 0, count: 0 };
      ex.total += val;
      ex.count++;
      questionMap.set(a.question.label, ex);
    }
  }
  const scoreByQuestion = Array.from(questionMap.entries())
    .map(([question, d]) => ({
      question,
      avgScore: Math.round((d.total / d.count / 5) * 100 * 100) / 100,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // Promedio global (mismo dateRange, respetando RBAC) para comparación
  const globalAgg = await prisma.response.aggregate({
    where: {
      form: campaignFilter,
      ...dw,
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
  if (disposition.categoryId) {
    const sisters = await prisma.disposition.findMany({
      where: {
        categoryId: disposition.categoryId,
        campaignId: disposition.campaignId,
        id: { not: dispositionId },
      },
      include: {
        responses: { where: dw, select: { score: true } },
      },
    });
    sisterDispositions = sisters
      .map((s) => {
        const scores = s.responses.map((r) => Number(r.score));
        const avg =
          scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
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
    createdAt: r.createdAt.toISOString(),
  }));

  const allScores = responses.map((r) => Number(r.score));
  const avgScore =
    allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;
  const passCount = allScores.filter((s) => s >= passThreshold).length;
  const passRate =
    allScores.length > 0 ? Math.round((passCount / allScores.length) * 100) : 0;

  return {
    id: disposition.id,
    name: disposition.name,
    code: disposition.code,
    campaignName: disposition.campaign.name,
    categoryName: disposition.category?.name ?? null,
    active: disposition.active,
    totalEvaluations: responses.length,
    avgScore: Math.round(avgScore * 100) / 100,
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
      form: { select: { id: true, title: true, campaignId: true } },
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
      disposition: { select: { id: true, name: true, code: true } },
      answers: {
        include: {
          question: { select: { id: true, label: true, type: true, order: true } },
        },
        orderBy: { question: { order: "asc" } },
      },
    },
  });

  if (!response) throw new Error("Evaluación no encontrada");

  await assertCampaignPermissionForUser(session.user, response.form.campaignId, REPORT_READ_PERMISSION);

  return {
    id: response.id,
    score: Number(response.score),
    createdAt: response.createdAt.toISOString(),
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
      value: a.value,
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
  limit?: number;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const { minScore, maxScore, campaignId, dateFrom, dateTo } = params;
  const limit = params.limit ?? 200;

  const formFilter = await getCampaignFilterForPermission(REPORT_READ_PERMISSION, campaignId);
  const dw = dateWhere(dateFrom, dateTo);

  const scoreFilter: { gte?: number; lte?: number } = {};
  if (minScore !== undefined) scoreFilter.gte = minScore;
  if (maxScore !== undefined) scoreFilter.lte = maxScore;

  const [responses, totalCount] = await Promise.all([
    prisma.response.findMany({
      where: {
        form: formFilter,
        ...(Object.keys(scoreFilter).length > 0 ? { score: scoreFilter } : {}),
        ...dw,
      },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            campaign: { select: { name: true } },
          },
        },
        evaluator: { select: { id: true, name: true } },
        form: { select: { id: true, title: true } },
        disposition: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.response.count({
      where: {
        form: formFilter,
        ...(Object.keys(scoreFilter).length > 0 ? { score: scoreFilter } : {}),
        ...dw,
      },
    }),
  ]);

  return {
    responses: responses.map((r) => ({
      id: r.id,
      score: Number(r.score),
      createdAt: r.createdAt.toISOString(),
      agent: {
        id: r.agent.id,
        name: r.agent.name,
        campaignName: r.agent.campaign.name,
      },
      evaluator: { id: r.evaluator.id, name: r.evaluator.name },
      form: { id: r.form.id, title: r.form.title },
      disposition: r.disposition
        ? { id: r.disposition.id, name: r.disposition.name }
        : null,
    })),
    totalCount,
    shownCount: responses.length,
    limit,
  };
}
