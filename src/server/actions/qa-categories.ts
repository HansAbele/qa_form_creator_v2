"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

const categoryMutationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || null),
  canBeFatal: z.boolean(),
  requiresCommentOnFail: z.boolean(),
  visibleInDashboard: z.boolean(),
  visibleInKPIs: z.boolean(),
});

export type QACategoryMutationInput = z.input<typeof categoryMutationSchema>;

async function requireQAManager() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

function parseCategoryInput(input: unknown) {
  const parsed = categoryMutationSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid QA category data");
  }
  return parsed.data;
}

export interface QACategorySummary {
  id: string;
  name: string;
  description: string | null;
  systemColor: string | null;
  systemIcon: string | null;
  isActive: boolean;
  canBeFatal: boolean;
  requiresCommentOnFail: boolean;
  visibleInDashboard: boolean;
  visibleInKPIs: boolean;
  usageCount: number;
}

export interface QACategoryFormOption {
  id: string;
  name: string;
  description: string | null;
  systemColor: string | null;
  canBeFatal: boolean;
  requiresCommentOnFail: boolean;
}

/** Complete administrative catalog, including inactive categories and global usage. */
export async function readQACategories(): Promise<QACategorySummary[]> {
  await requireQAManager();

  const categories = await prisma.qACategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { formCategories: true } } },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    systemColor: category.systemColor,
    systemIcon: category.systemIcon,
    isActive: category.isActive,
    canBeFatal: category.canBeFatal,
    requiresCommentOnFail: category.requiresCommentOnFail,
    visibleInDashboard: category.visibleInDashboard,
    visibleInKPIs: category.visibleInKPIs,
    usageCount: category._count.formCategories,
  }));
}

async function readActiveQACategoriesForPermission(
  permission: "canCreateForms" | "canEditForms",
): Promise<QACategoryFormOption[]> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role !== "ADMIN") {
    if (session.user.role === "SUPERVISOR") throw new Error("Unauthorized");
    const access = await prisma.userCampaign.findMany({
      where: { userId: session.user.id, [permission]: true },
      select: { campaignId: true },
      take: 1,
    });
    if (access.length === 0) throw new Error("Unauthorized");
  }

  return prisma.qACategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      systemColor: true,
      canBeFatal: true,
      requiresCommentOnFail: true,
    },
  });
}

export async function readActiveQACategoriesForFormCreation() {
  return readActiveQACategoriesForPermission("canCreateForms");
}

export async function readActiveQACategoriesForFormEditing() {
  return readActiveQACategoriesForPermission("canEditForms");
}

export async function createQACategory(data: QACategoryMutationInput) {
  const session = await requireQAManager();
  const input = parseCategoryInput(data);
  const existing = await prisma.qACategory.findFirst({
    where: { name: { equals: input.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw new Error("A QA category with this name already exists");

  const sortOrder = await prisma.qACategory.count();
  const category = await prisma.$transaction(async (tx) => {
    const category = await tx.qACategory.create({ data: { ...input, sortOrder } });
    await writeAuditLog(
      {
        userId: session.user.id,
        module: "qa_categories",
        action: "created",
        entityType: "qa_category",
        entityId: category.id,
        afterValue: category,
        impact: "QA category made available for new forms.",
      },
      tx,
    );
    return category;
  });
  revalidatePath("/settings");
  revalidatePath("/forms");
  return category;
}

export async function updateQACategory(id: string, data: QACategoryMutationInput) {
  const session = await requireQAManager();
  const input = parseCategoryInput(data);
  const before = await prisma.qACategory.findUnique({ where: { id } });
  if (!before) throw new Error("QA category not found");

  const duplicate = await prisma.qACategory.findFirst({
    where: { id: { not: id }, name: { equals: input.name, mode: "insensitive" } },
    select: { id: true },
  });
  if (duplicate) throw new Error("A QA category with this name already exists");

  const category = await prisma.$transaction(async (tx) => {
    const category = await tx.qACategory.update({ where: { id }, data: input });
    await writeAuditLog(
      {
        userId: session.user.id,
        module: "qa_categories",
        action: "updated",
        entityType: "qa_category",
        entityId: id,
        beforeValue: before,
        afterValue: category,
        impact: "QA category rules and visibility updated.",
      },
      tx,
    );
    return category;
  });
  revalidatePath("/settings");
  revalidatePath("/forms");
  return category;
}

export async function deactivateQACategory(id: string) {
  const session = await requireQAManager();
  const before = await prisma.qACategory.findUnique({
    where: { id },
    include: { _count: { select: { formCategories: true } } },
  });
  if (!before) throw new Error("QA category not found");
  if (!before.isActive) throw new Error("QA category is already inactive");
  if (before._count.formCategories > 0) {
    throw new Error("A QA category used by forms cannot be deactivated");
  }

  const category = await prisma.$transaction(async (tx) => {
    const category = await tx.qACategory.update({ where: { id }, data: { isActive: false } });
    await writeAuditLog(
      {
        userId: session.user.id,
        module: "qa_categories",
        action: "deactivated",
        entityType: "qa_category",
        entityId: id,
        beforeValue: before,
        afterValue: category,
        impact: "QA category removed from new forms without deleting history.",
      },
      tx,
    );
    return category;
  });
  revalidatePath("/settings");
  revalidatePath("/forms");
  return category;
}
