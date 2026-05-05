"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  assertCampaignAccessForUser,
  assertCampaignPermissionForUser,
  getCampaignFilter,
} from "@/server/queries/campaign-filter";

export async function getTeams(campaignId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const where = await getCampaignFilter(campaignId);

  return prisma.team.findMany({
    where,
    include: {
      campaign: { select: { id: true, name: true } },
      _count: { select: { agents: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getTeamById(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true } },
      agents: {
        where: { active: true },
        select: { id: true, name: true, agentCode: true },
        orderBy: { name: "asc" },
      },
      _count: { select: { agents: true } },
    },
  });
  if (!team) throw new Error("Equipo no encontrado");
  assertCampaignAccessForUser(session.user, team.campaignId);
  return team;
}

export async function createTeam(data: { name: string; campaignId: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageAgents");

  const team = await prisma.team.create({
    data: { name: data.name.trim(), campaignId: data.campaignId },
  });
  revalidatePath("/admin/campaigns");
  return team;
}

export async function updateTeam(id: string, data: { name: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.team.findUnique({
    where: { id },
    select: { campaignId: true },
  });
  if (!existing) throw new Error("Equipo no encontrado");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageAgents");

  const team = await prisma.team.update({ where: { id }, data: { name: data.name.trim() } });
  revalidatePath("/admin/campaigns");
  return team;
}

export async function deleteTeam(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.team.findUnique({
    where: { id },
    select: { campaignId: true },
  });
  if (!existing) throw new Error("Equipo no encontrado");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageAgents");

  await prisma.$transaction([
    prisma.agent.updateMany({
      where: { teamId: id, campaignId: existing.campaignId },
      data: { teamId: null },
    }),
    prisma.team.delete({ where: { id } }),
  ]);
  revalidatePath("/admin/campaigns");
}

export async function assignAgentsToTeam(teamId: string, agentIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { campaignId: true },
  });
  if (!team) throw new Error("Equipo no encontrado");
  await assertCampaignPermissionForUser(session.user, team.campaignId, "canManageAgents");

  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, campaignId: true },
  });

  if (agents.length !== agentIds.length || agents.some((agent) => agent.campaignId !== team.campaignId)) {
    throw new Error("Agentes invalidos para este equipo");
  }

  await prisma.agent.updateMany({
    where: { id: { in: agentIds }, campaignId: team.campaignId },
    data: { teamId },
  });
  revalidatePath("/admin/campaigns");
}

export async function removeAgentFromTeam(agentId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { campaignId: true },
  });
  if (!agent) throw new Error("Agente no encontrado");
  await assertCampaignPermissionForUser(session.user, agent.campaignId, "canManageAgents");

  await prisma.agent.update({ where: { id: agentId }, data: { teamId: null } });
  revalidatePath("/admin/campaigns");
}
