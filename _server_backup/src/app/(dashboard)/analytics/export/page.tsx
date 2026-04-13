import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCampaigns } from "@/server/actions/campaigns";
import { getForms } from "@/server/actions/forms";
import { ExportClient } from "./export-client";

export default async function ExportDataPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [campaigns, forms] = await Promise.all([getCampaigns(), getForms()]);

  return (
    <ExportClient
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      forms={forms.map((f) => ({ id: f.id, title: f.title, campaignId: f.campaignId }))}
    />
  );
}
