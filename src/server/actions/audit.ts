"use server";

import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { getOperationalDateBounds } from "@/lib/operational-time";
import { prisma } from "@/lib/prisma";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface OperationalAuditFilters {
  page?: number;
  pageSize?: number;
  module?: string;
  action?: string;
  campaignId?: string;
  userId?: string;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface OperationalAuditEvent {
  id: string;
  createdAt: string;
  module: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  impact: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  userId: string | null;
  userName: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export interface OperationalAuditPage {
  events: OperationalAuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function readOperationalAudit(
  filters: OperationalAuditFilters = {},
): Promise<OperationalAuditPage> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("No autorizado");
  }

  const page = clampInt(filters.page, 1, 10_000, 1);
  const pageSize = clampInt(filters.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const allowedCampaignIds = await getAllowedAuditCampaignIds(session.user);
  const where = buildAuditWhere(filters);
  applyAuditScope(where, filters, allowedCampaignIds);

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        campaign: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    events: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      module: row.module,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      impact: row.impact,
      beforeValue: row.beforeValue,
      afterValue: row.afterValue,
      userId: row.userId,
      userName: row.user?.name ?? row.user?.email ?? null,
      campaignId: row.campaignId,
      campaignName: row.campaign?.name ?? null,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function getAllowedAuditCampaignIds(user: {
  id: string;
  role: "ADMIN" | "QA" | "SUPERVISOR";
}): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;

  const access = await prisma.userCampaign.findMany({
    where: {
      userId: user.id,
      canViewAudit: true,
    },
    select: { campaignId: true },
  });

  const campaignIds = access.map((item) => item.campaignId);
  if (campaignIds.length === 0) {
    throw new Error("No autorizado");
  }

  return campaignIds;
}

function applyAuditScope(
  where: Prisma.AuditLogWhereInput,
  filters: OperationalAuditFilters,
  allowedCampaignIds: string[] | null,
) {
  if (!allowedCampaignIds) return;

  if (isActiveFilter(filters.campaignId)) {
    const campaignId = filters.campaignId;
    if (!campaignId || !allowedCampaignIds.includes(campaignId)) {
      throw new Error("No autorizado para esta campana");
    }
    return;
  }

  where.campaignId = { in: allowedCampaignIds };
}

function buildAuditWhere(filters: OperationalAuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (isActiveFilter(filters.module)) where.module = filters.module;
  if (isActiveFilter(filters.action)) where.action = filters.action;
  if (isActiveFilter(filters.campaignId)) where.campaignId = filters.campaignId;
  if (isActiveFilter(filters.userId)) where.userId = filters.userId;

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = getOperationalDateBounds(filters.dateFrom, filters.dateTo);
  }

  const query = filters.query?.trim();
  if (query) {
    where.OR = [
      { module: { contains: query, mode: "insensitive" } },
      { action: { contains: query, mode: "insensitive" } },
      { entityType: { contains: query, mode: "insensitive" } },
      { entityId: { contains: query, mode: "insensitive" } },
      { impact: { contains: query, mode: "insensitive" } },
      { user: { name: { contains: query, mode: "insensitive" } } },
      { user: { email: { contains: query, mode: "insensitive" } } },
      { campaign: { name: { contains: query, mode: "insensitive" } } },
    ];
  }

  return where;
}

function isActiveFilter(value: string | undefined) {
  return Boolean(value && value !== "all");
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value ?? fallback)));
}
