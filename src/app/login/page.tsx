"use client";

import { ArrowRight, Languages, Loader2, Lock, Moon, Sun, User } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

// ─── Time-based greeting ─────────────────────────────────
function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 19) return "Good afternoon";
  return "Good evening";
}

export default function LoginPage() {
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { locale, setLocale, isChangingLocale, t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [greeting, setGreeting] = useState("Welcome");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setGreeting(getTimeGreeting());
  }, []);

  const current = mounted ? (theme === "system" ? resolvedTheme : theme) : undefined;
  const isDark = current === "dark";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(t("Invalid email or password."));
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      // Auth.js may reject credentials by throwing instead of returning an
      // error result. Keep the response generic so account existence and
      // rate-limit details are not disclosed from the browser.
      setError(t("Invalid email or password."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* ══════════════════════════════════════════════════════════
         LEFT PANEL — navy brand side
         ══════════════════════════════════════════════════════════ */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-[hsl(215,46%,19%)] p-12 lg:flex">
        {/* Decorative blurs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-[hsl(var(--tno-orange))]/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-[hsl(var(--tno-orange))]/10 blur-3xl"
        />

        {/* Brand header */}
        <div className="relative flex items-center gap-3">
          <Image
            src="/tno-logo.png"
            alt="TNO"
            width={40}
            height={40}
            unoptimized
            className="h-10 w-10 shrink-0 object-contain"
          />
          <span className="text-xl font-bold uppercase tracking-[0.14em] text-[hsl(var(--tno-orange))]">
            Telecom Networks
          </span>
        </div>

        {/* Headline + description */}
        <div className="relative max-w-md space-y-6">
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-white">
            {t("Your quality signal,")}
            <br />
            <span className="text-white/90">{t("always clear")}</span>
          </h1>
          <p className="text-base leading-relaxed text-white/60">
            {t(
              "Telecom Networks' QA platform for evaluating agents, tracking campaign performance, and strengthening team coaching.",
            )}
          </p>
        </div>

        {/* Footer badge */}
        <div className="relative flex items-center gap-3">
          <div className="flex -space-x-1">
            <span className="h-3 w-3 rounded-full bg-slate-700 ring-2 ring-[hsl(215,46%,19%)]" />
            <span className="h-3 w-3 rounded-full bg-[hsl(var(--tno-orange))] ring-2 ring-[hsl(215,46%,19%)]" />
            <span className="h-3 w-3 rounded-full bg-sky-500 ring-2 ring-[hsl(215,46%,19%)]" />
          </div>
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-white/50">
            {t("Built exclusively for Telecom Networks")}
          </span>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════
         RIGHT PANEL — login form
         ══════════════════════════════════════════════════════════ */}
      <main className="relative flex w-full flex-col lg:w-1/2">
        <div className="absolute right-6 top-6 flex items-center gap-2 lg:right-10 lg:top-10">
          <fieldset className="inline-flex min-w-0 items-center gap-0.5 rounded-full border border-border bg-muted p-0.5">
            <legend className="sr-only">{t("Language")}</legend>
            <Languages aria-hidden="true" className="ml-2 size-3.5 text-muted-foreground" />
            {(["en", "es"] as const).map((option) => (
              <button
                key={option}
                type="button"
                disabled={isChangingLocale}
                aria-pressed={locale === option}
                onClick={() => setLocale(option)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold uppercase transition-colors",
                  locale === option
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option}
              </button>
            ))}
          </fieldset>
          <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-0.5">
            <button
              type="button"
              aria-pressed={mounted ? isDark : undefined}
              onClick={() => setTheme("dark")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                mounted && isDark
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Moon className="h-3.5 w-3.5" />
              {t("Dark")}
            </button>
            <button
              type="button"
              aria-pressed={mounted ? !isDark : undefined}
              onClick={() => setTheme("light")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                mounted && !isDark
                  ? "bg-[hsl(var(--tno-orange))]/10 text-[hsl(var(--tno-orange))] shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Sun className="h-3.5 w-3.5" />
              {t("Light")}
            </button>
          </div>
        </div>

        {/* Centered form */}
        <div className="flex flex-1 items-center justify-center px-6 py-20 lg:px-16">
          <div className="w-full max-w-md">
            {/* Heading */}
            <div className="mb-10 text-center">
              <h2 className="font-heading text-4xl font-bold tracking-tight text-foreground">
                {t(greeting)}
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {t("Enter your credentials to access Qore.")}
              </p>
            </div>

            {/* Credentials form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {t("Work email")}
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="w-full rounded-full border border-input bg-muted/50 py-3 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-all focus:border-[hsl(var(--tno-orange))] focus:bg-card focus:outline-none focus:ring-2 focus:ring-[hsl(var(--tno-orange))]/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {t("Password")}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full rounded-full border border-input bg-muted/50 py-3 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-all focus:border-[hsl(var(--tno-orange))] focus:bg-card focus:outline-none focus:ring-2 focus:ring-[hsl(var(--tno-orange))]/20"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-sm font-semibold text-[hsl(var(--tno-orange))] hover:underline"
                  onClick={() => setError(t("Contact your QA Manager to reset your password."))}
                >
                  {t("Forgot password?")}
                </button>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="group relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-[hsl(24,100%,50%)] to-[hsl(18,100%,55%)] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[hsl(var(--tno-orange))]/30 transition-all hover:shadow-xl hover:shadow-[hsl(var(--tno-orange))]/40 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("Signing in...")}
                  </>
                ) : (
                  <>
                    {t("Sign in")}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            {/* Contact admin footer */}
            <p className="mt-8 text-center text-sm text-muted-foreground">
              {t("Need an account?")} {t("Contact your QA Manager.")}
            </p>
          </div>
        </div>

        <footer className="flex justify-center pb-8 text-xs text-muted-foreground">
          <span>Qore · Powered by TNO</span>
        </footer>
      </main>
    </div>
  );
}

// ─── Microsoft logo SVG ──────────────────────────────────
