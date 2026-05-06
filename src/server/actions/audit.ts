"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface OperationalAuditEvent {
  id: string;
  createdAt: string;
  module: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  impact: string | null;
  userName: string | null;
  campaignName: string | null;
}

type AuditFindManyDelegate = {
  findMany: (args: {
    take: number;
    orderBy: { createdAt: "desc" };
    include: {
      user: { select: { name: true; email: true } };
      campaign: { select: { name: true } };
    };
  }) => Promise<
    {
      id: string;
      createdAt: Date;
      module: string;
      action: string;
      entityType: string | null;
      entityId: string | null;
      impact: string | null;
      user: { name: string | null; email: string } | null;
      campaign: { name: string } | null;
    }[]
  >;
};

function getAuditDelegate() {
  return (
    prisma as unknown as { auditLog?: AuditFindManyDelegate }
  ).auditLog;
}

export async function readOperationalAudit(limit = 50): Promise<OperationalAuditEvent[]> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("No autorizado");
  }

  const auditLog = getAuditDelegate();
  if (!auditLog) return [];

  const rows = await auditLog.findMany({
    take: Math.min(Math.max(limit, 1), 200),
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, email: true } },
      campaign: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    module: row.module,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    impact: row.impact,
    userName: row.user?.name ?? row.user?.email ?? null,
    campaignName: row.campaign?.name ?? null,
  }));
}
