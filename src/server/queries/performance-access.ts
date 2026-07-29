import "server-only";

import type { Session } from "next-auth";
import { isAgentRole, isSupervisorRole } from "@/lib/campaign-permissions";
import { prisma } from "@/lib/prisma";

type SessionUser = Session["user"];

export class PerformanceAuthorizationError extends Error {
  constructor(message = "Performance record unavailable") {
    super(message);
    this.name = "PerformanceAuthorizationError";
  }
}

export async function getAgentProfileForUser(userId: string) {
  return prisma.agent.findFirst({
    where: { userId, active: true },
    select: {
      id: true,
      name: true,
      agentCode: true,
      campaignId: true,
      campaign: { select: { id: true, name: true, active: true } },
    },
  });
}

async function getCampaignPerformanceAccess(userId: string, campaignId: string) {
  return prisma.userCampaign.findUnique({
    where: { userId_campaignId: { userId, campaignId } },
    select: {
      roleInCampaign: true,
      canViewCoaching: true,
      canManageCoaching: true,
      canViewPips: true,
      canManagePips: true,
    },
  });
}

export async function canViewCoachingSession(user: SessionUser, coachingSessionId: string) {
  const coaching = await prisma.coachingSession.findUnique({
    where: { id: coachingSessionId },
    select: {
      id: true,
      campaignId: true,
      agentId: true,
      coachId: true,
      createdById: true,
      agent: { select: { userId: true, active: true } },
    },
  });
  if (!coaching) return false;
  if (user.role === "ADMIN") return true;
  if (isAgentRole(user.role)) {
    return coaching.agent.active && coaching.agent.userId === user.id;
  }

  const access = await getCampaignPerformanceAccess(user.id, coaching.campaignId);
  if (!access || (!access.canViewCoaching && !access.canManageCoaching)) return false;
  if (isSupervisorRole(user.role) || access.roleInCampaign === "CAMPAIGN_ADMIN") return true;
  return coaching.coachId === user.id || coaching.createdById === user.id;
}

export async function assertCanViewCoachingSession(user: SessionUser, coachingSessionId: string) {
  if (!(await canViewCoachingSession(user, coachingSessionId))) {
    throw new PerformanceAuthorizationError();
  }
}

export async function canViewPipPlan(user: SessionUser, pipPlanId: string) {
  const pip = await prisma.pipPlan.findUnique({
    where: { id: pipPlanId },
    select: {
      id: true,
      campaignId: true,
      agentId: true,
      ownerId: true,
      createdById: true,
      agent: { select: { userId: true, active: true } },
    },
  });
  if (!pip) return false;
  if (user.role === "ADMIN") return true;
  if (isAgentRole(user.role)) {
    return pip.agent.active && pip.agent.userId === user.id;
  }

  const access = await getCampaignPerformanceAccess(user.id, pip.campaignId);
  if (!access || (!access.canViewPips && !access.canManagePips)) return false;
  if (isSupervisorRole(user.role) || access.roleInCampaign === "CAMPAIGN_ADMIN") return true;
  return pip.ownerId === user.id || pip.createdById === user.id;
}

export async function assertCanViewPipPlan(user: SessionUser, pipPlanId: string) {
  if (!(await canViewPipPlan(user, pipPlanId))) {
    throw new PerformanceAuthorizationError();
  }
}

export async function canAgentAccessInteractionEvidence(userId: string, interactionId: string) {
  const evidence = await prisma.performanceEvidence.findFirst({
    where: {
      interactionId,
      OR: [
        {
          coachingSession: {
            agent: { userId, active: true },
          },
        },
        {
          pipPlan: {
            agent: { userId, active: true },
          },
        },
      ],
    },
    select: { id: true },
  });
  return Boolean(evidence);
}
