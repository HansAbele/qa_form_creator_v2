import { auth } from "@/lib/auth";

type CampaignFilter = { campaignId?: { in: string[] } };

export async function getCampaignFilter(): Promise<CampaignFilter> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role === "ADMIN") return {};
  return { campaignId: { in: session.user.campaignIds } };
}
