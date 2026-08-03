import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolvePreferredCampaignId, resolveWorkspaceDateRange } from "@/lib/workspace-preferences";
import { getExportCampaigns } from "@/server/actions/campaigns";
import { getFormsForExport } from "@/server/actions/forms";
import { readMyWorkspacePreferences } from "@/server/actions/workspace-preferences";
import { hasAnyCampaignPermissions } from "@/server/queries/ui-access";
import { ExportClient } from "./export-client";

export default async function ExportDataPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermissions(["canExport", "canViewReports"]))) {
    redirect("/settings");
  }

  const [campaigns, forms, workspace] = await Promise.all([
    getExportCampaigns(),
    getFormsForExport(),
    readMyWorkspacePreferences(),
  ]);
  const initialCampaignId = resolvePreferredCampaignId(workspace.preferences, campaigns);
  const initialDates = resolveWorkspaceDateRange(workspace.preferences.defaultDateRange);

  return (
    <ExportClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      forms={forms.map((f) => ({ id: f.id, title: f.title, campaignId: f.campaignId }))}
      initialCampaignId={initialCampaignId}
      initialDateFrom={initialDates.dateFrom}
      initialDateTo={initialDates.dateTo}
    />
  );
}
