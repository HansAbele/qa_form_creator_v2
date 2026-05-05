"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
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
  revalidatePath("/admin/campaigns");
  return category;
}

export async function updateDispositionCategory(id: string, data: { name: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.dispositionCategory.findUnique({
    where: { id },
    select: { campaignId: true },
  });
  if (!existing) throw new Error("Categoria no encontrada");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  const category = await prisma.dispositionCategory.update({
    where: { id },
    data: { name: data.name.trim() },
  });
  revalidatePath("/admin/campaigns");
  return category;
}

export async function deleteDispositionCategory(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.dispositionCategory.findUnique({
    where: { id },
    select: { campaignId: true },
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
  revalidatePath("/admin/campaigns");
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
      createdById: session.user.id,
    },
  });
  revalidatePath("/admin/campaigns");
  return disposition;
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
  revalidatePath("/admin/campaigns");
  return disposition;
}

export async function updateDisposition(
  id: string,
  data: { name: string; code?: string; categoryId?: string | null; active: boolean },
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.disposition.findUnique({
    where: { id },
    select: { campaignId: true },
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
    },
  });
  revalidatePath("/admin/campaigns");
  return disposition;
}

export async function deleteDisposition(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const existing = await prisma.disposition.findUnique({
    where: { id },
    select: { campaignId: true },
  });
  if (!existing) throw new Error("Disposicion no encontrada");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  const usageCount = await prisma.response.count({ where: { dispositionId: id } });
  if (usageCount > 0) {
    await prisma.disposition.update({ where: { id }, data: { active: false } });
  } else {
    await prisma.disposition.delete({ where: { id } });
  }
  revalidatePath("/admin/campaigns");
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
  revalidatePath("/admin/campaigns");
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
