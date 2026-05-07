"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

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
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("No autorizado");
  }

  const page = clampInt(filters.page, 1, 10_000, 1);
  const pageSize = clampInt(filters.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const where = buildAuditWhere(filters);

  try {
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
  } catch {
    return {
      events: [],
      total: 0,
      page,
      pageSize,
      pageCount: 1,
    };
  }
}

function buildAuditWhere(filters: OperationalAuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (isActiveFilter(filters.module)) where.module = filters.module;
  if (isActiveFilter(filters.action)) where.action = filters.action;
  if (isActiveFilter(filters.campaignId)) where.campaignId = filters.campaignId;
  if (isActiveFilter(filters.userId)) where.userId = filters.userId;

  const createdAt: Prisma.DateTimeFilter = {};
  const dateFrom = parseDate(filters.dateFrom, false);
  const dateTo = parseDate(filters.dateTo, true);
  if (dateFrom) createdAt.gte = dateFrom;
  if (dateTo) createdAt.lte = dateTo;
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

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

function parseDate(value: string | undefined, endOfDay: boolean) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value ?? fallback)));
}
