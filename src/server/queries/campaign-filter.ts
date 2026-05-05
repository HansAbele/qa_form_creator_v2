import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { CampaignPermissionKey } from "@/lib/campaign-permissions";
import type { Session } from "next-auth";

type SessionUser = Session["user"];
type CampaignFilter = { campaignId?: string | { in: string[] } };

export function assertCampaignAccessForUser(user: SessionUser, campaignId: string) {
  if (user.role === "ADMIN") return;

  if (!user.campaignIds.includes(campaignId)) {
    throw new Error("No autorizado para esta campana");
  }
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
  if (user.role === "ADMIN") return;

  assertCampaignAccessForUser(user, campaignId);

  const access = await prisma.userCampaign.findUnique({
    where: {
      userId_campaignId: {
        userId: user.id,
        campaignId,
      },
    },
  });

  if (!access?.[permission]) {
    throw new Error("No autorizado para esta accion en esta campana");
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
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role === "ADMIN") {
    return campaignId ? { campaignId } : {};
  }

  if (campaignId) {
    await assertCampaignPermissionForUser(session.user, campaignId, permission);
    return { campaignId };
  }

  const access = await prisma.userCampaign.findMany({
    where: { userId: session.user.id },
  });
  const permittedCampaignIds = access
    .filter((item) => item[permission])
    .map((item) => item.campaignId);

  return { campaignId: { in: permittedCampaignIds } };
}
