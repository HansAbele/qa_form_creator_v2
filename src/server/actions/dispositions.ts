"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { DispositionOutcomeValue } from "@/lib/disposition-outcome";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import {
  assertCampaignPermissionForUser,
  getCampaignFilterForPermission,
} from "@/server/queries/campaign-filter";

// ─── Categories ─────────────────────────────────────

export async function getDispositionCategories(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertCampaignPermissionForUser(session.user, campaignId, "canManageDispositions");

  return prisma.dispositionCategory.findMany({
    where: { campaignId },
    include: {
      _count: {
        select: { dispositions: { where: { campaignId } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function createDispositionCategory(data: { name: string; campaignId: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageDispositions");

  const category = await prisma.$transaction(async (tx) => {
    const category = await tx.dispositionCategory.create({
      data: { name: data.name.trim(), campaignId: data.campaignId },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: data.campaignId,
        module: "dispositions",
        action: "category_created",
        entityType: "disposition_category",
        entityId: category.id,
        afterValue: category,
        impact: "Category made available to organize dispositions.",
      },
      tx,
    );
    return category;
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return category;
}

export async function updateDispositionCategory(id: string, data: { name: string }) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const existing = await prisma.dispositionCategory.findUnique({
    where: { id },
    select: { id: true, name: true, campaignId: true },
  });
  if (!existing) throw new Error("Category not found");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  const category = await prisma.$transaction(async (tx) => {
    const category = await tx.dispositionCategory.update({
      where: { id },
      data: { name: data.name.trim() },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: existing.campaignId,
        module: "dispositions",
        action: "category_updated",
        entityType: "disposition_category",
        entityId: id,
        beforeValue: existing,
        afterValue: category,
        impact: "Operational disposition category updated.",
      },
      tx,
    );
    return category;
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return category;
}

export async function deleteDispositionCategory(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const existing = await prisma.dispositionCategory.findUnique({
    where: { id },
    select: { id: true, name: true, campaignId: true },
  });
  if (!existing) throw new Error("Category not found");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  await prisma.$transaction(async (tx) => {
    await tx.disposition.updateMany({
      where: { categoryId: id, campaignId: existing.campaignId },
      data: { categoryId: null },
    });
    await tx.dispositionCategory.delete({ where: { id } });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: existing.campaignId,
        module: "dispositions",
        action: "category_deleted",
        entityType: "disposition_category",
        entityId: id,
        beforeValue: existing,
        impact: "Category deleted and dispositions unassigned.",
      },
      tx,
    );
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
}

// ─── Dispositions ───────────────────────────────────

export async function getDispositions(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertCampaignPermissionForUser(session.user, campaignId, "canManageDispositions");

  const dispositions = await prisma.disposition.findMany({
    where: { campaignId },
    include: {
      category: { select: { id: true, name: true, campaignId: true } },
      createdBy: { select: { name: true } },
      _count: {
        select: {
          responses: {
            where: {
              form: { campaignId },
              agent: { campaignId },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return dispositions
    .map(({ category, ...disposition }) => ({
      ...disposition,
      category:
        category?.campaignId === campaignId ? { id: category.id, name: category.name } : null,
    }))
    .sort(
      (a, b) =>
        (a.category?.name ?? "").localeCompare(b.category?.name ?? "") ||
        a.name.localeCompare(b.name),
    );
}

export async function getDispositionsForSelector(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  try {
    await assertCampaignPermissionForUser(session.user, campaignId, "canEvaluate");
  } catch {
    await assertCampaignPermissionForUser(session.user, campaignId, "canEditEvaluations");
  }

  const dispositions = await prisma.disposition.findMany({
    where: { campaignId, active: true, campaign: { active: true } },
    select: {
      id: true,
      name: true,
      code: true,
      category: { select: { id: true, name: true, campaignId: true } },
    },
    orderBy: { name: "asc" },
  });

  const safeDispositions = dispositions.map(({ category, ...disposition }) => ({
    ...disposition,
    category: category?.campaignId === campaignId ? { id: category.id, name: category.name } : null,
  }));

  const grouped: Record<string, { categoryName: string; items: typeof safeDispositions }> = {};
  const uncategorized: typeof safeDispositions = [];

  for (const d of safeDispositions) {
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

  return { categories, uncategorized, all: safeDispositions };
}

export async function getDispositionsForReports() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const campaignFilter = await getCampaignFilterForPermission("canViewReports");

  const dispositions = await prisma.disposition.findMany({
    where: campaignFilter,
    select: {
      id: true,
      name: true,
      campaignId: true,
      campaign: { select: { name: true } },
      category: { select: { campaignId: true } },
    },
    orderBy: [{ campaign: { name: "asc" } }, { name: "asc" }],
  });

  return dispositions
    .filter(
      (disposition) =>
        !disposition.category || disposition.category.campaignId === disposition.campaignId,
    )
    .map(({ category: _category, ...disposition }) => disposition);
}

export async function createDisposition(data: {
  name: string;
  code?: string;
  categoryId?: string;
  campaignId: string;
  outcomeType?: DispositionOutcomeValue | null;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageDispositions");

  if (data.categoryId) {
    const category = await prisma.dispositionCategory.findUnique({
      where: { id: data.categoryId },
      select: { campaignId: true },
    });
    if (!category || category.campaignId !== data.campaignId) {
      throw new Error("Invalid category for this campaign");
    }
  }

  const disposition = await prisma.$transaction(async (tx) => {
    const disposition = await tx.disposition.create({
      data: {
        name: data.name.trim(),
        code: data.code?.trim() || null,
        categoryId: data.categoryId || null,
        campaignId: data.campaignId,
        outcomeType: data.outcomeType ?? null,
        createdById: session.user.id,
      },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: data.campaignId,
        module: "dispositions",
        action: "created",
        entityType: "disposition",
        entityId: disposition.id,
        afterValue: disposition,
        impact: "Disposition made available for evaluations.",
      },
      tx,
    );
    return disposition;
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
    { name: "No sale", code: "NSL", outcomeType: "NO_SALE" },
    { name: "No interesado", code: "NIN", outcomeType: "NO_SALE" },
    { name: "Rellamada agendada", code: "CBK", outcomeType: "CALLBACK" },
    { name: "No answer", code: "NOA", outcomeType: "NO_CONTACT" },
    { name: "Buzon de voz", code: "VML", outcomeType: "NO_CONTACT" },
    { name: "Ocupado", code: "BSY", outcomeType: "NO_CONTACT" },
    { name: "Invalid number", code: "INV", outcomeType: "SYSTEM", isSystem: true },
    { name: "No contactar (DNC)", code: "DNC", outcomeType: "DNC", isSystem: true },
  ],
};

/** Seeds a starter inbound/outbound disposition taxonomy, skipping existing names. */
export async function seedDefaultDispositions(campaignId: string, kind: "inbound" | "outbound") {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertCampaignPermissionForUser(session.user, campaignId, "canManageDispositions");

  const existing = await prisma.disposition.findMany({
    where: { campaignId },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((d) => d.name.toLowerCase()));
  const toCreate = DEFAULT_TAXONOMIES[kind].filter((d) => !existingNames.has(d.name.toLowerCase()));

  if (toCreate.length === 0) return { created: 0 };

  await prisma.$transaction(async (tx) => {
    await tx.disposition.createMany({
      data: toCreate.map((d) => ({
        name: d.name,
        code: d.code,
        campaignId,
        outcomeType: d.outcomeType,
        isSystem: Boolean(d.isSystem),
        createdById: session.user.id,
      })),
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId,
        module: "dispositions",
        action: "seeded",
        entityType: "disposition",
        afterValue: { kind, created: toCreate.length },
        impact: `Seeded ${toCreate.length} dispositions (${kind}).`,
      },
      tx,
    );
  });
  revalidatePath("/operations/dispositions");
  revalidatePath("/admin/campaigns");
  return { created: toCreate.length };
}

export async function createDispositionInline(data: {
  name: string;
  campaignId: string;
  allowSimilar?: boolean;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageDispositions");

  const trimmed = data.name.trim();
  if (trimmed.length < 2) {
    return {
      ok: false as const,
      code: "INVALID_NAME" as const,
      message: "Name must contain at least 2 characters",
    };
  }

  const existing = await prisma.disposition.findUnique({
    where: { name_campaignId: { name: trimmed, campaignId: data.campaignId } },
  });
  if (existing) {
    return {
      ok: false as const,
      code: "DUPLICATE" as const,
      message: `"${trimmed}" already exists in this campaign`,
    };
  }

  if (!data.allowSimilar) {
    const allInCampaign = await prisma.disposition.findMany({
      where: { campaignId: data.campaignId, active: true },
      select: { id: true, name: true },
    });

    const similar = allInCampaign.find(
      (d) => levenshteinDistance(d.name.toLowerCase(), trimmed.toLowerCase()) <= 2,
    );
    if (similar) {
      return {
        ok: false as const,
        code: "SIMILAR" as const,
        existing: similar,
      };
    }
  }

  const disposition = await prisma.$transaction(async (tx) => {
    const disposition = await tx.disposition.create({
      data: { name: trimmed, campaignId: data.campaignId, createdById: session.user.id },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: data.campaignId,
        module: "dispositions",
        action: "created_inline",
        entityType: "disposition",
        entityId: disposition.id,
        afterValue: disposition,
        impact: "Disposition created from the evaluation workflow.",
      },
      tx,
    );
    return disposition;
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return { ok: true as const, disposition };
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
  if (!session?.user) throw new Error("Unauthorized");

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
  if (!existing) throw new Error("Disposition not found");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  if (data.categoryId) {
    const category = await prisma.dispositionCategory.findUnique({
      where: { id: data.categoryId },
      select: { campaignId: true },
    });
    if (!category || category.campaignId !== existing.campaignId) {
      throw new Error("Invalid category for this disposition");
    }
  }

  const disposition = await prisma.$transaction(async (tx) => {
    const disposition = await tx.disposition.update({
      where: { id },
      data: {
        name: data.name.trim(),
        code: data.code?.trim() || null,
        categoryId: data.categoryId ?? null,
        active: data.active,
        ...(data.outcomeType !== undefined ? { outcomeType: data.outcomeType } : {}),
      },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: existing.campaignId,
        module: "dispositions",
        action: "updated",
        entityType: "disposition",
        entityId: id,
        beforeValue: existing,
        afterValue: disposition,
        impact: "Operational disposition updated.",
      },
      tx,
    );
    return disposition;
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
  return disposition;
}

export async function deleteDisposition(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const existing = await prisma.disposition.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, categoryId: true, campaignId: true, active: true },
  });
  if (!existing) throw new Error("Disposition not found");
  await assertCampaignPermissionForUser(session.user, existing.campaignId, "canManageDispositions");

  const usageCount = await prisma.response.count({ where: { dispositionId: id } });
  await prisma.$transaction(async (tx) => {
    if (usageCount > 0) {
      const updated = await tx.disposition.update({ where: { id }, data: { active: false } });
      await writeAuditLog(
        {
          userId: session.user.id,
          campaignId: existing.campaignId,
          module: "dispositions",
          action: "deactivated",
          entityType: "disposition",
          entityId: id,
          beforeValue: existing,
          afterValue: updated,
          impact: "Disposition with history deactivated for future evaluations.",
        },
        tx,
      );
      return;
    }

    await tx.disposition.delete({ where: { id } });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: existing.campaignId,
        module: "dispositions",
        action: "deleted",
        entityType: "disposition",
        entityId: id,
        beforeValue: existing,
        impact: "Disposition without evaluation history deleted.",
      },
      tx,
    );
  });
  revalidatePath("/admin/campaigns");
  revalidatePath("/operations/dispositions");
}

export async function bulkImportDispositions(data: {
  campaignId: string;
  categoryId?: string;
  names: string[];
}) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertCampaignPermissionForUser(session.user, data.campaignId, "canManageDispositions");

  if (data.categoryId) {
    const category = await prisma.dispositionCategory.findUnique({
      where: { id: data.categoryId },
      select: { campaignId: true },
    });
    if (!category || category.campaignId !== data.campaignId) {
      throw new Error("Invalid category for this campaign");
    }
  }

  const uniqueNames = [...new Set(data.names.map((n) => n.trim()).filter((n) => n.length > 0))];
  if (uniqueNames.length === 0) throw new Error("No valid names were provided");

  const existing = await prisma.disposition.findMany({
    where: { campaignId: data.campaignId },
    select: { name: true },
  });
  const existingSet = new Set(existing.map((d) => d.name.toLowerCase()));
  const toCreate = uniqueNames.filter((n) => !existingSet.has(n.toLowerCase()));

  if (toCreate.length === 0) return { created: 0, skipped: uniqueNames.length };

  await prisma.$transaction(async (tx) => {
    await tx.disposition.createMany({
      data: toCreate.map((name) => ({
        name,
        categoryId: data.categoryId || null,
        campaignId: data.campaignId,
        createdById: session.user.id,
      })),
      skipDuplicates: true,
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: data.campaignId,
        module: "dispositions",
        action: "bulk_imported",
        entityType: "disposition",
        afterValue: { created: toCreate.length, skipped: uniqueNames.length - toCreate.length },
        impact: "Bulk disposition import completed for the campaign.",
      },
      tx,
    );
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
