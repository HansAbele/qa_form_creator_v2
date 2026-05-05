import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { TeamDetailClient } from "./team-detail-client";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewKPIs"))) redirect("/settings");

  const { teamId } = await params;

  return <TeamDetailClient teamId={teamId} />;
}
