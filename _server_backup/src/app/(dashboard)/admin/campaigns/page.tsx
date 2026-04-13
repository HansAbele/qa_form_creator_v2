import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCampaigns } from "@/server/actions/campaigns";
import { CampaignsClient } from "./campaigns-client";

export default async function AdminCampaignsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const campaigns = await getCampaigns();

  return (
    <CampaignsClient
      campaigns={campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        active: c.active,
        userCount: c._count.users,
        formCount: c._count.forms,
        agentCount: c._count.agents,
      }))}
    />
  );
}
