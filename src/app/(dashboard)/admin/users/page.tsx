import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUsers } from "@/server/actions/users";
import { getCampaigns } from "@/server/actions/campaigns";
import { UsersClient } from "./users-client";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const [users, campaigns] = await Promise.all([getUsers(), getCampaigns()]);

  return (
    <UsersClient
      users={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        active: u.active,
        campaigns: u.campaigns,
      }))}
      campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
