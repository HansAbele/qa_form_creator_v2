import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import {
  type CampaignPermissionKey,
  isAgentRole,
  isSupervisorBlockedPermission,
  isSupervisorRole,
} from "@/lib/campaign-permissions";
import { prisma } from "@/lib/prisma";

type SessionUser = Session["user"];
type CampaignFilter = { campaignId?: string | { in: string[] } };

export class CampaignAuthorizationError extends Error {
  constructor(message = "Unauthorized for this action") {
    super(message);
    this.name = "CampaignAuthorizationError";
  }
}

export function assertCampaignAccessForUser(user: SessionUser, campaignId: string) {
  if (user.role === "ADMIN") return;
  if (isAgentRole(user.role)) {
    throw new CampaignAuthorizationError("Agent portal access is limited to personal records");
  }

  if (!user.campaignIds.includes(campaignId)) {
    throw new CampaignAuthorizationError("Unauthorized for this campaign");
  }
}

export async function hasCampaignPermissionForUser(
  user: SessionUser,
  campaignId: string,
  permission: CampaignPermissionKey,
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (isAgentRole(user.role)) return false;
  if (isSupervisorRole(user.role) && isSupervisorBlockedPermission(permission)) return false;
  if (!user.campaignIds.includes(campaignId)) return false;

  const access = await prisma.userCampaign.findUnique({
    where: {
      userId_campaignId: {
        userId: user.id,
        campaignId,
      },
    },
  });

  return Boolean(access?.[permission]);
}

export async function assertCampaignAccess(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  assertCampaignAccessForUser(session.user, campaignId);
  return session;
}

export async function assertCampaignPermissionForUser(
  user: SessionUser,
  campaignId: string,
  permission: CampaignPermissionKey,
) {
  return assertCampaignPermissionsForUser(user, campaignId, [permission]);
}

export async function assertCampaignPermissionsForUser(
  user: SessionUser,
  campaignId: string,
  permissions: readonly [CampaignPermissionKey, ...CampaignPermissionKey[]],
) {
  if (user.role === "ADMIN") return;
  if (
    isSupervisorRole(user.role) &&
    permissions.some((permission) => isSupervisorBlockedPermission(permission))
  ) {
    throw new CampaignAuthorizationError("Unauthorized for this action in this campaign");
  }

  assertCampaignAccessForUser(user, campaignId);

  const access = await prisma.userCampaign.findUnique({
    where: {
      userId_campaignId: {
        userId: user.id,
        campaignId,
      },
    },
  });

  if (!access || permissions.some((permission) => !access[permission])) {
    throw new CampaignAuthorizationError("Unauthorized for this action in this campaign");
  }
}

export async function assertCampaignPermission(
  campaignId: string,
  permission: CampaignPermissionKey,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await assertCampaignPermissionForUser(session.user, campaignId, permission);
  return session;
}

export async function getCampaignFilter(campaignId?: string): Promise<CampaignFilter> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role === "ADMIN") {
    return campaignId ? { campaignId } : {};
  }
  if (isAgentRole(session.user.role)) {
    if (campaignId) {
      throw new CampaignAuthorizationError("Agent portal access is limited to personal records");
    }
    return { campaignId: { in: [] } };
  }

  if (campaignId) {
    assertCampaignAccessForUser(session.user, campaignId);
    return { campaignId };
  }

  return { campaignId: { in: session.user.campaignIds } };
}

export async function getCampaignFilterForPermission(
  permission: CampaignPermissionKey,
  campaignId?: string,
): Promise<CampaignFilter> {
  return getCampaignFilterForPermissions([permission], campaignId);
}

export async function getCampaignFilterForPermissions(
  permissions: readonly [CampaignPermissionKey, ...CampaignPermissionKey[]],
  campaignId?: string,
): Promise<CampaignFilter> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role === "ADMIN") {
    return campaignId ? { campaignId } : {};
  }
  if (isAgentRole(session.user.role)) {
    if (campaignId) {
      throw new CampaignAuthorizationError("Agent portal access is limited to personal records");
    }
    return { campaignId: { in: [] } };
  }
  if (
    isSupervisorRole(session.user.role) &&
    permissions.some((permission) => isSupervisorBlockedPermission(permission))
  ) {
    if (campaignId) {
      await assertCampaignPermissionsForUser(session.user, campaignId, permissions);
    }
    return { campaignId: { in: [] } };
  }

  if (campaignId) {
    await assertCampaignPermissionsForUser(session.user, campaignId, permissions);
    return { campaignId };
  }

  const access = await prisma.userCampaign.findMany({
    where: { userId: session.user.id },
  });
  const permittedCampaignIds = access
    .filter((item) => permissions.every((permission) => item[permission]))
    .map((item) => item.campaignId);

  return { campaignId: { in: permittedCampaignIds } };
}
