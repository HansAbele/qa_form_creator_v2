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

export async function writeAuditLog(input: AuditLogInput) {
  try {
    const auditLog = (
      prisma as unknown as {
        auditLog?: {
          create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
        };
      }
    ).auditLog;

    if (!auditLog) return;

    await auditLog.create({
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
  } catch (error) {
    console.error("Failed to write audit log", error);
  }
}
