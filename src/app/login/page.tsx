"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, User, Lock, ArrowRight, Loader2 } from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
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

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid credentials");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tno-logo.png"
            alt="TNO"
            className="h-10 w-10 shrink-0 object-contain"
          />
          <span className="text-xl font-bold uppercase tracking-[0.14em] text-[hsl(var(--tno-orange))]">
            Telecom Networks
          </span>
        </div>

        {/* Headline + description */}
        <div className="relative max-w-md space-y-6">
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-white">
            Your quality signal,
            <br />
            <span className="text-white/90">always clear</span>
          </h1>
          <p className="text-base leading-relaxed text-white/60">
            Telecom Networks&apos; QA platform to evaluate agents, track campaign
            performance and power up team coaching — turning every conversation
            into a clearer performance signal.
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
            Built exclusively for Telecom Networks
          </span>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════
         RIGHT PANEL — login form
         ══════════════════════════════════════════════════════════ */}
      <main className="relative flex w-full flex-col lg:w-1/2">
        {/* Theme toggle (top-right) */}
        <div className="absolute right-6 top-6 lg:right-10 lg:top-10">
          <div
            role="radiogroup"
            aria-label="Toggle theme"
            className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-0.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mounted ? isDark : undefined}
              onClick={() => setTheme("dark")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                mounted && isDark
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Moon className="h-3.5 w-3.5" />
              Dark
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mounted ? !isDark : undefined}
              onClick={() => setTheme("light")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                mounted && !isDark
                  ? "bg-[hsl(var(--tno-orange))]/10 text-[hsl(var(--tno-orange))] shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Sun className="h-3.5 w-3.5" />
              Light
            </button>
          </div>
        </div>

        {/* Centered form */}
        <div className="flex flex-1 items-center justify-center px-6 py-20 lg:px-16">
          <div className="w-full max-w-md">
            {/* Heading */}
            <div className="mb-10 text-center">
              <h2 className="font-heading text-4xl font-bold tracking-tight text-foreground">
                {greeting}
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Enter your credentials to access your dashboard.
              </p>
            </div>

            {/* Microsoft SSO button (disabled placeholder — OAuth not yet wired) */}
            <button
              type="button"
              disabled
              title="Coming soon"
              className="group relative flex w-full items-center justify-center gap-3 rounded-full border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-sm transition-all hover:border-foreground/20 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MicrosoftIcon className="h-4 w-4" />
              Sign in with Microsoft
              <span className="absolute right-4 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Soon
              </span>
            </button>

            {/* Divider */}
            <div className="my-7 flex items-center gap-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
                or
              </span>
              <div className="h-px flex-1 bg-border" />
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
                  Username
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
                  Password
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

              {/* Remember + Forgot */}
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-[hsl(var(--tno-orange))] focus:ring-[hsl(var(--tno-orange))]/40"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  className="text-sm font-semibold text-[hsl(var(--tno-orange))] hover:underline"
                  onClick={() =>
                    setError(
                      "Please contact your administrator to reset your password.",
                    )
                  }
                >
                  Forgot password?
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
                    Signing in...
                  </>
                ) : (
                  <>
                    Log in
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            {/* Contact admin footer */}
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <span className="font-semibold text-foreground">
                Contact Administrator
              </span>
            </p>
          </div>
        </div>

        {/* Bottom footer links */}
        <footer className="flex justify-center gap-8 pb-8 text-xs text-muted-foreground">
          <span className="cursor-default hover:text-foreground">Privacy Policy</span>
          <span className="cursor-default hover:text-foreground">Terms of Service</span>
          <span className="cursor-default hover:text-foreground">Network Status</span>
        </footer>
      </main>
    </div>
  );
}

// ─── Microsoft logo SVG ──────────────────────────────────
function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 23 23" className={className} aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}
