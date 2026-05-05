import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { readSettings } from "@/server/actions/settings";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { TeamsAnalyticsClient } from "./teams-analytics-client";

export default async function TeamsAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewKPIs"))) redirect("/settings");

  const settings = await readSettings();

  return <TeamsAnalyticsClient settings={settings} />;
}
