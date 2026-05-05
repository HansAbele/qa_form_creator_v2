import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { DispositionsAnalyticsClient } from "./dispositions-analytics-client";

export default async function DispositionsAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewKPIs"))) redirect("/settings");

  return <DispositionsAnalyticsClient />;
}
