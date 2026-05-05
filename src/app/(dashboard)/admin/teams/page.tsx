import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getTeams } from "@/server/actions/teams";
import { getCampaigns } from "@/server/actions/campaigns";
import { TeamsClient } from "./teams-client";

export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const [rawTeams, rawCampaigns] = await Promise.all([
    getTeams(),
    getCampaigns(),
  ]);

  const teams = rawTeams.map((t) => ({
    id: t.id,
    name: t.name,
    campaignId: t.campaignId,
    campaignName: t.campaign.name,
    agentCount: t._count.agents,
  }));

  const campaigns = rawCampaigns.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return <TeamsClient teams={teams} campaigns={campaigns} />;
}
