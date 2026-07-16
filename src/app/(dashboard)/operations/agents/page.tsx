import { redirect } from "next/navigation";
import { getAgentsForManagement } from "@/server/actions/agents";
import { getAgentManagementCampaigns } from "@/server/actions/campaigns";
import { getTeamsForManagement } from "@/server/actions/teams";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { AgentsClient } from "../../admin/agents/agents-client";

export default async function OperationsAgentsPage() {
  const canManageAgents = await hasAnyCampaignPermission("canManageAgents");
  if (!canManageAgents) redirect("/settings");

  const [agents, campaigns, teams] = await Promise.all([
    getAgentsForManagement(),
    getAgentManagementCampaigns(),
    getTeamsForManagement(),
  ]);

  return (
    <AgentsClient
      agents={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        agentCode: agent.agentCode,
        campaignId: agent.campaignId,
        campaignName: agent.campaign.name,
        teamId: agent.teamId,
        teamName: agent.team?.name ?? null,
        active: agent.active,
        responseCount: agent._count.responses,
      }))}
      campaigns={campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
      }))}
      teams={teams.map((team) => ({
        id: team.id,
        name: team.name,
        campaignId: team.campaignId,
      }))}
    />
  );
}
