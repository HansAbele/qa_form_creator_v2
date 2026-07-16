export const CAMPAIGN_PERMISSION_KEYS = [
  "canViewDashboard",
  "canViewKPIs",
  "canViewForms",
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
] as const;

export type CampaignPermissionKey = (typeof CAMPAIGN_PERMISSION_KEYS)[number];

export type CampaignAccessLevel = "CAMPAIGN_ADMIN" | "EVALUATOR" | "SUPERVISOR";

export type CampaignPermissionState = Record<CampaignPermissionKey, boolean>;
export type AppRole = "ADMIN" | "QA" | "SUPERVISOR";

export const CAMPAIGN_ACCESS_LABELS: Record<CampaignAccessLevel, string> = {
  CAMPAIGN_ADMIN: "Admin campaña",
  EVALUATOR: "Evaluador",
  SUPERVISOR: "Supervisor",
};

export const CAMPAIGN_PERMISSION_LABELS: Record<CampaignPermissionKey, string> = {
  canViewDashboard: "Ver Dashboard",
  canViewKPIs: "Ver KPIs",
  canViewForms: "Ver formularios",
  canCreateForms: "Crear formularios",
  canEditForms: "Editar formularios",
  canPublishForms: "Publicar formularios",
  canEvaluate: "Evaluar agentes",
  canEditEvaluations: "Editar evaluaciones",
  canViewReports: "Ver reportes",
  canExport: "Exportar reportes",
  canManageAgents: "Administrar agentes/equipos",
  canManageDispositions: "Administrar disposiciones",
  canManageCampaignScoring: "Administrar scoring campaña",
  canViewAudit: "Ver auditoria operativa",
};

export const CAMPAIGN_ACCESS_PRESETS: Record<CampaignAccessLevel, CampaignPermissionState> = {
  CAMPAIGN_ADMIN: {
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
    canManageCampaignScoring: false,
    canViewAudit: true,
  },
  EVALUATOR: {
    canViewDashboard: true,
    canViewKPIs: false,
    canViewForms: true,
    canCreateForms: false,
    canEditForms: false,
    canPublishForms: false,
    canEvaluate: true,
    canEditEvaluations: false,
    canViewReports: false,
    canExport: false,
    canManageAgents: false,
    canManageDispositions: false,
    canManageCampaignScoring: false,
    canViewAudit: false,
  },
  SUPERVISOR: {
    canViewDashboard: true,
    canViewKPIs: true,
    canViewForms: true,
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
  },
};

export const SUPERVISOR_READ_ONLY_PERMISSION_KEYS = [
  "canViewDashboard",
  "canViewKPIs",
  "canViewForms",
  "canViewReports",
  "canViewAudit",
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
