import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  const mockedPrisma = (module as { prismaMock: unknown }).prismaMock;
  return { prisma: mockedPrisma };
});

import { emitNotification, emitNotificationToUser } from "./notifications";

describe("notification engine", () => {
  beforeEach(() => {
    resetPrismaMock();
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 });
  });

  it("delivers campaign notifications to permitted recipients and admins", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        userId: "qa-1",
        user: { notificationPreferences: [] },
      },
      {
        userId: "muted-1",
        user: { notificationPreferences: [{ inApp: false }] },
      },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "admin-1",
        notificationPreferences: [],
      },
    ]);

    await emitNotification({
      type: "fatal_evaluation",
      severity: "CRITICAL",
      campaignId: "campaign-1",
      permission: "canViewReports",
      title: "Fatal",
      body: "Fatal fail",
      entityType: "response",
      entityId: "response-1",
    });

    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ userId: "qa-1", type: "fatal_evaluation" }),
        expect.objectContaining({ userId: "admin-1", type: "fatal_evaluation" }),
      ]),
    });
    expect(prismaMock.notification.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("can deliver a notification only to the acting user", async () => {
    await emitNotificationToUser({
      userId: "qa-1",
      type: "export_generated",
      severity: "SUCCESS",
      title: "Export listo",
      body: "1 evaluacion exportada",
      href: "/analytics/export",
    });

    expect(prismaMock.userCampaign.findMany).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "qa-1",
          type: "export_generated",
          severity: "SUCCESS",
        }),
      ],
    });
  });
});
