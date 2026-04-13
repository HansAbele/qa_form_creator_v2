import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTeamDetail } from "@/server/queries/analytics";
import { TeamDetailClient } from "./team-detail-client";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { teamId } = await params;
  const data = await getTeamDetail(teamId);

  return <TeamDetailClient data={data} />;
}
