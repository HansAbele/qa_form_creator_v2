"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  assertCampaignAccessForUser,
  assertCampaignPermissionForUser,
  getCampaignFilter,
} from "@/server/queries/campaign-filter";

export async function getAgents(campaignId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const where = await getCampaignFilter(campaignId);

  return prisma.agent.findMany({
    where,
    include: {
      campaign: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      _count: { select: { responses: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getAgentById(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  });

  if (!agent) throw new Error("Agente no encontrado");
  assertCampaignAccessForUser(session.user, agent.campaignId);
  return agent;
}

export async function createAgent(data: {
  name: string;
  agentCode?: string;
  campaignId: string;
  teamId?: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageAgents");

  if (data.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: data.teamId },
      select: { campaignId: true },
    });
    if (!team || team.campaignId !== data.campaignId) {
      throw new Error("Equipo invalido para esta campana");
    }
  }

  const agent = await prisma.agent.create({
    data: {
      name: data.name,
      agentCode: data.agentCode || null,
      campaignId: data.campaignId,
      teamId: data.teamId || null,
    },
  });

  revalidatePath("/admin/agents");
  return agent;
}

export async function updateAgent(
  id: string,
  data: { name: string; agentCode?: string; teamId?: string; active: boolean },
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.agent.findUnique({
    where: { id },
    select: { campaignId: true },
  });
  if (!existing) throw new Error("Agente no encontrado");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageAgents");

  if (data.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: data.teamId },
      select: { campaignId: true },
    });
    if (!team || team.campaignId !== existing.campaignId) {
      throw new Error("Equipo invalido para este agente");
    }
  }

  const agent = await prisma.agent.update({
    where: { id },
    data: {
      name: data.name,
      agentCode: data.agentCode || null,
      teamId: data.teamId || null,
      active: data.active,
    },
  });

  revalidatePath("/admin/agents");
  return agent;
}

export async function deleteAgent(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { campaignId: true },
  });
  if (!agent) throw new Error("Agente no encontrado");
  await assertCampaignPermissionForUser(session.user, agent.campaignId, "canManageAgents");

  await prisma.agent.update({
    where: { id },
    data: { active: false },
  });

  revalidatePath("/admin/agents");
}
