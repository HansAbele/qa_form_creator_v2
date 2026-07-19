"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
} from "@/server/queries/campaign-filter";

function attachSafeTeamCounts<
  T extends { campaignId: string; agents: Array<{ campaignId: string }> },
>(teams: T[]) {
  return teams.map(({ agents, ...team }) => ({
    ...team,
    _count: {
      agents: agents.filter((agent) => agent.campaignId === team.campaignId).length,
    },
  }));
}

export async function getTeams(campaignId?: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");

  const where = campaignId ? { campaignId } : {};

  const teams = await prisma.team.findMany({
    where,
    include: {
      campaign: { select: { id: true, name: true } },
      agents: { select: { campaignId: true } },
    },
    orderBy: { name: "asc" },
  });

  return attachSafeTeamCounts(teams);
}

export async function getTeamsForManagement(campaignId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const where = await getCampaignFilterForPermission("canManageAgents", campaignId);

  const teams = await prisma.team.findMany({
    where,
    include: {
      campaign: { select: { id: true, name: true } },
      agents: { select: { campaignId: true } },
    },
    orderBy: { name: "asc" },
  });

  return attachSafeTeamCounts(teams);
}

export async function createTeam(data: { name: string; campaignId: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageAgents");

  const team = await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: { name: data.name.trim(), campaignId: data.campaignId },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: data.campaignId,
        module: "teams",
        action: "created",
        entityType: "team",
        entityId: team.id,
        afterValue: team,
        impact: "Team available for agent assignment.",
      },
      tx,
    );
    return team;
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/teams");
  revalidatePath("/operations/agents");
  return team;
}

export async function updateTeam(id: string, data: { name: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const existing = await prisma.team.findUnique({
    where: { id },
    select: { id: true, name: true, campaignId: true },
  });
  if (!existing) throw new Error("Team not found");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageAgents");

  const team = await prisma.$transaction(async (tx) => {
    const team = await tx.team.update({ where: { id }, data: { name: data.name.trim() } });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: existing.campaignId,
        module: "teams",
        action: "updated",
        entityType: "team",
        entityId: id,
        beforeValue: existing,
        afterValue: team,
        impact: "Operational change to the team name.",
      },
      tx,
    );
    return team;
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/teams");
  revalidatePath("/operations/agents");
  return team;
}

export async function deleteTeam(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const existing = await prisma.team.findUnique({
    where: { id },
    select: { id: true, name: true, campaignId: true },
  });
  if (!existing) throw new Error("Team not found");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageAgents");

  await prisma.$transaction(async (tx) => {
    await tx.agent.updateMany({
      where: { teamId: id, campaignId: existing.campaignId },
      data: { teamId: null },
    });
    await tx.team.delete({ where: { id } });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: existing.campaignId,
        module: "teams",
        action: "deleted",
        entityType: "team",
        entityId: id,
        beforeValue: existing,
        impact: "Team deleted and its agents unassigned.",
      },
      tx,
    );
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/teams");
  revalidatePath("/operations/agents");
}

export async function assignAgentsToTeam(teamId: string, agentIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { campaignId: true },
  });
  if (!team) throw new Error("Team not found");
  await assertCampaignPermissionForUser(session.user, team.campaignId, "canManageAgents");

  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, campaignId: true },
  });

  if (
    agents.length !== agentIds.length ||
    agents.some((agent) => agent.campaignId !== team.campaignId)
  ) {
    throw new Error("Invalid agents for this team");
  }

  await prisma.$transaction(async (tx) => {
    await tx.agent.updateMany({
      where: { id: { in: agentIds }, campaignId: team.campaignId },
      data: { teamId },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: team.campaignId,
        module: "teams",
        action: "agents_assigned",
        entityType: "team",
        entityId: teamId,
        afterValue: { agentIds },
        impact: "Agents reassigned to the team.",
      },
      tx,
    );
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/teams");
  revalidatePath("/operations/agents");
}

export async function removeAgentFromTeam(agentId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { campaignId: true },
  });
  if (!agent) throw new Error("Agent not found");
  await assertCampaignPermissionForUser(session.user, agent.campaignId, "canManageAgents");

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data: { teamId: null } });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: agent.campaignId,
        module: "teams",
        action: "agent_removed",
        entityType: "agent",
        entityId: agentId,
        afterValue: { teamId: null },
        impact: "Agent removed from the team.",
      },
      tx,
    );
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/teams");
  revalidatePath("/operations/agents");
}
