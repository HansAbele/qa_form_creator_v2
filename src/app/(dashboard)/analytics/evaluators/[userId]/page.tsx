import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { EvaluatorDetailClient } from "./evaluator-detail-client";

export default async function EvaluatorDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewKPIs"))) redirect("/settings");

  const { userId } = await params;

  return <EvaluatorDetailClient userId={userId} />;
}
