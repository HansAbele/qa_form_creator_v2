import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAgentPerformance } from "@/server/queries/analytics";
import { getCampaignsForPermission } from "@/server/actions/campaigns";
import { readSettings } from "@/server/actions/settings";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { AgentPerformanceClient } from "./agents-client";

export default async function AgentPerformancePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewKPIs"))) redirect("/settings");

  const [agents, campaigns, settings] = await Promise.all([
    getAgentPerformance(),
    getCampaignsForPermission("canViewKPIs"),
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
