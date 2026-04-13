import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getEvaluatorDetail } from "@/server/queries/analytics";
import { EvaluatorDetailClient } from "./evaluator-detail-client";

export default async function EvaluatorDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { userId } = await params;
  const data = await getEvaluatorDetail(userId);

  return <EvaluatorDetailClient data={data} />;
}
