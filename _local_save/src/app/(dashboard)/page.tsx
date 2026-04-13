import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { readSettings } from "@/server/actions/settings";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const settings = await readSettings();

  return (
    <DashboardClient
      userName={session.user.name ?? "Usuario"}
      settings={settings}
    />
  );
}
