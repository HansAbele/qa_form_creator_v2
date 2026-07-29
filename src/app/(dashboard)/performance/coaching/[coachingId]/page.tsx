import { notFound } from "next/navigation";
import { getCoachingCaseDetail } from "@/server/queries/performance-case-detail";
import { PerformanceAuthorizationError } from "@/server/queries/performance-access";
import { CoachingCaseClient } from "../../performance-case-client";

export default async function CoachingCasePage({
  params,
}: {
  params: Promise<{ coachingId: string }>;
}) {
  const { coachingId } = await params;
  try {
    const data = await getCoachingCaseDetail(coachingId);
    return <CoachingCaseClient data={data} />;
  } catch (error) {
    if (error instanceof PerformanceAuthorizationError) notFound();
    throw error;
  }
}
