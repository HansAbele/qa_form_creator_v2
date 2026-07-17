import { redirect } from "next/navigation";

export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ responseId: string }>;
}) {
  const { responseId } = await params;
  redirect(`/evaluations/${encodeURIComponent(responseId)}`);
}
