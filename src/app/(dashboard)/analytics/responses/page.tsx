import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { readSettings } from "@/server/actions/settings";
import { getCampaignsForPermission } from "@/server/actions/campaigns";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { ResponsesListClient } from "./responses-list-client";

export default async function ResponsesListPage({
  searchParams,
}: {
  searchParams: Promise<{
    minScore?: string;
    maxScore?: string;
    campaignId?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewReports"))) redirect("/settings");

  const [settings, campaigns, sp] = await Promise.all([
    readSettings(),
    getCampaignsForPermission("canViewReports"),
    searchParams,
  ]);

  return (
    <ResponsesListClient
      settings={settings}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      initialMinScore={sp.minScore}
      initialMaxScore={sp.maxScore}
      initialCampaignId={sp.campaignId}
      initialDateFrom={sp.dateFrom}
      initialDateTo={sp.dateTo}
    />
  );
}
