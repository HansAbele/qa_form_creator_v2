import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXPORT_LIMITS,
  ExportBusyError,
  ExportGlobalBusyError,
  ExportRateLimitError,
} from "@/lib/export-limits";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});

import { reserveExportCapacity } from "./export-admission";

const limits = { ...DEFAULT_EXPORT_LIMITS };

describe("distributed export admission", () => {
  beforeEach(() => resetPrismaMock());

  it("serializes by user and records a reservation", async () => {
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { recentCount: 0, recentRejectionCount: 0, activeUserCount: 0, activeGlobalCount: 0 },
    ]);

    await reserveExportCapacity({ userId: "user-1", exportId: "export-1", limits });

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
    const lockQueries = prismaMock.$executeRaw.mock.calls.map(([query]) => query) as Array<{
      values?: unknown[];
    }>;
    expect(lockQueries[0]?.values).toContain("qore:export:global");
    expect(lockQueries[1]?.values).toContain("qore:export:user-1");
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    const admissionQuery = prismaMock.$queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
      values?: unknown[];
    };
    expect(admissionQuery.strings?.join("?")).toContain("statement_timestamp()");
    expect(admissionQuery.values?.some((value: unknown) => value instanceof Date)).not.toBe(true);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          campaignId: null,
          action: "reserved",
          entityId: "export-1",
          afterValue: expect.objectContaining({ maxConcurrentGlobal: 2 }),
        }),
      }),
    );
  });

  it.each([
    {
      exportId: "rate",
      counts: {
        recentCount: 4,
        recentRejectionCount: 0,
        activeUserCount: 0,
        activeGlobalCount: 0,
      },
      reason: "rate_limit",
      error: ExportRateLimitError,
    },
    {
      exportId: "user-busy",
      counts: {
        recentCount: 1,
        recentRejectionCount: 0,
        activeUserCount: 1,
        activeGlobalCount: 1,
      },
      reason: "user_concurrency",
      error: ExportBusyError,
    },
    {
      exportId: "global-busy",
      counts: {
        recentCount: 0,
        recentRejectionCount: 0,
        activeUserCount: 0,
        activeGlobalCount: 2,
      },
      reason: "global_concurrency",
      error: ExportGlobalBusyError,
    },
  ])("audits a rejected $reason admission before returning its error", async (scenario) => {
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValueOnce([scenario.counts]);

    await expect(
      reserveExportCapacity({ userId: "user-1", exportId: scenario.exportId, limits }),
    ).rejects.toBeInstanceOf(scenario.error);
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "rejected",
          entityId: scenario.exportId,
          afterValue: expect.objectContaining({
            reason: scenario.reason,
            maxConcurrentGlobal: 2,
          }),
        }),
      }),
    );
  });

  it("throttles repeated rejected audit evidence for one user within a minute", async () => {
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { recentCount: 0, recentRejectionCount: 1, activeUserCount: 0, activeGlobalCount: 2 },
    ]);

    await expect(
      reserveExportCapacity({ userId: "user-1", exportId: "repeated", limits }),
    ).rejects.toBeInstanceOf(ExportGlobalBusyError);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
