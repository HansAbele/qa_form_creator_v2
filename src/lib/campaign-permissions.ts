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
] as const;

export type CampaignPermissionKey = (typeof CAMPAIGN_PERMISSION_KEYS)[number];

export type CampaignAccessLevel =
  | "CAMPAIGN_ADMIN"
  | "EVALUATOR"
  | "SUPERVISOR";

export type CampaignPermissionState = Record<CampaignPermissionKey, boolean>;

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
};

export const CAMPAIGN_ACCESS_PRESETS: Record<
  CampaignAccessLevel,
  CampaignPermissionState
> = {
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
  },
  EVALUATOR: {
    canViewDashboard: true,
    canViewKPIs: true,
    canViewForms: true,
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
  },
};

export function getCampaignAccessPreset(
  roleInCampaign: CampaignAccessLevel,
): CampaignPermissionState {
  return { ...CAMPAIGN_ACCESS_PRESETS[roleInCampaign] };
}
