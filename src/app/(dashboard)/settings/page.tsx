import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/server/actions/profile";
import { readSettings } from "@/server/actions/settings";
import { getCampaigns } from "@/server/actions/campaigns";
import { getUsers } from "@/server/actions/users";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  const [profile, settings, users, campaigns] = await Promise.all([
    getMyProfile(),
    readSettings(),
    isAdmin ? getUsers() : Promise.resolve([]),
    isAdmin ? getCampaigns() : Promise.resolve([]),
  ]);

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
    />
  );
}
