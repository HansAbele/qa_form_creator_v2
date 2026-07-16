import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getReportCampaigns } from "@/server/actions/campaigns";
import { getFormsForReports } from "@/server/actions/forms";
import { getDispositionsForReports } from "@/server/actions/dispositions";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";
import { ReportsClient } from "./reports-client";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const access = await getCurrentUserUiAccess();
  if (!access.canViewReports) redirect("/settings");

  const [campaigns, forms, dispositions] = await Promise.all([
    getReportCampaigns(),
    getFormsForReports(),
    getDispositionsForReports(),
  ]);

  return (
    <ReportsClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      forms={forms.map((f) => ({ id: f.id, title: f.title, campaignId: f.campaignId }))}
      dispositions={dispositions.map((disposition) => ({
        id: disposition.id,
        name: disposition.name,
        campaignId: disposition.campaignId,
        campaignName: disposition.campaign.name,
      }))}
      canExport={access.canExport}
    />
  );
}
