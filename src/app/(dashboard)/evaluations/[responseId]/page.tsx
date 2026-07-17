import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";
import { ResponseDetailClient } from "../../analytics/responses/[responseId]/response-detail-client";

export default async function EvaluationDetailPage({
  params,
}: {
  params: Promise<{ responseId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const access = await getCurrentUserUiAccess();
  if (
    !access.isAdmin &&
    !access.canViewDashboard &&
    !access.canViewReports &&
    !access.canEditEvaluations &&
    !access.canViewAudit
  ) {
    redirect("/settings");
  }

  const { responseId } = await params;
  return <ResponseDetailClient responseId={responseId} />;
}
