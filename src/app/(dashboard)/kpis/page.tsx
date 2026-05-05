import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { readSettings } from "@/server/actions/settings";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { KpisClient } from "./kpis-client";

export default async function KpisPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewKPIs"))) redirect("/settings");

  const settings = await readSettings();

  return <KpisClient settings={settings} />;
}
