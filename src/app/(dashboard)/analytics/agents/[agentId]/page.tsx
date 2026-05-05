import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { AgentDetailClient } from "./agent-detail-client";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewKPIs"))) redirect("/settings");

  const { agentId } = await params;

  return <AgentDetailClient agentId={agentId} />;
}
