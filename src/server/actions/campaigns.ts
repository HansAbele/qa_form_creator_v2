"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  type CampaignPermissionKey,
  isSupervisorBlockedPermission,
  isSupervisorRole,
} from "@/lib/campaign-permissions";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

export async function getCampaigns() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  return prisma.campaign.findMany({
    include: {
      _count: { select: { users: true, forms: true, agents: true } },
    },
    orderBy: { name: "asc" },
  });
}

async function getCampaignsForPermissions(
  permissions: readonly [CampaignPermissionKey, ...CampaignPermissionKey[]],
  options: { activeOnly?: boolean } = {},
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  if (
    isSupervisorRole(session.user.role) &&
    permissions.some((permission) => isSupervisorBlockedPermission(permission))
  ) {
    return [];
  }

  const userCampaignWhere = {
    userId: session.user.id,
    ...Object.fromEntries(permissions.map((permission) => [permission, true])),
  } as Prisma.UserCampaignWhereInput;

  const where: Prisma.CampaignWhereInput =
    session.user.role === "ADMIN"
      ? options.activeOnly
        ? { active: true }
        : {}
      : {
          ...(options.activeOnly ? { active: true } : {}),
          users: { some: userCampaignWhere },
        };

  return prisma.campaign.findMany({
    where,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getDashboardCampaigns() {
  return getCampaignsForPermissions(["canViewDashboard"], { activeOnly: true });
}

// Evaluation history must keep inactive campaigns visible so prior months do
// not disappear when a campaign is closed.
export async function getOwnEvaluationHistoryCampaigns() {
  return getCampaignsForPermissions(["canViewDashboard"]);
}

export async function getEvaluationHistoryCampaigns() {
  return getCampaignsForPermissions(["canViewEvaluations"]);
}

export async function getKpiCampaigns() {
  return getCampaignsForPermissions(["canViewKPIs"]);
}

export async function getFormCreationCampaigns() {
  return getCampaignsForPermissions(["canCreateForms"]);
}

export async function getFormEditingCampaigns() {
  return getCampaignsForPermissions(["canEditForms"]);
}

export async function getReportCampaigns() {
  return getCampaignsForPermissions(["canViewReports"]);
}

export async function getExportCampaigns() {
  return getCampaignsForPermissions(["canExport", "canViewReports"]);
}

export async function getAgentManagementCampaigns() {
  return getCampaignsForPermissions(["canManageAgents"]);
}

export async function getDispositionManagementCampaigns() {
  return getCampaignsForPermissions(["canManageDispositions"]);
}

export async function getAuditCampaigns() {
  return getCampaignsForPermissions(["canViewAudit"]);
}

export async function createCampaign(data: { name: string; description?: string }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  const campaign = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: { name: data.name.trim(), description: data.description?.trim() },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: campaign.id,
        module: "campaigns",
        action: "created",
        entityType: "campaign",
        entityId: campaign.id,
        afterValue: campaign,
        impact: "Campana creada para asignaciones, formularios y evaluaciones.",
      },
      tx,
    );
    return campaign;
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

  const campaign = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.update({
      where: { id },
      data: { name: data.name.trim(), description: data.description?.trim(), active: data.active },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: id,
        module: "campaigns",
        action: "updated",
        entityType: "campaign",
        entityId: id,
        beforeValue: existing,
        afterValue: campaign,
        impact: "Campana actualizada; afecta scope operativo y reportes.",
      },
      tx,
    );
    return campaign;
  });

  revalidatePath("/admin/campaigns");
  return campaign;
}

export async function deactivateCampaign(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  const before = await prisma.campaign.findUnique({ where: { id } });
  if (!before) throw new Error("Campana no encontrada");
  if (!before.active) throw new Error("La campaña ya está inactiva");

  const campaign = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.update({
      where: { id },
      data: { active: false },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: id,
        module: "campaigns",
        action: "deactivated",
        entityType: "campaign",
        entityId: id,
        beforeValue: before,
        afterValue: campaign,
        impact: "Campana desactivada; su historial y relaciones se conservan.",
      },
      tx,
    );
    return campaign;
  });
  revalidatePath("/admin/campaigns");
  return campaign;
}
