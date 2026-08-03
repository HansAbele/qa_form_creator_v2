import { addDateOnlyDays, toOperationalDateKey } from "@/lib/operational-time";

export const WORKSPACE_DATE_RANGES = [
  "ALL_TIME",
  "TODAY",
  "LAST_7_DAYS",
  "LAST_14_DAYS",
  "LAST_30_DAYS",
] as const;

export const EVALUATION_WORKSPACE_SCOPES = ["OWN", "MANAGED"] as const;

export type WorkspaceDateRange = (typeof WORKSPACE_DATE_RANGES)[number];
export type EvaluationWorkspaceScope = (typeof EVALUATION_WORKSPACE_SCOPES)[number];

export type WorkspacePreferences = {
  defaultCampaignId: string | null;
  defaultDateRange: WorkspaceDateRange;
  defaultEvaluationScope: EvaluationWorkspaceScope;
};

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  defaultCampaignId: null,
  defaultDateRange: "ALL_TIME",
  defaultEvaluationScope: "MANAGED",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeWorkspacePreferences(value: unknown): WorkspacePreferences {
  if (!isRecord(value)) return { ...DEFAULT_WORKSPACE_PREFERENCES };

  const defaultCampaignId =
    typeof value.defaultCampaignId === "string" && value.defaultCampaignId.trim()
      ? value.defaultCampaignId.trim()
      : null;
  const defaultDateRange = WORKSPACE_DATE_RANGES.includes(
    value.defaultDateRange as WorkspaceDateRange,
  )
    ? (value.defaultDateRange as WorkspaceDateRange)
    : DEFAULT_WORKSPACE_PREFERENCES.defaultDateRange;
  const defaultEvaluationScope = EVALUATION_WORKSPACE_SCOPES.includes(
    value.defaultEvaluationScope as EvaluationWorkspaceScope,
  )
    ? (value.defaultEvaluationScope as EvaluationWorkspaceScope)
    : DEFAULT_WORKSPACE_PREFERENCES.defaultEvaluationScope;

  return { defaultCampaignId, defaultDateRange, defaultEvaluationScope };
}

export function resolvePreferredCampaignId(
  preferences: WorkspacePreferences,
  campaigns: readonly { id: string }[],
) {
  if (campaigns.length === 1) return campaigns[0]?.id;
  return campaigns.some((campaign) => campaign.id === preferences.defaultCampaignId)
    ? (preferences.defaultCampaignId ?? undefined)
    : undefined;
}

export function resolveWorkspaceDateRange(
  range: WorkspaceDateRange,
  now = new Date(),
): { dateFrom?: string; dateTo?: string } {
  if (range === "ALL_TIME") return {};

  const dateTo = toOperationalDateKey(now);
  const days =
    range === "TODAY" ? 1 : range === "LAST_7_DAYS" ? 7 : range === "LAST_14_DAYS" ? 14 : 30;

  return { dateFrom: addDateOnlyDays(dateTo, -(days - 1)), dateTo };
}
