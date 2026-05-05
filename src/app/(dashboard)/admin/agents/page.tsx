import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAgents } from "@/server/actions/agents";
import { getCampaigns } from "@/server/actions/campaigns";
import { getTeams } from "@/server/actions/teams";
import { AgentsClient } from "./agents-client";

export default async function AdminAgentsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const [agents, campaigns, teams] = await Promise.all([
    getAgents(),
    getCampaigns(),
    getTeams(),
  ]);

  return (
    <AgentsClient
      agents={agents.map((a) => ({
        id: a.id,
        name: a.name,
        agentCode: a.agentCode,
        campaignId: a.campaignId,
        campaignName: a.campaign.name,
        teamId: a.teamId,
        teamName: a.team?.name ?? null,
        active: a.active,
        responseCount: a._count.responses,
      }))}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      teams={teams.map((t) => ({
        id: t.id,
        name: t.name,
        campaignId: t.campaignId,
      }))}
    />
  );
}
