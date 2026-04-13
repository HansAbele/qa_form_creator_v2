import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAgentPerformance } from "@/server/queries/analytics";
import { getCampaigns } from "@/server/actions/campaigns";
import { readSettings } from "@/server/actions/settings";
import { AgentPerformanceClient } from "./agents-client";

export default async function AgentPerformancePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [agents, campaigns, settings] = await Promise.all([
    getAgentPerformance(),
    getCampaigns(),
    readSettings(),
  ]);

  return (
    <AgentPerformanceClient
      agents={agents}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      passThreshold={settings.passThreshold}
    />
  );
}
