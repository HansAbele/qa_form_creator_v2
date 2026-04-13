"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getCampaignFilter } from "@/server/queries/campaign-filter";

// ─── Disposition Categories ─────────────────────────

export async function getDispositionCategories(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  return prisma.dispositionCategory.findMany({
    where: { campaignId },
    include: {
      _count: { select: { dispositions: true } },
    },
    orderBy: { order: "asc" },
  });
}

export async function createDispositionCategory(data: {
  name: string;
  campaignId: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  // Get next order value
  const maxOrder = await prisma.dispositionCategory.aggregate({
    where: { campaignId: data.campaignId },
    _max: { order: true },
  });

  const category = await prisma.dispositionCategory.create({
    data: {
      name: data.name.trim(),
      campaignId: data.campaignId,
      order: (maxOrder._max.order ?? -1) + 1,
    },
  });

  revalidatePath("/admin/dispositions");
  return category;
}

export async function updateDispositionCategory(
  id: string,
  data: { name: string },
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const category = await prisma.dispositionCategory.update({
    where: { id },
    data: { name: data.name.trim() },
  });

  revalidatePath("/admin/dispositions");
  return category;
}

export async function deleteDispositionCategory(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  // Unlink dispositions from category (don't delete them)
  await prisma.$transaction([
    prisma.disposition.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    }),
    prisma.dispositionCategory.delete({ where: { id } }),
  ]);

  revalidatePath("/admin/dispositions");
}

// ─── Dispositions ───────────────────────────────────

export async function getDispositions(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  return prisma.disposition.findMany({
    where: { campaignId },
    include: {
      category: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      _count: { select: { responses: true } },
    },
    orderBy: [{ category: { order: "asc" } }, { name: "asc" }],
  });
}

/**
 * Get active dispositions for a campaign — optimized for the combobox selector.
 * Returns grouped by category with usage count for "frecuentes" sorting.
 */
export async function getDispositionsForSelector(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const dispositions = await prisma.disposition.findMany({
    where: { campaignId, active: true },
    include: {
      category: { select: { id: true, name: true, order: true } },
      _count: { select: { responses: true } },
    },
    orderBy: { name: "asc" },
  });

  // Sort: most used first globally, then alphabetical within groups
  const sorted = [...dispositions].sort(
    (a, b) => b._count.responses - a._count.responses,
  );

  // Top 5 most used as "frecuentes"
  const frequent = sorted.slice(0, 5).filter((d) => d._count.responses > 0);

  // Group by category
  const grouped: Record<
    string,
    { categoryName: string; categoryOrder: number; items: typeof dispositions }
  > = {};
  const uncategorized: typeof dispositions = [];

  for (const d of dispositions) {
    if (d.category) {
      const key = d.category.id;
      if (!grouped[key]) {
        grouped[key] = {
          categoryName: d.category.name,
          categoryOrder: d.category.order,
          items: [],
        };
      }
      grouped[key].items.push(d);
    } else {
      uncategorized.push(d);
    }
  }

  // Sort groups by category order
  const categories = Object.values(grouped).sort(
    (a, b) => a.categoryOrder - b.categoryOrder,
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

  // Verify campaign access for QA users
  if (session.user.role !== "ADMIN") {
    if (!session.user.campaignIds.includes(data.campaignId)) {
      throw new Error("No autorizado para esta campaña");
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

  revalidatePath("/admin/dispositions");
  return disposition;
}

/**
 * Inline creation from the combobox — QA can create on the fly.
 * Includes fuzzy duplicate detection to prevent near-duplicates.
 */
export async function createDispositionInline(data: {
  name: string;
  campaignId: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const trimmed = data.name.trim();
  if (trimmed.length < 2) {
    throw new Error("El nombre debe tener al menos 2 caracteres");
  }

  // Check exact duplicate
  const existing = await prisma.disposition.findUnique({
    where: {
      name_campaignId: { name: trimmed, campaignId: data.campaignId },
    },
  });
  if (existing) {
    throw new Error(`Ya existe una disposición "${trimmed}" en esta campaña`);
  }

  // Check fuzzy duplicates (similar names)
  const allInCampaign = await prisma.disposition.findMany({
    where: { campaignId: data.campaignId, active: true },
    select: { id: true, name: true },
  });

  const similar = allInCampaign.find(
    (d) => levenshteinDistance(d.name.toLowerCase(), trimmed.toLowerCase()) <= 2,
  );

  if (similar) {
    throw new Error(
      `SIMILAR:${similar.id}:${similar.name}`,
    );
  }

  // Create without category (admin can organize later)
  const disposition = await prisma.disposition.create({
    data: {
      name: trimmed,
      campaignId: data.campaignId,
      createdById: session.user.id,
    },
  });

  revalidatePath("/admin/dispositions");
  return disposition;
}

export async function updateDisposition(
  id: string,
  data: {
    name: string;
    code?: string;
    categoryId?: string | null;
    active: boolean;
  },
) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const disposition = await prisma.disposition.update({
    where: { id },
    data: {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      categoryId: data.categoryId ?? null,
      active: data.active,
    },
  });

  revalidatePath("/admin/dispositions");
  return disposition;
}

export async function deleteDisposition(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  // Check if used in responses
  const usageCount = await prisma.response.count({
    where: { dispositionId: id },
  });

  if (usageCount > 0) {
    // Soft-delete: deactivate instead
    await prisma.disposition.update({
      where: { id },
      data: { active: false },
    });
  } else {
    await prisma.disposition.delete({ where: { id } });
  }

  revalidatePath("/admin/dispositions");
}

// ─── Bulk import ────────────────────────────────────

export async function bulkImportDispositions(data: {
  campaignId: string;
  categoryId?: string;
  names: string[];
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN")
    throw new Error("No autorizado");

  // Deduplicate and trim
  const uniqueNames = [
    ...new Set(data.names.map((n) => n.trim()).filter((n) => n.length > 0)),
  ];

  if (uniqueNames.length === 0) {
    throw new Error("No se proporcionaron nombres válidos");
  }

  // Get existing names in campaign to skip duplicates
  const existing = await prisma.disposition.findMany({
    where: { campaignId: data.campaignId },
    select: { name: true },
  });
  const existingSet = new Set(existing.map((d) => d.name.toLowerCase()));

  const toCreate = uniqueNames.filter(
    (name) => !existingSet.has(name.toLowerCase()),
  );

  if (toCreate.length === 0) {
    return { created: 0, skipped: uniqueNames.length };
  }

  await prisma.disposition.createMany({
    data: toCreate.map((name) => ({
      name,
      categoryId: data.categoryId || null,
      campaignId: data.campaignId,
      createdById: session.user.id,
    })),
    skipDuplicates: true,
  });

  revalidatePath("/admin/dispositions");

  return {
    created: toCreate.length,
    skipped: uniqueNames.length - toCreate.length,
  };
}

// ─── Fuzzy matching utility ─────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

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
