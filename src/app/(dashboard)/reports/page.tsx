import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getReportCampaigns } from "@/server/actions/campaigns";
import { getFormsForReports } from "@/server/actions/forms";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { ReportsClient } from "./reports-client";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewReports"))) redirect("/settings");

  const [campaigns, forms] = await Promise.all([
    getReportCampaigns(),
    getFormsForReports(),
  ]);

  return (
    <ReportsClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      forms={forms.map((f) => ({ id: f.id, title: f.title, campaignId: f.campaignId }))}
    />
  );
}
