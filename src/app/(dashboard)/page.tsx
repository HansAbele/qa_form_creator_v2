import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { readSettings } from "@/server/actions/settings";
import { getCampaignsForPermission } from "@/server/actions/campaigns";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const access = await getCurrentUserUiAccess();
  if (!access.canViewDashboard) redirect("/settings");

  const [settings, campaigns] = await Promise.all([
    readSettings(),
    getCampaignsForPermission("canViewDashboard"),
  ]);

  return (
    <DashboardClient
      userName={session.user.name ?? "Usuario"}
      settings={settings}
      access={access}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
