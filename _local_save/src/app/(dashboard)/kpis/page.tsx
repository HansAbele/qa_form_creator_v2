import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { readSettings } from "@/server/actions/settings";
import { KpisClient } from "./kpis-client";

export default async function KpisPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const settings = await readSettings();

  return <KpisClient settings={settings} />;
}
