import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDispositions, getDispositionCategories } from "@/server/actions/dispositions";
import { getCampaigns } from "@/server/actions/campaigns";
import { DispositionsClient } from "./dispositions-client";

export default async function DispositionsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const rawCampaigns = await getCampaigns();
  const campaigns = rawCampaigns.map((c) => ({ id: c.id, name: c.name }));

  // Load dispositions for first campaign (or empty)
  let dispositions: Awaited<ReturnType<typeof getDispositions>> = [];
  let categories: Awaited<ReturnType<typeof getDispositionCategories>> = [];

  if (campaigns.length > 0) {
    [dispositions, categories] = await Promise.all([
      getDispositions(campaigns[0].id),
      getDispositionCategories(campaigns[0].id),
    ]);
  }

  return (
    <DispositionsClient
      initialDispositions={dispositions}
      initialCategories={categories}
      campaigns={campaigns}
    />
  );
}
