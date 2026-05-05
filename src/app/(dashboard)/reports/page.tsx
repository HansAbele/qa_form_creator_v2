import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCampaignsForPermission } from "@/server/actions/campaigns";
import { getFormsForPermission } from "@/server/actions/forms";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { ReportsClient } from "./reports-client";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewReports"))) redirect("/settings");

  const [campaigns, forms] = await Promise.all([
    getCampaignsForPermission("canViewReports"),
    getFormsForPermission("canViewReports"),
  ]);

  return (
    <ReportsClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      forms={forms.map((f) => ({ id: f.id, title: f.title, campaignId: f.campaignId }))}
    />
  );
}
