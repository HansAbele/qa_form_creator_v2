"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { cn } from "@/lib/utils";
import { permitNextDocumentUnload, requestAppNavigation } from "@/lib/navigation-guard";

export function Header() {
  const { data: session } = useSession();
  const { theme, resolvedTheme, setTheme } = useTheme();

  // Avoid hydration mismatch: render toggle only after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted ? (theme === "system" ? resolvedTheme : theme) : undefined;
  const isDark = current === "dark";
  const roleLabel =
    session?.user.role === "ADMIN"
      ? "QA Manager"
      : session?.user.role === "SUPERVISOR"
        ? "Supervisor"
        : "QA";

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div />

      <div className="flex items-center gap-4">
        {/* Horizontal segmented theme switcher */}
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5">
          <button
            type="button"
            aria-pressed={mounted ? !isDark : undefined}
            onClick={() => setTheme("light")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-semibold transition-colors",
              mounted && !isDark
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Sun className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Claro</span>
          </button>
          <button
            type="button"
            aria-pressed={mounted ? isDark : undefined}
            onClick={() => setTheme("dark")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-semibold transition-colors",
              mounted && isDark
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Moon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Oscuro</span>
          </button>
        </div>

        {session?.user && (
          <div className="flex items-center gap-3">
            <NotificationCenter />
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{session.user.name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!requestAppNavigation()) return;
                const { url } = await signOut({ redirect: false, redirectTo: "/login" });
                permitNextDocumentUnload();
                window.location.assign(url);
              }}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
