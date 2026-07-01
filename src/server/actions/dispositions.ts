"use server";

import { revalidatePath } from "next/cache";
import type { DispositionOutcomeValue } from "@/lib/disposition-outcome";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignAccessForUser,
  assertCampaignPermissionForUser,
} from "@/server/queries/campaign-filter";

// ─── Categories ─────────────────────────────────────

export async function getDispositionCategories(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  assertCampaignAccessForUser(session.user, campaignId);

  return prisma.dispositionCategory.findMany({
    where: { campaignId },
    include: { _count: { select: { dispositions: true } } },
    orderBy: { name: "asc" },
  });
}

export async function createDispositionCategory(data: {
  name: string;
  campaignId: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageDispositions");

  const category = await prisma.dispositionCategory.create({
    data: { name: data.name.trim(), campaignId: data.campaignId },
  });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: data.campaignId,
    module: "dispositions",
    action: "category_created",
    entityType: "disposition_category",
    entityId: category.id,
    afterValue: category,
    impact: "Categoria disponible para organizar disposiciones.",
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return category;
}

export async function updateDispositionCategory(id: string, data: { name: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.dispositionCategory.findUnique({
    where: { id },
    select: { id: true, name: true, campaignId: true },
  });
  if (!existing) throw new Error("Categoria no encontrada");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  const category = await prisma.dispositionCategory.update({
    where: { id },
    data: { name: data.name.trim() },
  });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: existing.campaignId,
    module: "dispositions",
    action: "category_updated",
    entityType: "disposition_category",
    entityId: id,
    beforeValue: existing,
    afterValue: category,
    impact: "Cambio operativo en categoria de disposiciones.",
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return category;
}

export async function deleteDispositionCategory(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.dispositionCategory.findUnique({
    where: { id },
    select: { id: true, name: true, campaignId: true },
  });
  if (!existing) throw new Error("Categoria no encontrada");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  await prisma.$transaction([
    prisma.disposition.updateMany({
      where: { categoryId: id, campaignId: existing.campaignId },
      data: { categoryId: null },
    }),
    prisma.dispositionCategory.delete({ where: { id } }),
  ]);
  await writeAuditLog({
    userId: session.user.id,
    campaignId: existing.campaignId,
    module: "dispositions",
    action: "category_deleted",
    entityType: "disposition_category",
    entityId: id,
    beforeValue: existing,
    impact: "Categoria eliminada y disposiciones desvinculadas.",
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
}

// ─── Dispositions ───────────────────────────────────

export async function getDispositions(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  assertCampaignAccessForUser(session.user, campaignId);

  return prisma.disposition.findMany({
    where: { campaignId },
    include: {
      category: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      _count: { select: { responses: true } },
    },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });
}

export async function getDispositionsForSelector(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  assertCampaignAccessForUser(session.user, campaignId);

  const dispositions = await prisma.disposition.findMany({
    where: { campaignId, active: true },
    include: {
      category: { select: { id: true, name: true } },
      _count: { select: { responses: true } },
    },
    orderBy: { name: "asc" },
  });

  const sorted = [...dispositions].sort((a, b) => b._count.responses - a._count.responses);
  const frequent = sorted.slice(0, 5).filter((d) => d._count.responses > 0);

  const grouped: Record<string, { categoryName: string; items: typeof dispositions }> = {};
  const uncategorized: typeof dispositions = [];

  for (const d of dispositions) {
    if (d.category) {
      if (!grouped[d.category.id]) {
        grouped[d.category.id] = { categoryName: d.category.name, items: [] };
      }
      grouped[d.category.id].items.push(d);
    } else {
      uncategorized.push(d);
    }
  }

  const categories = Object.values(grouped).sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName),
  );

  return { frequent, categories, uncategorized, all: dispositions };
}

export async function createDisposition(data: {
  name: string;
  code?: string;
  categoryId?: string;
  campaignId: string;
  outcomeType?: DispositionOutcomeValue | null;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageDispositions");

  if (data.categoryId) {
    const category = await prisma.dispositionCategory.findUnique({
      where: { id: data.categoryId },
      select: { campaignId: true },
    });
    if (!category || category.campaignId !== data.campaignId) {
      throw new Error("Categoria invalida para esta campana");
    }
  }

  const disposition = await prisma.disposition.create({
    data: {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      categoryId: data.categoryId || null,
      campaignId: data.campaignId,
      outcomeType: data.outcomeType ?? null,
      createdById: session.user.id,
    },
  });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: data.campaignId,
    module: "dispositions",
    action: "created",
    entityType: "disposition",
    entityId: disposition.id,
    afterValue: disposition,
    impact: "Disposicion disponible para evaluaciones.",
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return disposition;
}

const DEFAULT_TAXONOMIES: Record<
  "inbound" | "outbound",
  { name: string; code: string; outcomeType: DispositionOutcomeValue; isSystem?: boolean }[]
> = {
  inbound: [
    { name: "Resuelto", code: "RES", outcomeType: "RESOLVED" },
    { name: "Escalado a supervisor", code: "ESC", outcomeType: "ESCALATED" },
    { name: "Transferido", code: "TRF", outcomeType: "TRANSFERRED" },
    { name: "Seguimiento", code: "FUP", outcomeType: "FOLLOW_UP" },
    { name: "Rellamada agendada", code: "CBK", outcomeType: "CALLBACK" },
    { name: "Queja", code: "CMP", outcomeType: "OTHER" },
    { name: "Abandonada", code: "ABD", outcomeType: "SYSTEM", isSystem: true },
    { name: "Numero equivocado", code: "WRG", outcomeType: "SYSTEM", isSystem: true },
  ],
  outbound: [
    { name: "Venta", code: "SAL", outcomeType: "SALE" },
    { name: "Sin venta", code: "NSL", outcomeType: "NO_SALE" },
    { name: "No interesado", code: "NIN", outcomeType: "NO_SALE" },
    { name: "Rellamada agendada", code: "CBK", outcomeType: "CALLBACK" },
    { name: "Sin respuesta", code: "NOA", outcomeType: "NO_CONTACT" },
    { name: "Buzon de voz", code: "VML", outcomeType: "NO_CONTACT" },
    { name: "Ocupado", code: "BSY", outcomeType: "NO_CONTACT" },
    { name: "Numero invalido", code: "INV", outcomeType: "SYSTEM", isSystem: true },
    { name: "No contactar (DNC)", code: "DNC", outcomeType: "DNC", isSystem: true },
  ],
};

/** Seeds a starter inbound/outbound disposition taxonomy, skipping existing names. */
export async function seedDefaultDispositions(campaignId: string, kind: "inbound" | "outbound") {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  await assertCampaignPermissionForUser(session.user, campaignId, "canManageDispositions");

  const existing = await prisma.disposition.findMany({
    where: { campaignId },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((d) => d.name.toLowerCase()));
  const toCreate = DEFAULT_TAXONOMIES[kind].filter(
    (d) => !existingNames.has(d.name.toLowerCase()),
  );

  if (toCreate.length === 0) return { created: 0 };

  await prisma.disposition.createMany({
    data: toCreate.map((d) => ({
      name: d.name,
      code: d.code,
      campaignId,
      outcomeType: d.outcomeType,
      isSystem: Boolean(d.isSystem),
      createdById: session.user.id,
    })),
  });

  await writeAuditLog({
    userId: session.user.id,
    campaignId,
    module: "dispositions",
    action: "seeded",
    entityType: "disposition",
    afterValue: { kind, created: toCreate.length },
    impact: `Sembradas ${toCreate.length} disposiciones (${kind}).`,
  });
  revalidatePath("/operations/dispositions");
  revalidatePath("/admin/campaigns");
  return { created: toCreate.length };
}

export async function createDispositionInline(data: {
  name: string;
  campaignId: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageDispositions");

  const trimmed = data.name.trim();
  if (trimmed.length < 2) throw new Error("El nombre debe tener al menos 2 caracteres");

  const existing = await prisma.disposition.findUnique({
    where: { name_campaignId: { name: trimmed, campaignId: data.campaignId } },
  });
  if (existing) throw new Error(`Ya existe "${trimmed}" en esta campaña`);

  // Fuzzy duplicate check
  const allInCampaign = await prisma.disposition.findMany({
    where: { campaignId: data.campaignId, active: true },
    select: { id: true, name: true },
  });

  const similar = allInCampaign.find(
    (d) => levenshteinDistance(d.name.toLowerCase(), trimmed.toLowerCase()) <= 2,
  );
  if (similar) throw new Error(`SIMILAR:${similar.id}:${similar.name}`);

  const disposition = await prisma.disposition.create({
    data: { name: trimmed, campaignId: data.campaignId, createdById: session.user.id },
  });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: data.campaignId,
    module: "dispositions",
    action: "created_inline",
    entityType: "disposition",
    entityId: disposition.id,
    afterValue: disposition,
    impact: "Disposicion creada desde flujo de evaluacion.",
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return disposition;
}

export async function updateDisposition(
  id: string,
  data: {
    name: string;
    code?: string;
    categoryId?: string | null;
    active: boolean;
    outcomeType?: DispositionOutcomeValue | null;
  },
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.disposition.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      categoryId: true,
      campaignId: true,
      active: true,
    },
  });
  if (!existing) throw new Error("Disposicion no encontrada");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  if (data.categoryId) {
    const category = await prisma.dispositionCategory.findUnique({
      where: { id: data.categoryId },
      select: { campaignId: true },
    });
    if (!category || category.campaignId !== existing.campaignId) {
      throw new Error("Categoria invalida para esta disposicion");
    }
  }

  const disposition = await prisma.disposition.update({
    where: { id },
    data: {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      categoryId: data.categoryId ?? null,
      active: data.active,
      ...(data.outcomeType !== undefined ? { outcomeType: data.outcomeType } : {}),
    },
  });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: existing.campaignId,
    module: "dispositions",
    action: "updated",
    entityType: "disposition",
    entityId: id,
    beforeValue: existing,
    afterValue: disposition,
    impact: "Cambio operativo en disposicion.",
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return disposition;
}

export async function deleteDisposition(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.disposition.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, categoryId: true, campaignId: true, active: true },
  });
  if (!existing) throw new Error("Disposicion no encontrada");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  const usageCount = await prisma.response.count({ where: { dispositionId: id } });
  if (usageCount > 0) {
    const updated = await prisma.disposition.update({ where: { id }, data: { active: false } });
    await writeAuditLog({
      userId: session.user.id,
      campaignId: existing.campaignId,
      module: "dispositions",
      action: "deactivated",
      entityType: "disposition",
      entityId: id,
      beforeValue: existing,
      afterValue: updated,
      impact: "Disposicion con historial desactivada para futuras evaluaciones.",
    });
  } else {
    await prisma.disposition.delete({ where: { id } });
    await writeAuditLog({
      userId: session.user.id,
      campaignId: existing.campaignId,
      module: "dispositions",
      action: "deleted",
      entityType: "disposition",
      entityId: id,
      beforeValue: existing,
      impact: "Disposicion eliminada sin historial de evaluaciones.",
    });
  }
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
}

