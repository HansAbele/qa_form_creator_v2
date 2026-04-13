import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAgentDetail } from "@/server/queries/analytics";
import { AgentDetailClient } from "./agent-detail-client";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { agentId } = await params;
  const data = await getAgentDetail(agentId);

  return <AgentDetailClient data={data} />;
}
