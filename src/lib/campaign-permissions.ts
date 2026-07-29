export const CAMPAIGN_PERMISSION_KEYS = [
  "canViewDashboard",
  "canViewKPIs",
  "canViewForms",
  "canViewEvaluations",
  "canCreateForms",
  "canEditForms",
  "canPublishForms",
  "canEvaluate",
  "canEditEvaluations",
  "canViewReports",
  "canExport",
  "canManageAgents",
  "canManageDispositions",
  "canManageCampaignScoring",
  "canViewAudit",
  "canViewCoaching",
  "canManageCoaching",
  "canTrackQaActivity",
  "canViewQaActivity",
  "canViewPips",
  "canManagePips",
] as const;

export type CampaignPermissionKey = (typeof CAMPAIGN_PERMISSION_KEYS)[number];

export type CampaignAccessLevel = "CAMPAIGN_ADMIN" | "EVALUATOR" | "SUPERVISOR";

export type CampaignPermissionState = Record<CampaignPermissionKey, boolean>;
export type AppRole = "ADMIN" | "QA" | "SUPERVISOR";

export const CAMPAIGN_ACCESS_LABELS: Record<CampaignAccessLevel, string> = {
  CAMPAIGN_ADMIN: "Campaign Admin",
  EVALUATOR: "Evaluator",
  SUPERVISOR: "Supervisor",
};

export const CAMPAIGN_PERMISSION_LABELS: Record<CampaignPermissionKey, string> = {
  canViewDashboard: "View Dashboard",
  canViewKPIs: "View KPIs",
  canViewForms: "View forms",
  canViewEvaluations: "View campaign evaluations",
  canCreateForms: "Create forms",
  canEditForms: "Edit forms",
  canPublishForms: "Publish forms",
  canEvaluate: "Evaluate agents",
  canEditEvaluations: "Edit evaluations",
  canViewReports: "View reports",
  canExport: "Export reports",
  canManageAgents: "Manage agents and teams",
  canManageDispositions: "Manage dispositions",
  canManageCampaignScoring: "Manage campaign scoring",
  canViewAudit: "View operational audit",
  canViewCoaching: "View coaching",
  canManageCoaching: "Create and manage coaching",
  canTrackQaActivity: "Track own QA activity",
  canViewQaActivity: "View QA activity analytics",
  canViewPips: "View performance improvement plans",
  canManagePips: "Create and manage performance improvement plans",
};

export const CAMPAIGN_PERMISSION_GROUPS = [
  {
    title: "Read access and analytics",
    keys: ["canViewDashboard", "canViewKPIs", "canViewForms", "canViewReports", "canViewAudit"],
  },
  {
    title: "Forms and evaluations",
    keys: [
      "canCreateForms",
      "canEditForms",
      "canPublishForms",
      "canViewEvaluations",
      "canEvaluate",
      "canEditEvaluations",
      "canViewCoaching",
      "canManageCoaching",
    ],
  },
  {
    title: "Operations and data",
    keys: [
      "canExport",
      "canManageAgents",
      "canManageDispositions",
      "canManageCampaignScoring",
      "canTrackQaActivity",
      "canViewQaActivity",
      "canViewPips",
      "canManagePips",
    ],
  },
] as const satisfies ReadonlyArray<{
  title: string;
  keys: readonly CampaignPermissionKey[];
}>;

export const CAMPAIGN_ACCESS_PRESETS: Record<CampaignAccessLevel, CampaignPermissionState> = {
  CAMPAIGN_ADMIN: {
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
    canManageCampaignScoring: false,
    canViewAudit: true,
    canViewCoaching: true,
    canManageCoaching: true,
    canTrackQaActivity: true,
    canViewQaActivity: true,
    canViewPips: true,
    canManagePips: true,
  },
  EVALUATOR: {
    canViewDashboard: true,
    canViewKPIs: true,
    canViewForms: true,
    canViewEvaluations: true,
    canCreateForms: true,
    canEditForms: true,
    canPublishForms: false,
    canEvaluate: true,
    canEditEvaluations: false,
    canViewReports: true,
    canExport: false,
    canManageAgents: false,
    canManageDispositions: false,
    canManageCampaignScoring: false,
    canViewAudit: false,
    canViewCoaching: true,
    canManageCoaching: true,
    canTrackQaActivity: true,
    canViewQaActivity: false,
    canViewPips: false,
    canManagePips: false,
  },
  SUPERVISOR: {
    canViewDashboard: true,
    canViewKPIs: true,
    canViewForms: true,
    canViewEvaluations: true,
    canCreateForms: false,
    canEditForms: false,
    canPublishForms: false,
    canEvaluate: false,
    canEditEvaluations: false,
    canViewReports: true,
    canExport: false,
    canManageAgents: false,
    canManageDispositions: false,
    canManageCampaignScoring: false,
    canViewAudit: true,
    canViewCoaching: true,
    canManageCoaching: false,
    canTrackQaActivity: false,
    canViewQaActivity: false,
    canViewPips: true,
    canManagePips: false,
  },
};

export const SUPERVISOR_READ_ONLY_PERMISSION_KEYS = [
  "canViewDashboard",
  "canViewKPIs",
  "canViewForms",
  "canViewEvaluations",
  "canViewReports",
  "canViewAudit",
  "canViewCoaching",
  "canViewPips",
] as const satisfies readonly CampaignPermissionKey[];

const SUPERVISOR_READ_ONLY_PERMISSION_SET = new Set<CampaignPermissionKey>(
  SUPERVISOR_READ_ONLY_PERMISSION_KEYS,
);

export function getCampaignAccessPreset(
  roleInCampaign: CampaignAccessLevel,
): CampaignPermissionState {
  return { ...CAMPAIGN_ACCESS_PRESETS[roleInCampaign] };
}

export function isSupervisorRole(role: string | null | undefined): role is "SUPERVISOR" {
  return role === "SUPERVISOR";
}

export function isSupervisorBlockedPermission(permission: CampaignPermissionKey) {
  return !SUPERVISOR_READ_ONLY_PERMISSION_SET.has(permission);
}

export function normalizeCampaignPermissionsForRole(
  role: string | null | undefined,
  permissions: Partial<Record<CampaignPermissionKey, boolean>>,
): CampaignPermissionState {
  return Object.fromEntries(
    CAMPAIGN_PERMISSION_KEYS.map((key) => [
      key,
      isSupervisorRole(role)
        ? !isSupervisorBlockedPermission(key) && Boolean(permissions[key])
        : Boolean(permissions[key]),
    ]),
  ) as CampaignPermissionState;
}

export function getDefaultCampaignAccessForUserRole(role: string | null | undefined) {
  const roleInCampaign: CampaignAccessLevel = isSupervisorRole(role)
    ? "SUPERVISOR"
    : role === "ADMIN"
      ? "CAMPAIGN_ADMIN"
      : "EVALUATOR";

  return {
    roleInCampaign,
    ...getCampaignAccessPreset(roleInCampaign),
  };
}
