import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolvePreferredCampaignId, resolveWorkspaceDateRange } from "@/lib/workspace-preferences";
import { getReportCampaigns } from "@/server/actions/campaigns";
import { getFormsForReports } from "@/server/actions/forms";
import { readMyWorkspacePreferences } from "@/server/actions/workspace-preferences";
import { getCurrentUserUiAccess, hasAnyCampaignPermissions } from "@/server/queries/ui-access";
import { ReportsClient } from "./reports-client";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const access = await getCurrentUserUiAccess();
  if (!access.canViewReports) redirect("/settings");
  const canExport = await hasAnyCampaignPermissions(["canExport", "canViewReports"]);

  const [campaigns, forms, workspace] = await Promise.all([
    getReportCampaigns(),
    getFormsForReports(),
    readMyWorkspacePreferences(),
  ]);
  const initialCampaignId = resolvePreferredCampaignId(workspace.preferences, campaigns);
  const initialDates = resolveWorkspaceDateRange(workspace.preferences.defaultDateRange);

  return (
    <ReportsClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      forms={forms.map((f) => ({ id: f.id, title: f.title, campaignId: f.campaignId }))}
      canExport={canExport}
      initialCampaignId={initialCampaignId}
      initialDateFrom={initialDates.dateFrom}
      initialDateTo={initialDates.dateTo}
    />
  );
}
