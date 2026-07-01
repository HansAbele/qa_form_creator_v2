import { prisma } from "@/lib/prisma";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";

export type NotificationType =
  | "evaluation_failed"
  | "fatal_evaluation"
  | "evaluation_cancelled"
  | "export_generated"
  | "settings_changed"
  | "coaching_opportunity"
  | "campaign_risk";

export type NotificationSeverity = "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";

type NotificationCreateInput = {
  userId: string;
  campaignId: string | null;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata?: unknown;
};

type NotificationDelegate = {
  createMany: (args: { data: NotificationCreateInput[] }) => Promise<unknown>;
};

function getNotificationDelegate() {
  return (
    prisma as unknown as {
      notification?: NotificationDelegate;
    }
  ).notification;
}

function normalizeMetadata(value: unknown) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export async function emitNotification(input: {
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  campaignId?: string | null;
  permission?: CampaignPermissionKey;
  recipientUserIds?: string[];
  includeAdmins?: boolean;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
}) {
  const delegate = getNotificationDelegate();
  if (!delegate) return { delivered: 0 };

  try {
    const recipientIds = new Set(input.recipientUserIds ?? []);
    const includeAdmins = input.includeAdmins ?? true;

    if (input.campaignId && input.permission) {
      const campaignRecipientsRaw = await prisma.userCampaign.findMany({
        where: {
          campaignId: input.campaignId,
          [input.permission]: true,
          user: { active: true },
        },
        select: {
          userId: true,
          user: {
            select: {
              notificationPreferences: {
                where: { type: input.type },
                select: { inApp: true },
              },
            },
          },
        },
      });
      const campaignRecipients = Array.isArray(campaignRecipientsRaw)
        ? campaignRecipientsRaw
        : [];

      for (const recipient of campaignRecipients) {
        const preference = recipient.user?.notificationPreferences?.[0];
        if (preference?.inApp === false) continue;
        recipientIds.add(recipient.userId);
      }
    }

    if (includeAdmins) {
      const adminsRaw = await prisma.user.findMany({
        where: { active: true, role: "ADMIN" },
        select: {
          id: true,
          notificationPreferences: {
            where: { type: input.type },
            select: { inApp: true },
          },
        },
      });
      const admins = Array.isArray(adminsRaw) ? adminsRaw : [];

      for (const admin of admins) {
        const preference = admin.notificationPreferences?.[0];
        if (preference?.inApp === false) continue;
        recipientIds.add(admin.id);
      }
    }

    if (recipientIds.size === 0) return { delivered: 0 };

    await delegate.createMany({
      data: [...recipientIds].map((userId) => ({
        userId,
        campaignId: input.campaignId ?? null,
        type: input.type,
        severity: input.severity ?? "INFO",
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: normalizeMetadata(input.metadata),
      })),
    });

    return { delivered: recipientIds.size };
  } catch (error) {
    console.error("Failed to emit notification", error);
    return { delivered: 0 };
  }
}

export async function emitNotificationToUser(input: {
  userId: string;
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  campaignId?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
}) {
  return emitNotification({
    ...input,
    recipientUserIds: [input.userId],
    includeAdmins: false,
  });
}
