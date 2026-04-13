"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getPassThreshold } from "@/lib/settings";
import { getCampaignFilter } from "./campaign-filter";

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

export async function getDashboardStats(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const [formCount, responseCount, avgScore, passCount, failCount, recentResponses] =
    await Promise.all([
      prisma.form.count({ where: campaignFilter }),
      prisma.response.count({ where: { form: campaignFilter, ...dw } }),
      prisma.response.aggregate({
        where: { form: campaignFilter, ...dw },
        _avg: { score: true },
      }),
      prisma.response.count({
        where: { form: campaignFilter, ...dw, score: { gte: passThreshold } },
      }),
      prisma.response.count({
        where: { form: campaignFilter, ...dw, score: { lt: passThreshold } },
      }),
      prisma.response.findMany({
        where: { form: campaignFilter, ...dw },
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

export async function getResponseTrends(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
  const dw = dateWhere(dateFrom, dateTo);

  const responses = await prisma.response.findMany({
    where: { form: campaignFilter, ...dw },
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

export async function getTopBottomPerformers(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
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

export async function getEvaluatorActivity(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
  const dw = dateWhere(dateFrom, dateTo);

  const evaluators = await prisma.user.findMany({
    where: {
      responses: {
        some: { form: campaignFilter, ...dw },
      },
    },
    include: {
      responses: {
        where: { form: campaignFilter, ...dw },
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

// ─── Evaluations per Agent (volume) ────────────────

export async function getEvaluationsPerAgent(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
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

  const campaignFilter = await getCampaignFilter();
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

  const campaignFilter = await getCampaignFilter();
  const passThreshold = await getPassThreshold();
  const where = {
    ...campaignFilter,
    ...(campaignId ? { campaignId } : {}),
    active: true,
  };

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

  const campaignFilter = await getCampaignFilter();

  const where: Record<string, unknown> = {
    form: {
      ...campaignFilter,
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    },
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

  const campaignFilter = await getCampaignFilter();
  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();
  const where = {
    form: {
      ...campaignFilter,
      ...(campaignId ? { campaignId } : {}),
    },
    ...dw,
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

export async function getCampaignKpis(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
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

// ─── Team Performance ─────────────────────────────

export async function getTeamPerformance(dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const teams = await prisma.team.findMany({
    where: { ...campaignFilter, active: true },
    include: {
      campaign: { select: { name: true } },
      agents: {
        where: { active: true },
        include: {
          responses: {
            where: dw,
            select: { score: true },
          },
        },
      },
    },
  });

  return teams
    .map((team) => {
      const allScores = team.agents.flatMap((a) =>
        a.responses.map((r) => Number(r.score)),
      );
      const total = allScores.length;
      const avgScore =
        total > 0 ? allScores.reduce((a, b) => a + b, 0) / total : 0;
      const passCount = allScores.filter((s) => s >= passThreshold).length;

      return {
        id: team.id,
        name: team.name,
        campaignName: team.campaign.name,
        agentCount: team.agents.length,
        totalEvaluations: total,
        avgScore: Math.round(avgScore * 100) / 100,
        passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
      };
    })
    .filter((t) => t.totalEvaluations > 0)
    .sort((a, b) => b.avgScore - a.avgScore);
}

// ─── Disposition Analytics ────────────────────────

export async function getDispositionAnalytics(
  campaignId?: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const dispositions = await prisma.disposition.findMany({
    where: {
      ...campaignFilter,
      ...(campaignId ? { campaignId } : {}),
      active: true,
    },
    include: {
      category: { select: { name: true } },
      responses: {
        where: dw,
        select: { score: true, createdAt: true },
      },
    },
  });

  return dispositions
    .map((d) => {
      const scores = d.responses.map((r) => Number(r.score));
      const total = scores.length;
      const avgScore =
        total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
      const passCount = scores.filter((s) => s >= passThreshold).length;

      return {
        id: d.id,
        name: d.name,
        code: d.code,
        categoryName: d.category?.name ?? null,
        totalEvaluations: total,
        avgScore: Math.round(avgScore * 100) / 100,
        passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
      };
    })
    .filter((d) => d.totalEvaluations > 0)
    .sort((a, b) => b.totalEvaluations - a.totalEvaluations);
}

// ─── Agent Detail Analytics (for drill-down) ──────

export async function getAgentDetail(agentId: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      campaign: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      responses: {
        where: dw,
        include: {
          form: { select: { title: true } },
          evaluator: { select: { id: true, name: true } },
          disposition: { select: { id: true, name: true } },
          answers: {
            include: {
              question: { select: { label: true, type: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!agent) throw new Error("Agente no encontrado");

  const scores = agent.responses.map((r) => Number(r.score));
  const total = scores.length;
  const avgScore = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
  const passCount = scores.filter((s) => s >= passThreshold).length;

  // Score trend by day
  const dayMap = new Map<string, { count: number; total: number }>();
  for (const r of agent.responses) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const existing = dayMap.get(day) ?? { count: 0, total: 0 };
    existing.count++;
    existing.total += Number(r.score);
    dayMap.set(day, existing);
  }
  const scoreTrend = Array.from(dayMap.entries())
    .map(([date, data]) => ({
      date,
      avgScore: Math.round((data.total / data.count) * 100) / 100,
      count: data.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Score by question (RATING only)
  const questionMap = new Map<string, { total: number; count: number }>();
  for (const r of agent.responses) {
    for (const a of r.answers) {
      if (a.question.type !== "RATING") continue;
      const val = Number(a.value);
      if (Number.isNaN(val)) continue;
      const existing = questionMap.get(a.question.label) ?? { total: 0, count: 0 };
      existing.total += val;
      existing.count++;
      questionMap.set(a.question.label, existing);
    }
  }
  const scoreByQuestion = Array.from(questionMap.entries())
    .map(([label, data]) => ({
      question: label,
      avgScore: Math.round((data.total / data.count / 5) * 100 * 100) / 100,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // Disposition breakdown
  const dispMap = new Map<string, { name: string; count: number; totalScore: number }>();
  for (const r of agent.responses) {
    if (!r.disposition) continue;
    const existing = dispMap.get(r.disposition.id) ?? {
      name: r.disposition.name,
      count: 0,
      totalScore: 0,
    };
    existing.count++;
    existing.totalScore += Number(r.score);
    dispMap.set(r.disposition.id, existing);
  }
  const dispositionBreakdown = Array.from(dispMap.values())
    .map((d) => ({
      name: d.name,
      count: d.count,
      avgScore: Math.round((d.totalScore / d.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Evaluators who evaluated this agent
  const evalMap = new Map<string, { name: string; count: number; totalScore: number }>();
  for (const r of agent.responses) {
    const existing = evalMap.get(r.evaluator.id) ?? {
      name: r.evaluator.name,
      count: 0,
      totalScore: 0,
    };
    existing.count++;
    existing.totalScore += Number(r.score);
    evalMap.set(r.evaluator.id, existing);
  }
  const evaluators = Array.from(evalMap.entries())
    .map(([id, data]) => ({
      id,
      name: data.name,
      count: data.count,
      avgScore: Math.round((data.totalScore / data.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    id: agent.id,
    name: agent.name,
    agentCode: agent.agentCode,
    campaignName: agent.campaign.name,
    campaignId: agent.campaign.id,
    teamName: agent.team?.name ?? null,
    teamId: agent.team?.id ?? null,
    totalEvaluations: total,
    avgScore: Math.round(avgScore * 100) / 100,
    passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
    minScore: total > 0 ? Math.min(...scores) : null,
    maxScore: total > 0 ? Math.max(...scores) : null,
    passThreshold,
    scoreTrend,
    scoreByQuestion,
    dispositionBreakdown,
    evaluators,
    recentResponses: agent.responses.slice(0, 20).map((r) => ({
      id: r.id,
      formTitle: r.form.title,
      evaluatorName: r.evaluator.name,
      dispositionName: r.disposition?.name ?? null,
      score: Number(r.score),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ─── Evaluator Detail Analytics (for drill-down) ──

export async function getEvaluatorDetail(userId: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      campaigns: {
        include: { campaign: { select: { id: true, name: true } } },
      },
      responses: {
        where: dw,
        include: {
          agent: { select: { id: true, name: true } },
          form: { select: { title: true } },
          disposition: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) throw new Error("Evaluador no encontrado");

  const scores = user.responses.map((r) => Number(r.score));
  const total = scores.length;
  const avgScore = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;
  const variance =
    total > 1 ? scores.reduce((sum, s) => sum + (s - avgScore) ** 2, 0) / total : 0;
  const stdDev = Math.sqrt(variance);

  // Activity by day
  const dayMap = new Map<string, number>();
  for (const r of user.responses) {
    const day = r.createdAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const activityByDay = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Agents evaluated
  const agentMap = new Map<string, { name: string; count: number; totalScore: number }>();
  for (const r of user.responses) {
    const existing = agentMap.get(r.agent.id) ?? {
      name: r.agent.name,
      count: 0,
      totalScore: 0,
    };
    existing.count++;
    existing.totalScore += Number(r.score);
    agentMap.set(r.agent.id, existing);
  }
  const agentsEvaluated = Array.from(agentMap.entries())
    .map(([id, data]) => ({
      id,
      name: data.name,
      count: data.count,
      avgScore: Math.round((data.totalScore / data.count) * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Disposition frequency
  const dispMap = new Map<string, number>();
  for (const r of user.responses) {
    if (r.disposition) {
      dispMap.set(r.disposition.name, (dispMap.get(r.disposition.name) ?? 0) + 1);
    }
  }
  const dispositionFrequency = Array.from(dispMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    campaigns: user.campaigns.map((uc) => ({
      id: uc.campaign.id,
      name: uc.campaign.name,
    })),
    totalEvaluations: total,
    avgScore: Math.round(avgScore * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    passThreshold,
    activityByDay,
    agentsEvaluated,
    dispositionFrequency,
    recentResponses: user.responses.slice(0, 20).map((r) => ({
      id: r.id,
      agentName: r.agent.name,
      formTitle: r.form.title,
      dispositionName: r.disposition?.name ?? null,
      score: Number(r.score),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ─── Team Detail Analytics (for drill-down) ───────

export async function getTeamDetail(teamId: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const dw = dateWhere(dateFrom, dateTo);
  const passThreshold = await getPassThreshold();

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      campaign: { select: { id: true, name: true } },
      agents: {
        where: { active: true },
        include: {
          responses: {
            where: dw,
            select: { score: true, createdAt: true },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!team) throw new Error("Equipo no encontrado");

  const allScores = team.agents.flatMap((a) =>
    a.responses.map((r) => Number(r.score)),
  );
  const total = allScores.length;
  const avgScore = total > 0 ? allScores.reduce((a, b) => a + b, 0) / total : 0;
  const passCount = allScores.filter((s) => s >= passThreshold).length;

  // Agent ranking within team
  const agentRanking = team.agents
    .map((a) => {
      const scores = a.responses.map((r) => Number(r.score));
      const count = scores.length;
      const avg = count > 0 ? scores.reduce((x, y) => x + y, 0) / count : 0;
      const passes = scores.filter((s) => s >= passThreshold).length;
      return {
        id: a.id,
        name: a.name,
        totalEvaluations: count,
        avgScore: Math.round(avg * 100) / 100,
        passRate: count > 0 ? Math.round((passes / count) * 100) : 0,
      };
    })
    .filter((a) => a.totalEvaluations > 0)
    .sort((a, b) => b.avgScore - a.avgScore);

  // Team score trend by day
  const dayMap = new Map<string, { count: number; total: number }>();
  for (const agent of team.agents) {
    for (const r of agent.responses) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const existing = dayMap.get(day) ?? { count: 0, total: 0 };
      existing.count++;
      existing.total += Number(r.score);
      dayMap.set(day, existing);
    }
  }
  const scoreTrend = Array.from(dayMap.entries())
    .map(([date, data]) => ({
      date,
      avgScore: Math.round((data.total / data.count) * 100) / 100,
      count: data.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    id: team.id,
    name: team.name,
    campaignName: team.campaign.name,
    campaignId: team.campaign.id,
    agentCount: team.agents.length,
    totalEvaluations: total,
    avgScore: Math.round(avgScore * 100) / 100,
    passRate: total > 0 ? Math.round((passCount / total) * 100) : 0,
    passThreshold,
    agentRanking,
    scoreTrend,
  };
}

// ─── Score by Question (per campaign) ──────────────

export async function getScoreByQuestion(campaignId?: string, dateFrom?: string, dateTo?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
  const dw = dateWhere(dateFrom, dateTo);

  const answers = await prisma.answer.findMany({
    where: {
      question: { type: "RATING" },
      response: {
        form: {
          ...campaignFilter,
          ...(campaignId ? { campaignId } : {}),
        },
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
