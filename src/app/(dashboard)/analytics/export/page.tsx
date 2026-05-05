import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCampaignsForPermission } from "@/server/actions/campaigns";
import { getFormsForPermission } from "@/server/actions/forms";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { ExportClient } from "./export-client";

export default async function ExportDataPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canExport"))) redirect("/settings");

  const [campaigns, forms] = await Promise.all([
    getCampaignsForPermission("canExport"),
    getFormsForPermission("canExport"),
  ]);

  return (
    <ExportClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      forms={forms.map((f) => ({ id: f.id, title: f.title, campaignId: f.campaignId }))}
    />
  );
}
