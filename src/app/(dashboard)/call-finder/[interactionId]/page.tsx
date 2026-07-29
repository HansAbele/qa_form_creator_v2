import { notFound } from "next/navigation";
import { getCallFinderInteractionDetail } from "@/server/queries/call-finder";
import { CallDetailClient } from "./call-detail-client";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ interactionId: string }>;
}) {
  const { interactionId } = await params;
  const interaction = await getCallFinderInteractionDetail(interactionId);
  if (!interaction) notFound();

  return <CallDetailClient interaction={interaction} />;
}