export async function bulkImportDispositions(data: {
  campaignId: string;
  categoryId?: string;
  names: string[];
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageDispositions");

  if (data.categoryId) {
    const category = await prisma.dispositionCategory.findUnique({
      where: { id: data.categoryId },
      select: { campaignId: true },
    });
    if (!category || category.campaignId !== data.campaignId) {
      throw new Error("Categoria invalida para esta campana");
    }
  }

  const uniqueNames = [...new Set(data.names.map((n) => n.trim()).filter((n) => n.length > 0))];
  if (uniqueNames.length === 0) throw new Error("No se proporcionaron nombres válidos");

  const existing = await prisma.disposition.findMany({
    where: { campaignId: data.campaignId },
    select: { name: true },
  });
  const existingSet = new Set(existing.map((d) => d.name.toLowerCase()));
  const toCreate = uniqueNames.filter((n) => !existingSet.has(n.toLowerCase()));

  if (toCreate.length === 0) return { created: 0, skipped: uniqueNames.length };

  await prisma.disposition.createMany({
    data: toCreate.map((name) => ({
      name,
      categoryId: data.categoryId || null,
      campaignId: data.campaignId,
      createdById: session.user.id,
    })),
    skipDuplicates: true,
  });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: data.campaignId,
    module: "dispositions",
    action: "bulk_imported",
    entityType: "disposition",
    afterValue: { created: toCreate.length, skipped: uniqueNames.length - toCreate.length },
    impact: "Carga masiva de disposiciones para la campana.",
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return { created: toCreate.length, skipped: uniqueNames.length - toCreate.length };
}

// ─── Fuzzy matching ─────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
