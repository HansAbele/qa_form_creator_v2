import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUsers } from "@/server/actions/users";
import { getCampaigns } from "@/server/actions/campaigns";
import { getAgents } from "@/server/actions/agents";
import { UsersClient } from "./users-client";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const [users, campaigns, agents] = await Promise.all([getUsers(), getCampaigns(), getAgents()]);

  return (
    <UsersClient
      users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        active: u.active,
        agentProfile: u.agentProfile,
        campaigns: u.campaigns,
      }))}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      agents={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        agentCode: agent.agentCode,
        campaignId: agent.campaignId,
        campaignName: agent.campaign.name,
        active: agent.active,
        userId: agent.userId,
      }))}
    />
  );
}
