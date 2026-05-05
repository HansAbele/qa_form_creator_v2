import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { ResponseDetailClient } from "./response-detail-client";

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ responseId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewReports"))) redirect("/settings");

  const { responseId } = await params;

  return <ResponseDetailClient responseId={responseId} />;
}
