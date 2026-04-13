import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/server/actions/profile";
import { readSettings } from "@/server/actions/settings";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [profile, settings] = await Promise.all([
    getMyProfile(),
    readSettings(),
  ]);

  const isAdmin = session.user.role === "ADMIN";

  return (
    <SettingsClient
      profile={profile}
      settings={settings}
      isAdmin={isAdmin}
    />
  );
}
