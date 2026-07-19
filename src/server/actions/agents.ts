"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
} from "@/server/queries/campaign-filter";

async function attachSafeAgentRelations<
  T extends {
    id: string;
    campaignId: string;
    team: { id: string; name: string; campaignId: string } | null;
  },
>(agents: T[]) {
  const campaignIds = [...new Set(agents.map((agent) => agent.campaignId))];
  const counts =
    agents.length > 0
      ? await prisma.response.groupBy({
          by: ["agentId"],
          where: {
            agentId: { in: agents.map((agent) => agent.id) },
            OR: campaignIds.map((visibleCampaignId) => ({
              AND: [
                { form: { campaignId: visibleCampaignId } },
                { agent: { campaignId: visibleCampaignId } },
                {
                  OR: [{ dispositionId: null }, { disposition: { campaignId: visibleCampaignId } }],
                },
              ],
            })),
          },
          _count: { _all: true },
        })
      : [];
  const responseCounts = new Map(
    counts.map((count) => [count.agentId, count._count._all] as const),
  );

  return agents.map(({ team, ...agent }) => ({
    ...agent,
    team: team?.campaignId === agent.campaignId ? { id: team.id, name: team.name } : null,
    _count: { responses: responseCounts.get(agent.id) ?? 0 },
  }));
}

export async function getAgents(campaignId?: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");

  const where = campaignId ? { campaignId } : {};

  const agents = await prisma.agent.findMany({
    where,
    include: {
      campaign: { select: { id: true, name: true } },
      team: { select: { id: true, name: true, campaignId: true } },
    },
    orderBy: { name: "asc" },
  });

  return attachSafeAgentRelations(agents);
}

export async function getAgentsForEvaluation(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  try {
    await assertCampaignPermissionForUser(session.user, campaignId, "canEvaluate");
  } catch {
    await assertCampaignPermissionForUser(session.user, campaignId, "canEditEvaluations");
  }

  return prisma.agent.findMany({
    where: { campaignId, active: true, campaign: { active: true } },
    select: { id: true, name: true, agentCode: true },
    orderBy: { name: "asc" },
  });
}

export async function getAgentsForManagement(campaignId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const where = await getCampaignFilterForPermission("canManageAgents", campaignId);

  const agents = await prisma.agent.findMany({
    where,
    include: {
      campaign: { select: { id: true, name: true } },
      team: { select: { id: true, name: true, campaignId: true } },
    },
    orderBy: { name: "asc" },
  });

  return attachSafeAgentRelations(agents);
}

export async function createAgent(data: {
  name: string;
  agentCode?: string;
  campaignId: string;
  teamId?: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageAgents");

  if (data.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: data.teamId },
      select: { campaignId: true },
    });
    if (!team || team.campaignId !== data.campaignId) {
      throw new Error("Invalid team for this campaign");
    }
  }

  const agent = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        name: data.name.trim(),
        agentCode: data.agentCode?.trim() || null,
        campaignId: data.campaignId,
        teamId: data.teamId || null,
      },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: data.campaignId,
        module: "agents",
        action: "created",
        entityType: "agent",
        entityId: agent.id,
        afterValue: agent,
        impact: "Agent available for campaign evaluations and reports.",
      },
      tx,
    );
    return agent;
  });

  revalidatePath("/admin/agents");
  revalidatePath("/operations/agents");
  return agent;
}

export async function updateAgent(
  id: string,
  data: { name: string; agentCode?: string; teamId?: string; active: boolean },
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const existing = await prisma.agent.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      agentCode: true,
      campaignId: true,
      teamId: true,
      active: true,
    },
  });
  if (!existing) throw new Error("Agent not found");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageAgents");

  if (data.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: data.teamId },
      select: { campaignId: true },
    });
    if (!team || team.campaignId !== existing.campaignId) {
      throw new Error("Invalid team for this agent");
    }
  }

  const agent = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.update({
      where: { id },
      data: {
        name: data.name.trim(),
        agentCode: data.agentCode?.trim() || null,
        teamId: data.teamId || null,
        active: data.active,
      },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: existing.campaignId,
        module: "agents",
        action: "updated",
        entityType: "agent",
        entityId: id,
        beforeValue: existing,
        afterValue: agent,
        impact: "Operational change to agent data.",
      },
      tx,
    );
    return agent;
  });

  revalidatePath("/admin/agents");
  revalidatePath("/operations/agents");
  return agent;
}

export async function deleteAgent(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, name: true, agentCode: true, campaignId: true, active: true },
  });
  if (!agent) throw new Error("Agent not found");
  await assertCampaignPermissionForUser(session.user, agent.campaignId, "canManageAgents");

  await prisma.$transaction(async (tx) => {
    const updated = await tx.agent.update({
      where: { id },
      data: { active: false },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: agent.campaignId,
        module: "agents",
        action: "deactivated",
        entityType: "agent",
        entityId: id,
        beforeValue: agent,
        afterValue: updated,
        impact: "Agent deactivated for future evaluations.",
      },
      tx,
    );
  });

  revalidatePath("/admin/agents");
  revalidatePath("/operations/agents");
}
