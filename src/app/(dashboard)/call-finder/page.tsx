import { redirect } from "next/navigation";
import { resolvePreferredCampaignId, resolveWorkspaceDateRange } from "@/lib/workspace-preferences";
import { readMyWorkspacePreferences } from "@/server/actions/workspace-preferences";
import {
  type CallFinderSearchParams,
  getCallFinderCampaignOptions,
  getCallFinderPageData,
  parseCallFinderFilters,
} from "@/server/queries/call-finder";
import { getCurrentUserUiAccess, hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { CallFinderClient } from "./call-finder-client";

export default async function CallFinderPage({
  searchParams,
}: {
  searchParams: Promise<CallFinderSearchParams>;
}) {
  if (!(await hasAnyCampaignPermission("canEvaluate"))) redirect("/forms");

  const [query, access, workspace, campaigns] = await Promise.all([
    searchParams,
    getCurrentUserUiAccess(),
    readMyWorkspacePreferences(),
    getCallFinderCampaignOptions(),
  ]);
  const parsedFilters = parseCallFinderFilters(query);
  const preferredCampaignId = resolvePreferredCampaignId(workspace.preferences, campaigns);
  const preferredDates = resolveWorkspaceDateRange(workspace.preferences.defaultDateRange);
  const hasExplicitPeriod = Boolean(parsedFilters.dateFrom || parsedFilters.dateTo);
  const filters = {
    ...parsedFilters,
    campaignId: parsedFilters.campaignId ?? preferredCampaignId,
    dateFrom: hasExplicitPeriod ? parsedFilters.dateFrom : preferredDates.dateFrom,
    dateTo: hasExplicitPeriod ? parsedFilters.dateTo : preferredDates.dateTo,
  };
  const data = await getCallFinderPageData(filters);
  return <CallFinderClient data={data} canSyncCalls={access.isAdmin} />;
}
