import { Prisma } from "@prisma/client";
import {
  ExportBusyError,
  ExportGlobalBusyError,
  ExportRateLimitError,
  type getExportLimits,
} from "@/lib/export-limits";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

type ExportLimits = ReturnType<typeof getExportLimits>;

type AdmissionCountRow = {
  recentCount: bigint | number;
  recentRejectionCount: bigint | number;
  activeUserCount: bigint | number;
  activeGlobalCount: bigint | number;
};

type AdmissionRejection = {
  reason: "rate_limit" | "user_concurrency" | "global_concurrency";
  recentCount: number;
  activeUserCount: number;
  activeGlobalCount: number;
};

const GLOBAL_EXPORT_ADVISORY_LOCK_KEY = "qore:export:global";

/**
 * Distributed admission control backed by the append-only AuditLog. The
 * global lock is always acquired before the per-user lock, so reservations
 * across every application replica share one deadlock-safe admission order.
 */
export async function reserveExportCapacity({
  userId,
  exportId,
  limits,
}: {
  userId: string;
  exportId: string;
  limits: ExportLimits;
}) {
  const rejection = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${GLOBAL_EXPORT_ADVISORY_LOCK_KEY}, 0::bigint))`,
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`qore:export:${userId}`}, 0::bigint))`,
    );

    const rows = await tx.$queryRaw<AdmissionCountRow[]>(Prisma.sql`
      WITH active_reservation AS MATERIALIZED (
        SELECT reservation."userId", reservation."entityId"
        FROM "AuditLog" reservation
        WHERE reservation."module" = 'exports'
          AND reservation."entityType" = 'export'
          AND reservation."action" = 'reserved'
          AND reservation."entityId" IS NOT NULL
          AND reservation."createdAt" >= statement_timestamp()
            - (${limits.leaseTimeoutSeconds} * INTERVAL '1 second')
          AND NOT EXISTS (
            SELECT 1
            FROM "AuditLog" terminal
            WHERE terminal."userId" = reservation."userId"
              AND terminal."module" = 'exports'
              AND terminal."entityType" = 'export'
              AND terminal."entityId" = reservation."entityId"
              AND terminal."action" IN ('generated', 'cancelled', 'failed', 'rejected')
              AND terminal."createdAt" >= reservation."createdAt"
          )
      )
      SELECT
        (
          SELECT COUNT(DISTINCT reservation."entityId")::bigint
          FROM "AuditLog" reservation
          WHERE reservation."userId" = ${userId}
            AND reservation."module" = 'exports'
            AND reservation."entityType" = 'export'
            AND reservation."action" = 'reserved'
            AND reservation."entityId" IS NOT NULL
            AND reservation."createdAt" >= statement_timestamp() - INTERVAL '1 minute'
        ) AS "recentCount",
        (
          SELECT COUNT(*)::bigint
          FROM "AuditLog" rejection
          WHERE rejection."userId" = ${userId}
            AND rejection."module" = 'exports'
            AND rejection."entityType" = 'export'
            AND rejection."action" = 'rejected'
            AND rejection."createdAt" >= statement_timestamp() - INTERVAL '1 minute'
        ) AS "recentRejectionCount",
        (
          SELECT COUNT(DISTINCT active."entityId")::bigint
          FROM active_reservation active
          WHERE active."userId" = ${userId}
        ) AS "activeUserCount",
        (
          SELECT COUNT(DISTINCT active."entityId")::bigint
          FROM active_reservation active
        ) AS "activeGlobalCount"
    `);
    const recentCount = Number(rows[0]?.recentCount ?? 0);
    const recentRejectionCount = Number(rows[0]?.recentRejectionCount ?? 0);
    const activeUserCount = Number(rows[0]?.activeUserCount ?? 0);
    const activeGlobalCount = Number(rows[0]?.activeGlobalCount ?? 0);

    let denied: AdmissionRejection | null = null;
    if (recentCount >= limits.maxRequestsPerMinute) {
      denied = { reason: "rate_limit", recentCount, activeUserCount, activeGlobalCount };
    } else if (activeUserCount >= limits.maxConcurrentPerUser) {
      denied = { reason: "user_concurrency", recentCount, activeUserCount, activeGlobalCount };
    } else if (activeGlobalCount >= limits.maxConcurrentGlobal) {
      denied = { reason: "global_concurrency", recentCount, activeUserCount, activeGlobalCount };
    }

    if (denied) {
      if (recentRejectionCount === 0) {
        await writeAuditLog(
          {
            userId,
            campaignId: null,
            module: "exports",
            action: "rejected",
            entityType: "export",
            entityId: exportId,
            afterValue: {
              reason: denied.reason,
              recentCount,
              activeUserCount,
              activeGlobalCount,
              maxRequestsPerMinute: limits.maxRequestsPerMinute,
              maxConcurrentPerUser: limits.maxConcurrentPerUser,
              maxConcurrentGlobal: limits.maxConcurrentGlobal,
              leaseTimeoutSeconds: limits.leaseTimeoutSeconds,
            },
            impact: "Export reservation rejected by the distributed admission budget.",
          },
          tx,
        );
      }
      return denied;
    }

    await writeAuditLog(
      {
        userId,
        campaignId: null,
        module: "exports",
        action: "reserved",
        entityType: "export",
        entityId: exportId,
        afterValue: {
          maxRequestsPerMinute: limits.maxRequestsPerMinute,
          maxConcurrentPerUser: limits.maxConcurrentPerUser,
          maxConcurrentGlobal: limits.maxConcurrentGlobal,
          leaseTimeoutSeconds: limits.leaseTimeoutSeconds,
        },
        impact: "Distributed capacity reserved before querying export data.",
      },
      tx,
    );
    return null;
  });

  if (!rejection) return;
  const retryAfterSeconds = Math.min(limits.leaseTimeoutSeconds, 60);
  if (rejection.reason === "rate_limit") throw new ExportRateLimitError();
  if (rejection.reason === "user_concurrency") throw new ExportBusyError(retryAfterSeconds);
  throw new ExportGlobalBusyError(retryAfterSeconds);
}
