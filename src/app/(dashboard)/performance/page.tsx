import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveWorkspaceDateRange } from "@/lib/workspace-preferences";
import { readMyWorkspacePreferences } from "@/server/actions/workspace-preferences";
import {
  getPerformanceWorkspace,
  type PerformanceSearchParams,
  parsePerformanceFilters,
} from "@/server/queries/performance-management";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";
import { PerformanceClient } from "./performance-client";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<PerformanceSearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const access = await getCurrentUserUiAccess();
  const canOpenPerformance =
    access.canViewCoaching ||
    access.canManageCoaching ||
    access.canTrackQaActivity ||
    access.canViewQaActivity ||
    access.canViewPips ||
    access.canManagePips;

  if (!canOpenPerformance) redirect("/");

  const parsedFilters = parsePerformanceFilters(await searchParams);
  const workspace = session.user.role === "AGENT" ? null : await readMyWorkspacePreferences();
  const preferredDates = workspace
    ? resolveWorkspaceDateRange(workspace.preferences.defaultDateRange)
    : {};
  const hasExplicitPeriod = Boolean(parsedFilters.from || parsedFilters.to);
  const filters = {
    ...parsedFilters,
    from: hasExplicitPeriod ? parsedFilters.from : preferredDates.dateFrom,
    to: hasExplicitPeriod ? parsedFilters.to : preferredDates.dateTo,
  };
  const data = await getPerformanceWorkspace(filters);
  const preferredCampaignId = workspace?.preferences.defaultCampaignId;
  const campaigns = preferredCampaignId
    ? [...data.campaigns].sort((left, right) => {
        if (left.id === preferredCampaignId) return -1;
        if (right.id === preferredCampaignId) return 1;
        return left.name.localeCompare(right.name);
      })
    : data.campaigns;
  return <PerformanceClient data={{ ...data, campaigns }} />;
}
