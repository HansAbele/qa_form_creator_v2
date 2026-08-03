import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getServerI18n } from "@/lib/i18n-server";
import { resolvePreferredCampaignId, resolveWorkspaceDateRange } from "@/lib/workspace-preferences";
import { getDashboardCampaigns, getKpiCampaigns } from "@/server/actions/campaigns";
import { readMyWorkspacePreferences } from "@/server/actions/workspace-preferences";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const access = await getCurrentUserUiAccess();
  const { t } = await getServerI18n();
  if (access.isAgent) redirect("/performance");
  if (!access.canViewDashboard) redirect("/settings");

  // A mixed evaluator/manager account receives program analytics only for
  // campaigns where KPI access was granted explicitly.
  const isManager = access.isAdmin || access.canViewKPIs;
  const [campaigns, workspace] = await Promise.all([
    isManager ? getKpiCampaigns() : getDashboardCampaigns(),
    readMyWorkspacePreferences(),
  ]);
  const initialCampaignId = resolvePreferredCampaignId(workspace.preferences, campaigns);
  const initialDates = resolveWorkspaceDateRange(workspace.preferences.defaultDateRange);

  return (
    <DashboardClient
      userName={session.user.name ?? t("User")}
      access={access}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      viewMode={isManager ? "manager" : "evaluator"}
      initialCampaignId={initialCampaignId}
      initialDateFrom={initialDates.dateFrom}
      initialDateTo={initialDates.dateTo}
    />
  );
}
