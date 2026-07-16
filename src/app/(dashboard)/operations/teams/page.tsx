import { redirect } from "next/navigation";
import { getAgentManagementCampaigns } from "@/server/actions/campaigns";
import { getTeamsForManagement } from "@/server/actions/teams";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { TeamsClient } from "../../admin/teams/teams-client";

export default async function OperationsTeamsPage() {
  const canManageAgents = await hasAnyCampaignPermission("canManageAgents");
  if (!canManageAgents) redirect("/settings");

  const [rawTeams, rawCampaigns] = await Promise.all([
    getTeamsForManagement(),
    getAgentManagementCampaigns(),
  ]);

  const teams = rawTeams.map((team) => ({
    id: team.id,
    name: team.name,
    campaignId: team.campaignId,
    campaignName: team.campaign.name,
    agentCount: team._count.agents,
  }));

  const campaigns = rawCampaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
  }));

  return <TeamsClient teams={teams} campaigns={campaigns} />;
}
