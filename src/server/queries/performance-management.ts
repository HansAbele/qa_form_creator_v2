import { auth } from "@/lib/auth";
import { elapsedSeconds } from "@/lib/performance-management";
import { prisma } from "@/lib/prisma";

const ACTIVE_PIP_STATUSES = ["ACTIVE", "ON_HOLD", "EXTENDED"] as const;
const OPEN_COACHING_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "IN_PROGRESS",
  "AWAITING_ACKNOWLEDGEMENT",
] as const;

function unique(values: string[]) {
  return [...new Set(values)];
}

function activitySeconds(
  activity: {
    totalSeconds: number;
    status: string;
    intervals: { startedAt: Date }[];
  },
  now: Date,
) {
  const openStartedAt = activity.status === "ACTIVE" ? activity.intervals[0]?.startedAt : null;
  return activity.totalSeconds + (openStartedAt ? elapsedSeconds(openStartedAt, now) : 0);
}

export async function getPerformanceWorkspace() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const accessRows =
    session.user.role === "ADMIN"
      ? (
          await prisma.campaign.findMany({
            where: { active: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        ).map((campaign) => ({
          campaign,
          canViewCoaching: true,
          canManageCoaching: true,
          canTrackQaActivity: true,
          canViewQaActivity: true,
          canViewPips: true,
          canManagePips: true,
        }))
      : await prisma.userCampaign.findMany({
          where: {
            userId: session.user.id,
            campaignId: { in: session.user.campaignIds },
            campaign: { active: true },
          },
          select: {
            campaign: { select: { id: true, name: true } },
            canViewCoaching: true,
            canManageCoaching: true,
            canTrackQaActivity: true,
            canViewQaActivity: true,
            canViewPips: true,
            canManagePips: true,
          },
          orderBy: { campaign: { name: "asc" } },
        });

  const coachingCampaignIds = accessRows
    .filter((row) => row.canViewCoaching || row.canManageCoaching)
    .map((row) => row.campaign.id);
  const manageCoachingCampaignIds = accessRows
    .filter((row) => row.canManageCoaching)
    .map((row) => row.campaign.id);
  const trackActivityCampaignIds = accessRows
    .filter((row) => row.canTrackQaActivity)
    .map((row) => row.campaign.id);
  const viewActivityCampaignIds = accessRows
    .filter((row) => row.canViewQaActivity)
    .map((row) => row.campaign.id);
  const pipCampaignIds = accessRows
    .filter((row) => row.canViewPips || row.canManagePips)
    .map((row) => row.campaign.id);
  const managePipCampaignIds = accessRows
    .filter((row) => row.canManagePips)
    .map((row) => row.campaign.id);
  const agentCampaignIds = unique([
    ...coachingCampaignIds,
    ...manageCoachingCampaignIds,
    ...pipCampaignIds,
    ...managePipCampaignIds,
  ]);
  const now = new Date();
  const activityFrom = new Date(now);
  activityFrom.setUTCDate(activityFrom.getUTCDate() - 30);

  const activityScope = [
    ...(trackActivityCampaignIds.length > 0
      ? [{ userId: session.user.id, campaignId: { in: trackActivityCampaignIds } }]
      : []),
    ...(viewActivityCampaignIds.length > 0
      ? [{ campaignId: { in: viewActivityCampaignIds } }]
      : []),
  ];

  const [agents, recentEvaluations, coachingRows, activityRows, pipRows, workloadRows] =
    await Promise.all([
      agentCampaignIds.length > 0
        ? prisma.agent.findMany({
            where: { active: true, campaignId: { in: agentCampaignIds } },
            select: {
              id: true,
              name: true,
              agentCode: true,
              campaignId: true,
              campaign: { select: { name: true } },
              team: { select: { name: true } },
            },
            orderBy: [{ campaign: { name: "asc" } }, { name: "asc" }],
          })
        : Promise.resolve([]),
      manageCoachingCampaignIds.length > 0
        ? prisma.response.findMany({
            where: {
              status: "SUBMITTED",
              form: { campaignId: { in: manageCoachingCampaignIds } },
            },
            select: {
              id: true,
              score: true,
              result: true,
              hasFatalFail: true,
              submittedAt: true,
              interactionId: true,
              form: { select: { title: true, campaignId: true } },
              agent: { select: { id: true, name: true } },
            },
            orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
            take: 100,
          })
        : Promise.resolve([]),
      coachingCampaignIds.length > 0
        ? prisma.coachingSession.findMany({
            where: { campaignId: { in: coachingCampaignIds } },
            select: {
              id: true,
              campaignId: true,
              title: true,
              focusArea: true,
              behavior: true,
              objective: true,
              source: true,
              status: true,
              scheduledAt: true,
              acknowledgementDueAt: true,
              followUpAt: true,
              startedAt: true,
              endedAt: true,
              createdAt: true,
              agent: { select: { id: true, name: true, agentCode: true } },
              coach: { select: { id: true, name: true } },
              campaign: { select: { name: true } },
              response: { select: { id: true, score: true, hasFatalFail: true } },
              actionItems: {
                select: { id: true, description: true, status: true, dueAt: true },
                orderBy: [{ status: "asc" }, { dueAt: "asc" }],
              },
              acknowledgement: {
                select: {
                  status: true,
                  method: true,
                  acknowledgedAt: true,
                  refusedAt: true,
                  comment: true,
                },
              },
              activities: {
                where: { activityType: "COACHING_LIVE" },
                select: {
                  totalSeconds: true,
                  status: true,
                  intervals: {
                    where: { endedAt: null },
                    select: { startedAt: true },
                    take: 1,
                  },
                },
              },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
          })
        : Promise.resolve([]),
      activityScope.length > 0
        ? prisma.qaActivitySession.findMany({
            where: { OR: activityScope },
            select: {
              id: true,
              campaignId: true,
              activityType: true,
              status: true,
              label: true,
              notes: true,
              startedAt: true,
              endedAt: true,
              totalSeconds: true,
              user: { select: { id: true, name: true } },
              campaign: { select: { name: true } },
              coachingSession: { select: { id: true, title: true } },
              pipPlan: { select: { id: true, title: true } },
              intervals: {
                where: { endedAt: null },
                select: { startedAt: true },
                orderBy: { startedAt: "desc" },
                take: 1,
              },
            },
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            take: 100,
          })
        : Promise.resolve([]),
      pipCampaignIds.length > 0
        ? prisma.pipPlan.findMany({
            where: { campaignId: { in: pipCampaignIds } },
            select: {
              id: true,
              campaignId: true,
              title: true,
              templateKey: true,
              templateVersion: true,
              reason: true,
              objective: true,
              status: true,
              startDate: true,
              targetEndDate: true,
              midpointDate: true,
              finalReviewDate: true,
              acknowledgementStatus: true,
              approvedAt: true,
              closedAt: true,
              agent: { select: { id: true, name: true, agentCode: true } },
              campaign: { select: { name: true } },
              owner: { select: { id: true, name: true } },
              approvedBy: { select: { id: true, name: true } },
              goals: {
                select: {
                  id: true,
                  area: true,
                  baseline: true,
                  target: true,
                  dataSource: true,
                  isCritical: true,
                  currentResult: true,
                  status: true,
                },
                orderBy: { createdAt: "asc" },
              },
              reviews: {
                select: {
                  id: true,
                  scheduledAt: true,
                  completedAt: true,
                  outcome: true,
                  summary: true,
                  reviewer: { select: { name: true } },
                },
                orderBy: { scheduledAt: "desc" },
                take: 10,
              },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
          })
        : Promise.resolve([]),
      viewActivityCampaignIds.length > 0
        ? prisma.qaActivitySession.groupBy({
            by: ["userId", "activityType"],
            where: {
              campaignId: { in: viewActivityCampaignIds },
              startedAt: { gte: activityFrom },
              status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] },
            },
            _sum: { totalSeconds: true },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

  const workloadUserIds = unique(workloadRows.map((row) => row.userId));
  const workloadUsers =
    workloadUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: workloadUserIds }, active: true },
          select: { id: true, name: true },
        })
      : [];
  const workloadNames = new Map(workloadUsers.map((user) => [user.id, user.name]));
  const workloadMap = new Map<
    string,
    {
      userId: string;
      name: string;
      totalSeconds: number;
      sessionCount: number;
      evaluationSeconds: number;
      coachingSeconds: number;
    }
  >();
  for (const row of workloadRows) {
    const entry = workloadMap.get(row.userId) ?? {
      userId: row.userId,
      name: workloadNames.get(row.userId) ?? "Unavailable user",
      totalSeconds: 0,
      sessionCount: 0,
      evaluationSeconds: 0,
      coachingSeconds: 0,
    };
    const seconds = row._sum.totalSeconds ?? 0;
    entry.totalSeconds += seconds;
    entry.sessionCount += row._count._all;
    if (row.activityType === "EVALUATION") entry.evaluationSeconds += seconds;
    if (
      row.activityType === "COACHING_PREPARATION" ||
      row.activityType === "COACHING_LIVE" ||
      row.activityType === "COACHING_DOCUMENTATION"
    ) {
      entry.coachingSeconds += seconds;
    }
    workloadMap.set(row.userId, entry);
  }

  const activities = activityRows.map((activity) => ({
    id: activity.id,
    campaignId: activity.campaignId,
    campaignName: activity.campaign.name,
    userId: activity.user.id,
    userName: activity.user.name,
    activityType: activity.activityType,
    status: activity.status,
    label: activity.label,
    notes: activity.notes,
    startedAt: activity.startedAt.toISOString(),
    endedAt: activity.endedAt?.toISOString() ?? null,
    totalSeconds: activitySeconds(activity, now),
    persistedSeconds: activity.totalSeconds,
    openIntervalStartedAt: activity.intervals[0]?.startedAt.toISOString() ?? null,
    coachingSession: activity.coachingSession,
    pipPlan: activity.pipPlan,
  }));

  const coachingSessions = coachingRows.map((coaching) => ({
    ...coaching,
    response: coaching.response
      ? {
          ...coaching.response,
          score: Number(coaching.response.score),
        }
      : null,
    scheduledAt: coaching.scheduledAt?.toISOString() ?? null,
    acknowledgementDueAt: coaching.acknowledgementDueAt?.toISOString() ?? null,
    followUpAt: coaching.followUpAt?.toISOString() ?? null,
    startedAt: coaching.startedAt?.toISOString() ?? null,
    endedAt: coaching.endedAt?.toISOString() ?? null,
    createdAt: coaching.createdAt.toISOString(),
    liveSeconds: coaching.activities.reduce(
      (sum, activity) => sum + activitySeconds(activity, now),
      0,
    ),
    isAcknowledgementOverdue:
      coaching.status === "AWAITING_ACKNOWLEDGEMENT" &&
      Boolean(coaching.acknowledgementDueAt && coaching.acknowledgementDueAt < now),
    actionItems: coaching.actionItems.map((item) => ({
      ...item,
      dueAt: item.dueAt?.toISOString() ?? null,
    })),
    acknowledgement: coaching.acknowledgement
      ? {
          ...coaching.acknowledgement,
          acknowledgedAt: coaching.acknowledgement.acknowledgedAt?.toISOString() ?? null,
          refusedAt: coaching.acknowledgement.refusedAt?.toISOString() ?? null,
        }
      : null,
    activities: undefined,
  }));

  const pipPlans = pipRows.map((pip) => ({
    ...pip,
    startDate: pip.startDate.toISOString(),
    targetEndDate: pip.targetEndDate.toISOString(),
    midpointDate: pip.midpointDate?.toISOString() ?? null,
    finalReviewDate: pip.finalReviewDate?.toISOString() ?? null,
    approvedAt: pip.approvedAt?.toISOString() ?? null,
    closedAt: pip.closedAt?.toISOString() ?? null,
    reviews: pip.reviews.map((review) => ({
      ...review,
      scheduledAt: review.scheduledAt.toISOString(),
      completedAt: review.completedAt?.toISOString() ?? null,
    })),
  }));

  const ownCurrentActivity =
    activities.find(
      (activity) => activity.userId === session.user.id && activity.status === "ACTIVE",
    ) ??
    activities.find(
      (activity) => activity.userId === session.user.id && activity.status === "PAUSED",
    ) ??
    null;

  return {
    generatedAt: now.toISOString(),
    currentUser: {
      id: session.user.id,
      name: session.user.name ?? session.user.email ?? "User",
      isAdmin: session.user.role === "ADMIN",
    },
    access: {
      canViewCoaching: coachingCampaignIds.length > 0,
      canManageCoaching: manageCoachingCampaignIds.length > 0,
      canTrackQaActivity: trackActivityCampaignIds.length > 0,
      canViewQaActivity: viewActivityCampaignIds.length > 0,
      canViewPips: pipCampaignIds.length > 0,
      canManagePips: managePipCampaignIds.length > 0,
    },
    campaigns: accessRows.map((row) => ({
      id: row.campaign.id,
      name: row.campaign.name,
      canViewCoaching: row.canViewCoaching,
      canManageCoaching: row.canManageCoaching,
      canTrackQaActivity: row.canTrackQaActivity,
      canViewQaActivity: row.canViewQaActivity,
      canViewPips: row.canViewPips,
      canManagePips: row.canManagePips,
    })),
    agents,
    recentEvaluations: recentEvaluations.map((response) => ({
      id: response.id,
      campaignId: response.form.campaignId,
      agentId: response.agent.id,
      agentName: response.agent.name,
      formTitle: response.form.title,
      score: Number(response.score),
      result: response.result,
      hasFatalFail: response.hasFatalFail,
      submittedAt: response.submittedAt?.toISOString() ?? null,
      interactionId: response.interactionId,
    })),
    coachingSessions,
    activities,
    ownCurrentActivity,
    pipPlans,
    qaWorkload: Array.from(workloadMap.values()).sort(
      (left, right) => right.totalSeconds - left.totalSeconds,
    ),
    summary: {
      openCoaching: coachingSessions.filter((item) =>
        (OPEN_COACHING_STATUSES as readonly string[]).includes(item.status),
      ).length,
      awaitingAcknowledgement: coachingSessions.filter(
        (item) => item.status === "AWAITING_ACKNOWLEDGEMENT",
      ).length,
      overdueAcknowledgement: coachingSessions.filter((item) => item.isAcknowledgementOverdue)
        .length,
      activePips: pipPlans.filter((item) =>
        (ACTIVE_PIP_STATUSES as readonly string[]).includes(item.status),
      ).length,
      pendingPipApproval: pipPlans.filter((item) => item.status === "PENDING_APPROVAL").length,
    },
  };
}

export type PerformanceWorkspaceData = Awaited<ReturnType<typeof getPerformanceWorkspace>>;
