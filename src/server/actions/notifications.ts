"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/server/notifications";

export type NotificationItem = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  campaignName: string | null;
  readAt: string | null;
  createdAt: string;
};

async function getCurrentUserId() {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  return session.user.id;
}

export async function getMyNotifications(limit = 12): Promise<NotificationItem[]> {
  const userId = await getCurrentUserId();

  const notifications = await prisma.notification.findMany({
    where: { userId, archivedAt: null },
    include: { campaign: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });

  return notifications.map((notification) => ({
    id: notification.id,
    type: notification.type,
    severity: notification.severity,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    entityType: notification.entityType,
    entityId: notification.entityId,
    campaignName: notification.campaign?.name ?? null,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  }));
}

export async function getUnreadNotificationCount() {
  const userId = await getCurrentUserId();
  return prisma.notification.count({
    where: { userId, readAt: null, archivedAt: null },
  });
}

export async function markNotificationRead(notificationId: string) {
  const userId = await getCurrentUserId();
  await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const userId = await getCurrentUserId();
  await prisma.notification.updateMany({
    where: { userId, readAt: null, archivedAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/", "layout");
}

export async function archiveNotification(notificationId: string) {
  const userId = await getCurrentUserId();
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { archivedAt: new Date(), readAt: new Date() },
  });
  revalidatePath("/", "layout");
}

export async function setNotificationPreference(input: {
  type: NotificationType;
  inApp: boolean;
  email?: boolean;
}) {
  const userId = await getCurrentUserId();

  return prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type: input.type } },
    create: {
      userId,
      type: input.type,
      inApp: input.inApp,
      email: input.email ?? false,
    },
    update: {
      inApp: input.inApp,
      email: input.email ?? false,
    },
  });
}
