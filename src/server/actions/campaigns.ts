"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/server/audit-log";
import { assertCampaignAccessForUser } from "@/server/queries/campaign-filter";
import {
  isSupervisorBlockedPermission,
  isSupervisorRole,
  type CampaignPermissionKey,
} from "@/lib/campaign-permissions";
import type { Prisma } from "@prisma/client";

export async function getCampaigns() {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const where =
    session.user.role === "ADMIN" ? {} : { users: { some: { userId: session.user.id } } };

  return prisma.campaign.findMany({
    where,
    include: {
      _count: { select: { users: true, forms: true, agents: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getCampaignsForPermission(permission: CampaignPermissionKey) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  if (isSupervisorRole(session.user.role) && isSupervisorBlockedPermission(permission)) {
    return [];
  }

  const userCampaignWhere: Prisma.UserCampaignWhereInput = {
    userId: session.user.id,
    [permission]: true,
  };

  const where: Prisma.CampaignWhereInput =
    session.user.role === "ADMIN" ? {} : { users: { some: userCampaignWhere } };

  return prisma.campaign.findMany({
    where,
    include: {
      _count: { select: { users: true, forms: true, agents: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getCampaignById(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      users: { include: { user: { select: { id: true, name: true, email: true } } } },
      forms: { select: { id: true, title: true } },
      agents: { select: { id: true, name: true, agentCode: true, active: true } },
    },
  });

  if (!campaign) throw new Error("Campaña no encontrada");
  assertCampaignAccessForUser(session.user, campaign.id);
  return campaign;
}

export async function createCampaign(data: { name: string; description?: string }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  const campaign = await prisma.campaign.create({
    data: { name: data.name.trim(), description: data.description?.trim() },
  });

  await writeAuditLog({
    userId: session.user.id,
    campaignId: campaign.id,
    module: "campaigns",
    action: "created",
    entityType: "campaign",
    entityId: campaign.id,
    afterValue: campaign,
    impact: "Campana creada para asignaciones, formularios y evaluaciones.",
  });

  revalidatePath("/admin/campaigns");
  return campaign;
}

export async function updateCampaign(
  id: string,
  data: { name: string; description?: string; active: boolean },
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) throw new Error("Campana no encontrada");

  const campaign = await prisma.campaign.update({
    where: { id },
    data: { name: data.name.trim(), description: data.description?.trim(), active: data.active },
  });

  await writeAuditLog({
    userId: session.user.id,
    campaignId: id,
    module: "campaigns",
    action: "updated",
    entityType: "campaign",
    entityId: id,
    beforeValue: existing,
    afterValue: campaign,
    impact: "Campana actualizada; afecta scope operativo y reportes.",
  });

  revalidatePath("/admin/campaigns");
  return campaign;
}

export async function deleteCampaign(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  const formCount = await prisma.form.count({ where: { campaignId: id } });
  if (formCount > 0) {
    throw new Error("No se puede eliminar una campaña que tiene formularios asociados");
  }

  const campaign = await prisma.campaign.delete({ where: { id } });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: id,
    module: "campaigns",
    action: "deleted",
    entityType: "campaign",
    entityId: id,
    beforeValue: campaign,
    impact: "Campana eliminada sin formularios asociados.",
  });
  revalidatePath("/admin/campaigns");
}
