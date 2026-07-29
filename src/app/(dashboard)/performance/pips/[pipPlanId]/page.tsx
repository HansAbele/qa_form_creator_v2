import { notFound } from "next/navigation";
import { getPipCaseDetail } from "@/server/queries/performance-case-detail";
import { PerformanceAuthorizationError } from "@/server/queries/performance-access";
import { PipCaseClient } from "../../performance-case-client";

export default async function PipCasePage({ params }: { params: Promise<{ pipPlanId: string }> }) {
  const { pipPlanId } = await params;
  try {
    const data = await getPipCaseDetail(pipPlanId);
    return <PipCaseClient data={data} />;
  } catch (error) {
    if (error instanceof PerformanceAuthorizationError) notFound();
    throw error;
  }
}
