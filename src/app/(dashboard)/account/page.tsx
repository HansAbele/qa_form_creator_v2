import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMyProfile } from "@/server/actions/profile";
import { AccountClient } from "./account-client";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const profile = await getMyProfile();
  return <AccountClient profile={profile} />;
}
