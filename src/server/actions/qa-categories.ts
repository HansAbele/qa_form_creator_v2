"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

type QACategoryDelegate = {
  findMany: (args: {
    orderBy: { sortOrder: "asc" };
    include: { _count: { select: { formCategories: true } } };
  }) => Promise<
    {
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
      _count: { formCategories: number };
    }[]
  >;
};

function getCategoryDelegate() {
  return (
    prisma as unknown as { qACategory?: QACategoryDelegate }
  ).qACategory;
}

export async function readQACategories(): Promise<QACategorySummary[]> {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const qACategory = getCategoryDelegate();
  if (!qACategory) return [];

  const categories = await qACategory.findMany({
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
