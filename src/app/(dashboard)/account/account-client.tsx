"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Building2,
  CalendarDays,
  Info,
  KeyRound,
  Loader2,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { type UseFormRegisterReturn, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ProfileNavigation } from "@/components/account/profile-navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getInitials } from "@/lib/avatar";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import {
  type PasswordChangeFormValues,
  type ProfileNameFormValues,
  passwordChangeFormSchema,
  profileNameSchema,
} from "@/lib/profile-form-schemas";
import { changeMyPassword, type ProfileInfo, updateMyName } from "@/server/actions/profile";

function roleLabel(role: ProfileInfo["role"]) {
  if (role === "ADMIN") return "QA Manager";
  if (role === "SUPERVISOR") return "Supervisor";
  if (role === "AGENT") return "Agent";
  return "Quality Analyst";
}

function actionErrorMessage(error: unknown, fallback: string, t: (message: string) => string) {
  if (!(error instanceof Error)) return t(fallback);

  const message = error.message.toLocaleLowerCase();
  if (
    message.includes("actual es incorrecta") ||
    message.includes("current password is incorrect")
  ) {
    return t("Current password is incorrect.");
  }
  if (message.includes("sesion") || message.includes("session")) {
    return t("Your session changed. Sign in again.");
  }
  if (message.includes("externo") || message.includes("external identity")) {
    return t("This account uses an external identity provider and has no local password.");
  }
  return t(fallback);
}

export function AccountClient({ profile }: { profile: ProfileInfo }) {
  const router = useRouter();
  const { update } = useSession();
  const { locale, t } = useI18n();
  const initials = getInitials(profile.name || profile.email);

  const profileForm = useForm<ProfileNameFormValues>({
    resolver: zodResolver(profileNameSchema),
    defaultValues: { name: profile.name },
  });
  const passwordForm = useForm<PasswordChangeFormValues>({
    resolver: zodResolver(passwordChangeFormSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  async function saveProfile(values: ProfileNameFormValues) {
    try {
      await updateMyName(values.name);
      profileForm.reset({ name: values.name });
      await update();
      router.refresh();
      toast.success(t("Profile updated."));
    } catch (error) {
      toast.error(actionErrorMessage(error, "We couldn't update your profile. Try again.", t));
    }
  }

  async function savePassword(values: PasswordChangeFormValues) {
    try {
      await changeMyPassword(values.currentPassword, values.newPassword);
      passwordForm.reset();
      toast.success(t("Password updated. Sign in again with your new password."));
      const { url } = await signOut({ redirect: false, redirectTo: "/login" });
      window.location.assign(url);
    } catch (error) {
      toast.error(actionErrorMessage(error, "We couldn't update your password. Try again.", t));
    }
  }

  const joined = new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(profile.createdAt));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <UserRound aria-hidden="true" className="size-6 text-orange-500" />
          <h1 className="font-heading text-3xl font-bold tracking-tight">{t("My account")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("Manage your profile and account security.")}
        </p>
      </header>

      <ProfileNavigation />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Profile")}</CardTitle>
            <CardDescription>
              {t("Your identity and campaign assignments in Qore.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4 rounded-xl border bg-muted/35 p-4">
              <Avatar className="size-14 bg-orange-100 dark:bg-orange-950">
                <AvatarFallback className="bg-orange-100 text-lg font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{profile.name}</p>
                <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
                <Badge variant="secondary" className="mt-2">
                  {t(roleLabel(profile.role))}
                </Badge>
              </div>
            </div>

            <form className="space-y-4" onSubmit={profileForm.handleSubmit(saveProfile)} noValidate>
              <div className="space-y-2">
                <Label htmlFor="account-name">{t("Full name")}</Label>
                <Input
                  id="account-name"
                  autoComplete="name"
                  aria-invalid={Boolean(profileForm.formState.errors.name)}
                  {...profileForm.register("name")}
                />
                {profileForm.formState.errors.name && (
                  <p className="text-xs text-destructive" role="alert">
                    {t(profileForm.formState.errors.name.message ?? "Invalid full name.")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="account-email">{t("Email")}</Label>
                <Input id="account-email" value={profile.email} readOnly disabled />
                <p className="text-xs text-muted-foreground">
                  {t("Contact a QA Manager to change your sign-in email.")}
                </p>
              </div>

              <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
                <div className="flex items-start gap-2">
                  <Building2 aria-hidden="true" className="mt-0.5 size-4 text-orange-500" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("Campaigns")}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {profile.role === "ADMIN" ? (
                        <span className="text-sm font-medium">{t("All campaigns")}</span>
                      ) : profile.campaigns.length > 0 ? (
                        profile.campaigns.map((campaign) => (
                          <Badge key={campaign.id} variant="outline">
                            {campaign.name}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {t("No assigned campaigns")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <CalendarDays aria-hidden="true" className="mt-0.5 size-4 text-orange-500" />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("Member since")}
                    </p>
                    <p className="mt-1 text-sm font-medium">{joined}</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="lg"
                  disabled={!profileForm.formState.isDirty || profileForm.formState.isSubmitting}
                >
                  {profileForm.formState.isSubmitting ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Save aria-hidden="true" />
                  )}
                  {profileForm.formState.isSubmitting ? t("Saving...") : t("Save changes")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound aria-hidden="true" className="size-4 text-orange-500" />
              {t("Change password")}
            </CardTitle>
            <CardDescription>
              {t("Use a unique password that you do not use for other services.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!profile.hasPassword ? (
              <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <p>
                  {t("This account uses an external identity provider and has no local password.")}
                </p>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={passwordForm.handleSubmit(savePassword)}
                noValidate
              >
                <PasswordField
                  id="current-password"
                  label={t("Current password")}
                  autoComplete="current-password"
                  error={passwordForm.formState.errors.currentPassword?.message}
                  registration={passwordForm.register("currentPassword")}
                  t={t}
                />
                <PasswordField
                  id="new-password"
                  label={t("New password")}
                  autoComplete="new-password"
                  error={passwordForm.formState.errors.newPassword?.message}
                  registration={passwordForm.register("newPassword")}
                  t={t}
                />
                <PasswordField
                  id="confirm-password"
                  label={t("Confirm new password")}
                  autoComplete="new-password"
                  error={passwordForm.formState.errors.confirmPassword?.message}
                  registration={passwordForm.register("confirmPassword")}
                  t={t}
                />

                <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                  <ShieldCheck
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-orange-500"
                  />
                  <p>
                    {t(
                      "Use at least {count} characters and three of these types: uppercase, lowercase, numbers, and symbols.",
                      { count: MIN_PASSWORD_LENGTH },
                    )}
                  </p>
                </div>

                <div className="flex justify-end pt-1">
                  <Button type="submit" size="lg" disabled={passwordForm.formState.isSubmitting}>
                    {passwordForm.formState.isSubmitting ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <KeyRound aria-hidden="true" />
                    )}
                    {passwordForm.formState.isSubmitting ? t("Updating...") : t("Update password")}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  error,
  registration,
  t,
}: {
  id: string;
  label: string;
  autoComplete: string;
  error?: string;
  registration: UseFormRegisterReturn;
  t: (message: string) => string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        {...registration}
      />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
