import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/server/actions/profile";
import { readSettings } from "@/server/actions/settings";
import { readCampaignScoringSettings } from "@/server/actions/campaign-scoring";
import { readOperationalAudit } from "@/server/actions/audit";
import { readQACategories } from "@/server/actions/qa-categories";
import { getCampaigns } from "@/server/actions/campaigns";
import { getUsers } from "@/server/actions/users";
import { SettingsClient } from "./settings-client";

async function getProfileOrLogin() {
  try {
    return await getMyProfile();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "No autorizado" || error.message === "Usuario no encontrado")
    ) {
      redirect("/login");
    }
    throw error;
  }
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const profile = await getProfileOrLogin();
  const isAdmin = profile.role === "ADMIN";
  const [settings, users, campaigns] = await Promise.all([
    readSettings(),
    isAdmin ? getUsers() : Promise.resolve([]),
    isAdmin ? getCampaigns() : Promise.resolve([]),
  ]);
  const [campaignScoring, auditEvents, qaCategories] = isAdmin
    ? await Promise.all([
        readCampaignScoringSettings(campaigns.map((campaign) => campaign.id)),
        readOperationalAudit(25),
        readQACategories(),
      ])
    : [[], [], []];

  return (
    <SettingsClient
      profile={profile}
      settings={settings}
      isAdmin={isAdmin}
      accessUsers={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        active: u.active,
        campaigns: u.campaigns,
      }))}
      accessCampaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      campaignScoring={campaignScoring}
      auditEvents={auditEvents}
      qaCategories={qaCategories}
    />
  );
}
