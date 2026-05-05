import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { DispositionDetailClient } from "./disposition-detail-client";

export default async function DispositionDetailPage({
  params,
}: {
  params: Promise<{ dispositionId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewKPIs"))) redirect("/settings");

  const { dispositionId } = await params;

  return <DispositionDetailClient dispositionId={dispositionId} />;
}
