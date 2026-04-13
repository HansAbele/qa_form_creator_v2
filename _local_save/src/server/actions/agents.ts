"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getCampaignFilter } from "@/server/queries/campaign-filter";

export async function getAgents(campaignId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();
  const where = {
    ...campaignFilter,
    ...(campaignId ? { campaignId } : {}),
  };

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

  // QA users can only create agents in their assigned campaigns
  if (session.user.role !== "ADMIN") {
    if (!session.user.campaignIds.includes(data.campaignId)) {
      throw new Error("No autorizado para esta campaña");
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
  data: { name: string; agentCode?: string; teamId?: string | null; active: boolean },
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const agent = await prisma.agent.update({
    where: { id },
    data: {
      name: data.name,
      agentCode: data.agentCode || null,
      teamId: data.teamId ?? null,
      active: data.active,
    },
  });

  revalidatePath("/admin/agents");
  return agent;
}

export async function deleteAgent(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  await prisma.agent.update({
    where: { id },
    data: { active: false },
  });

  revalidatePath("/admin/agents");
}
