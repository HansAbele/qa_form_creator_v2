import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, revalidatePathMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { getUnreadNotificationCount, markNotificationRead } from "./notifications";

describe("notification access revocation", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    revalidatePathMock.mockReset();
    authMock.mockResolvedValue({
      user: { id: "qa-1", role: "QA", campaignIds: ["campaign-1"] },
    });
    prismaMock.notification.count.mockResolvedValue(0);
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
  });

  it("re-checks the current campaign permission before listing or counting", async () => {
    await getUnreadNotificationCount();

    const where = prismaMock.notification.count.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({
        userId: "qa-1",
        archivedAt: null,
        readAt: null,
        OR: expect.arrayContaining([
          { campaignId: null, requiredPermission: null },
          {
            requiredPermission: "canViewReports",
            campaign: {
              users: { some: { userId: "qa-1", canViewReports: true } },
            },
          },
        ]),
      }),
    );
  });

  it("applies the same visibility scope when mutating a notification", async () => {
    await markNotificationRead("notification-1");

    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "notification-1",
        userId: "qa-1",
        OR: expect.any(Array),
      }),
      data: { readAt: expect.any(Date) },
    });
  });

  it("does not honor legacy write permissions for supervisors", async () => {
    authMock.mockResolvedValue({
      user: { id: "supervisor-1", role: "SUPERVISOR", campaignIds: ["campaign-1"] },
    });

    await getUnreadNotificationCount();

    const whereJson = JSON.stringify(prismaMock.notification.count.mock.calls[0][0].where);
    expect(whereJson).toContain("canViewReports");
    expect(whereJson).not.toContain("canEvaluate");
    expect(whereJson).not.toContain("canExport");
  });

  it("keeps global QA Manager access to explicitly delivered notifications", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", campaignIds: [] },
    });

    await getUnreadNotificationCount();

    expect(prismaMock.notification.count).toHaveBeenCalledWith({
      where: { userId: "admin-1", readAt: null, archivedAt: null },
    });
  });
});
