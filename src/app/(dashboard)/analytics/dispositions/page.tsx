import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { readSettings } from "@/server/actions/settings";
import { DispositionsAnalyticsClient } from "./dispositions-analytics-client";

export default async function DispositionsAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const settings = await readSettings();

  return <DispositionsAnalyticsClient settings={settings} />;
}
