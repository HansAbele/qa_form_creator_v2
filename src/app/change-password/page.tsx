import { redirect } from "next/navigation";
import { authForPasswordChange } from "@/lib/auth";
import { RequiredPasswordChangeForm } from "./required-password-change-form";

export default async function ChangePasswordPage() {
  const session = await authForPasswordChange();
  if (!session?.user) redirect("/login");
  if (!session.user.mustChangePassword) redirect("/");

  return (
    <RequiredPasswordChangeForm
      name={session.user.name ?? "Qore user"}
      email={session.user.email ?? ""}
    />
  );
}
