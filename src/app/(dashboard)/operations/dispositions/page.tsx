import { redirect } from "next/navigation";
import { getDispositionManagementCampaigns } from "@/server/actions/campaigns";
import { getDispositionCategories, getDispositions } from "@/server/actions/dispositions";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { DispositionsClient } from "../../admin/dispositions/dispositions-client";

export default async function OperationsDispositionsPage() {
  const canManageDispositions = await hasAnyCampaignPermission("canManageDispositions");
  if (!canManageDispositions) redirect("/settings");

  const rawCampaigns = await getDispositionManagementCampaigns();
  const campaigns = rawCampaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
  }));

  let dispositions: Awaited<ReturnType<typeof getDispositions>> = [];
  let categories: Awaited<ReturnType<typeof getDispositionCategories>> = [];

  if (campaigns.length > 0) {
    [dispositions, categories] = await Promise.all([
      getDispositions(campaigns[0].id),
      getDispositionCategories(campaigns[0].id),
    ]);
  }

  return (
    <DispositionsClient
      initialDispositions={dispositions}
      initialCategories={categories}
      campaigns={campaigns}
    />
  );
}
