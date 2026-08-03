"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { type UseFormRegisterReturn, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import {
  type PasswordChangeFormValues,
  passwordChangeFormSchema,
} from "@/lib/profile-form-schemas";
import { completeRequiredPasswordChange } from "@/server/actions/profile";

export function RequiredPasswordChangeForm({ name, email }: { name: string; email: string }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<PasswordChangeFormValues>({
    resolver: zodResolver(passwordChangeFormSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  async function submit(values: PasswordChangeFormValues) {
    setServerError(null);
    try {
      await completeRequiredPasswordChange(values.currentPassword, values.newPassword);
      const { url } = await signOut({ redirect: false, redirectTo: "/login?passwordChanged=1" });
      window.location.assign(url);
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "We couldn't update your password. Try again.",
      );
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[hsl(215,46%,19%)] px-4 py-10">
      <div
        aria-hidden="true"
        className="absolute -left-24 -top-28 size-80 rounded-full bg-orange-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-32 -right-20 size-96 rounded-full bg-orange-400/15 blur-3xl"
      />

      <Card className="relative w-full max-w-lg border-white/15 shadow-2xl">
        <CardHeader className="space-y-5 text-center">
          <div className="mx-auto flex items-center gap-3">
            <Image src="/tno-logo.png" alt="TNO" width={50} height={50} priority />
            <div className="text-left">
              <p className="font-heading text-2xl font-bold tracking-tight">Qore</p>
              <p className="text-xs text-muted-foreground">The core of quality</p>
            </div>
          </div>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
            <LockKeyhole aria-hidden="true" className="size-6" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl">Create your private password</CardTitle>
            <CardDescription className="text-sm leading-6">
              Welcome, {name}. The password provided to you is temporary and can only be used to
              complete this security step.
            </CardDescription>
            <p className="text-xs font-medium text-muted-foreground">{email}</p>
          </div>
        </CardHeader>

        <CardContent>
          <form className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
            <PasswordInput
              id="temporary-password"
              label="Temporary password"
              autoComplete="current-password"
              error={form.formState.errors.currentPassword?.message}
              registration={form.register("currentPassword")}
            />
            <PasswordInput
              id="new-password"
              label="New password"
              autoComplete="new-password"
              error={form.formState.errors.newPassword?.message}
              registration={form.register("newPassword")}
            />
            <PasswordInput
              id="confirm-password"
              label="Confirm new password"
              autoComplete="new-password"
              error={form.formState.errors.confirmPassword?.message}
              registration={form.register("confirmPassword")}
            />

            <div className="flex items-start gap-3 rounded-xl border bg-muted/45 p-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-orange-500" />
              <p>
                Use at least {MIN_PASSWORD_LENGTH} characters and combine uppercase, lowercase,
                numbers, or symbols. Do not reuse a personal password.
              </p>
            </div>

            {serverError && (
              <p
                className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {serverError}
              </p>
            )}

            <Button
              className="w-full"
              size="lg"
              type="submit"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <KeyRound aria-hidden="true" />
              )}
              {form.formState.isSubmitting ? "Updating password..." : "Save password and continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function PasswordInput({
  id,
  label,
  autoComplete,
  error,
  registration,
}: {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  error?: string;
  registration: UseFormRegisterReturn;
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
          {error}
        </p>
      )}
    </div>
  );
}
