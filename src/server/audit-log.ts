import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AuditLogInput = {
  userId?: string | null;
  campaignId?: string | null;
  module: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  impact?: string | null;
};

function normalizeJsonValue(value: unknown) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

type AuditDatabaseClient = Pick<Prisma.TransactionClient, "auditLog">;

/**
 * Persists an audit record and deliberately propagates database errors.
 * Mutations must pass their transaction client so the business write and its
 * audit record either commit together or roll back together.
 */
export async function writeAuditLog(
  input: AuditLogInput,
  database: AuditDatabaseClient = prisma,
) {
  return database.auditLog.create({
    data: {
      userId: input.userId ?? null,
      campaignId: input.campaignId ?? null,
      module: input.module,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      beforeValue: normalizeJsonValue(input.beforeValue),
      afterValue: normalizeJsonValue(input.afterValue),
      impact: input.impact ?? null,
    },
  });
}
