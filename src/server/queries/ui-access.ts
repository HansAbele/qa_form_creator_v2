import { auth } from "@/lib/auth";
import {
  CAMPAIGN_PERMISSION_KEYS,
  type CampaignPermissionKey,
  type CampaignPermissionState,
  isSupervisorRole,
  normalizeCampaignPermissionsForRole,
} from "@/lib/campaign-permissions";
import { prisma } from "@/lib/prisma";
import { getCampaignFilterForPermissions } from "@/server/queries/campaign-filter";

export type UiAccess = CampaignPermissionState & {
  isAdmin: boolean;
  isSupervisor: boolean;
  canOpenSettings: boolean;
};

const ALL_CAMPAIGN_PERMISSIONS = CAMPAIGN_PERMISSION_KEYS.reduce((access, permission) => {
  access[permission] = true;
  return access;
}, {} as CampaignPermissionState);

const NO_CAMPAIGN_PERMISSIONS = CAMPAIGN_PERMISSION_KEYS.reduce((access, permission) => {
  access[permission] = false;
  return access;
}, {} as CampaignPermissionState);

function toUiAccess(
  isAdmin: boolean,
  isSupervisor: boolean,
  permissions: CampaignPermissionState,
): UiAccess {
  return {
    ...permissions,
    isAdmin,
    isSupervisor,
    canOpenSettings: isAdmin || permissions.canViewAudit,
  };
}

export async function getCurrentUserUiAccess(): Promise<UiAccess> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const user = await prisma.user.findFirst({
    where: { id: session.user.id, active: true },
    select: { id: true, role: true },
  });

  if (!user) {
    return toUiAccess(false, false, NO_CAMPAIGN_PERMISSIONS);
  }

  if (user.role === "ADMIN") {
    return toUiAccess(true, false, ALL_CAMPAIGN_PERMISSIONS);
  }

  const campaignAccess = await prisma.userCampaign.findMany({
    where: { userId: user.id },
    select: {
      canViewDashboard: true,
      canViewKPIs: true,
      canViewForms: true,
      canViewEvaluations: true,
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
      canViewAudit: true,
      canViewCoaching: true,
      canManageCoaching: true,
      canTrackQaActivity: true,
      canViewQaActivity: true,
      canViewPips: true,
      canManagePips: true,
    },
  });

  const permissions = { ...NO_CAMPAIGN_PERMISSIONS };
  for (const access of campaignAccess) {
    for (const permission of CAMPAIGN_PERMISSION_KEYS) {
      permissions[permission] = permissions[permission] || access[permission];
    }
  }

  // Export is an effective capability only when both grants coexist on one
  // campaign. Independent OR aggregation could otherwise combine permissions
  // from different campaigns and expose an unusable export entry point.
  permissions.canExport = campaignAccess.some(
    (access) => access.canExport && access.canViewReports,
  );

  const normalizedPermissions = normalizeCampaignPermissionsForRole(user.role, permissions);
  return toUiAccess(false, isSupervisorRole(user.role), normalizedPermissions);
}

export async function hasAnyCampaignPermission(permission: CampaignPermissionKey) {
  const access = await getCurrentUserUiAccess();
  return access.isAdmin || access[permission];
}

export async function hasAnyCampaignPermissions(
  permissions: readonly [CampaignPermissionKey, ...CampaignPermissionKey[]],
) {
  const filter = await getCampaignFilterForPermissions(permissions);
  if (!filter.campaignId || typeof filter.campaignId === "string") return true;
  return filter.campaignId.in.length > 0;
}
