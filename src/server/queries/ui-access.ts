import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CAMPAIGN_PERMISSION_KEYS,
  type CampaignPermissionKey,
  type CampaignPermissionState,
} from "@/lib/campaign-permissions";

export type UiAccess = CampaignPermissionState & {
  isAdmin: boolean;
  canOpenSettings: boolean;
};

const ALL_CAMPAIGN_PERMISSIONS = CAMPAIGN_PERMISSION_KEYS.reduce(
  (access, permission) => {
    access[permission] = true;
    return access;
  },
  {} as CampaignPermissionState,
);

const NO_CAMPAIGN_PERMISSIONS = CAMPAIGN_PERMISSION_KEYS.reduce(
  (access, permission) => {
    access[permission] = false;
    return access;
  },
  {} as CampaignPermissionState,
);

function toUiAccess(isAdmin: boolean, permissions: CampaignPermissionState): UiAccess {
  return {
    ...permissions,
    isAdmin,
    canOpenSettings: true,
  };
}

export async function getCurrentUserUiAccess(): Promise<UiAccess> {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  if (session.user.role === "ADMIN") {
    return toUiAccess(true, ALL_CAMPAIGN_PERMISSIONS);
  }

  const campaignAccess = await prisma.userCampaign.findMany({
    where: { userId: session.user.id },
    select: {
      canViewDashboard: true,
      canViewKPIs: true,
      canViewForms: true,
      canCreateForms: true,
      canEditForms: true,
      canPublishForms: true,
      canEvaluate: true,
      canEditEvaluations: true,
      canViewReports: true,
      canExport: true,
      canManageAgents: true,
      canManageDispositions: true,
      canManageCampaignScoring: true,
    },
  });

  const permissions = { ...NO_CAMPAIGN_PERMISSIONS };
  for (const access of campaignAccess) {
    for (const permission of CAMPAIGN_PERMISSION_KEYS) {
      permissions[permission] = permissions[permission] || access[permission];
    }
  }

  return toUiAccess(false, permissions);
}

export async function hasAnyCampaignPermission(permission: CampaignPermissionKey) {
  const access = await getCurrentUserUiAccess();
  return access.isAdmin || access[permission];
}
