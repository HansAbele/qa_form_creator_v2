"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  CAMPAIGN_PERMISSION_KEYS,
  isSupervisorBlockedPermission,
} from "@/lib/campaign-permissions";
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

async function getCurrentUser() {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  return session.user;
}

function getNotificationVisibilityWhere(
  user: Awaited<ReturnType<typeof getCurrentUser>>,
): Prisma.NotificationWhereInput {
  if (user.role === "ADMIN") return { userId: user.id };

  const permissionClauses: Prisma.NotificationWhereInput[] = CAMPAIGN_PERMISSION_KEYS.filter(
    (permission) => user.role !== "SUPERVISOR" || !isSupervisorBlockedPermission(permission),
  ).map((permission) => ({
    requiredPermission: permission,
    campaign: {
      users: {
        some: { userId: user.id, [permission]: true },
      },
    },
  }));

  return {
    userId: user.id,
    OR: [
      // Truly global notifications are explicit deliveries with no campaign or permission.
      { campaignId: null, requiredPermission: null },
      // Campaign messages without a specific permission still require current assignment.
      {
        requiredPermission: null,
        campaign: { users: { some: { userId: user.id } } },
      },
      ...permissionClauses,
    ],
  };
}

export async function getMyNotifications(limit = 12): Promise<NotificationItem[]> {
  const user = await getCurrentUser();

  const notifications = await prisma.notification.findMany({
    where: { ...getNotificationVisibilityWhere(user), archivedAt: null },
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
  const user = await getCurrentUser();
  return prisma.notification.count({
    where: {
      ...getNotificationVisibilityWhere(user),
      readAt: null,
      archivedAt: null,
    },
  });
}

export async function markNotificationRead(notificationId: string) {
  const user = await getCurrentUser();
  await prisma.notification.updateMany({
    where: { id: notificationId, ...getNotificationVisibilityWhere(user), readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  await prisma.notification.updateMany({
    where: {
      ...getNotificationVisibilityWhere(user),
      readAt: null,
      archivedAt: null,
    },
    data: { readAt: new Date() },
  });
  revalidatePath("/", "layout");
}

export async function archiveNotification(notificationId: string) {
  const user = await getCurrentUser();
  await prisma.notification.updateMany({
    where: { id: notificationId, ...getNotificationVisibilityWhere(user) },
    data: { archivedAt: new Date(), readAt: new Date() },
  });
  revalidatePath("/", "layout");
}

export async function setNotificationPreference(input: {
  type: NotificationType;
  inApp: boolean;
  email?: boolean;
}) {
  const user = await getCurrentUser();

  return prisma.notificationPreference.upsert({
    where: { userId_type: { userId: user.id, type: input.type } },
    create: {
      userId: user.id,
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
