"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getCampaignFilter } from "@/server/queries/campaign-filter";

// ─── Read ────────────────────────────────────────────

export async function getTeams(campaignId?: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();

  const where = {
    ...campaignFilter,
    ...(campaignId ? { campaignId } : {}),
  };

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
  return team;
}

// ─── Write (QA + ADMIN) ─────────────────────────────

export async function createTeam(data: {
  name: string;
  campaignId: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  // Verify campaign access for QA users
  if (session.user.role !== "ADMIN") {
    if (!session.user.campaignIds.includes(data.campaignId)) {
      throw new Error("No autorizado para esta campaña");
    }
  }

  const team = await prisma.team.create({
    data: {
      name: data.name.trim(),
      campaignId: data.campaignId,
    },
  });

  revalidatePath("/admin/teams");
  revalidatePath("/admin/agents");
  return team;
}

export async function updateTeam(
  id: string,
  data: { name: string; active: boolean },
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const team = await prisma.team.update({
    where: { id },
    data: {
      name: data.name.trim(),
      active: data.active,
    },
  });

  revalidatePath("/admin/teams");
  revalidatePath("/admin/agents");
  return team;
}

export async function deleteTeam(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  // Unlink agents from this team instead of failing
  await prisma.$transaction([
    prisma.agent.updateMany({
      where: { teamId: id },
      data: { teamId: null },
    }),
    prisma.team.delete({ where: { id } }),
  ]);

  revalidatePath("/admin/teams");
  revalidatePath("/admin/agents");
}

// ─── Assign agents to team ──────────────────────────

export async function assignAgentsToTeam(
  teamId: string,
  agentIds: string[],
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  await prisma.agent.updateMany({
    where: { id: { in: agentIds } },
    data: { teamId },
  });

  revalidatePath("/admin/teams");
  revalidatePath("/admin/agents");
}

export async function removeAgentFromTeam(agentId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  await prisma.agent.update({
    where: { id: agentId },
    data: { teamId: null },
  });

  revalidatePath("/admin/teams");
  revalidatePath("/admin/agents");
}
