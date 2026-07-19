import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PreferencesClient } from "./preferences-client";

export default async function PreferencesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <PreferencesClient />;
}
