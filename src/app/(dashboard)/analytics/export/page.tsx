import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getExportCampaigns } from "@/server/actions/campaigns";
import { getFormsForExport } from "@/server/actions/forms";
import { hasAnyCampaignPermissions } from "@/server/queries/ui-access";
import { ExportClient } from "./export-client";

export default async function ExportDataPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermissions(["canExport", "canViewReports"]))) {
    redirect("/settings");
  }

  const [campaigns, forms] = await Promise.all([getExportCampaigns(), getFormsForExport()]);

  return (
    <ExportClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      forms={forms.map((f) => ({ id: f.id, title: f.title, campaignId: f.campaignId }))}
    />
  );
}
