"use client";

import { LogOut, Moon, Sun } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { MobileSidebar } from "@/components/layout/sidebar";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { useTheme } from "@/components/theme-provider";
import { permitNextDocumentUnload, requestAppNavigation } from "@/lib/navigation-guard";
import { cn } from "@/lib/utils";
import type { UiAccess } from "@/server/queries/ui-access";

export function Header({ access }: { access: UiAccess }) {
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3 sm:px-4 md:px-6">
      <MobileSidebar access={access} />

      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        <fieldset className="m-0 inline-flex min-w-0 items-center gap-0.5 rounded-md border border-border bg-muted p-0.5">
          <legend className="sr-only">Tema de la interfaz</legend>
          <button
            type="button"
            aria-label="Usar tema claro"
            aria-pressed={mounted ? !isDark : undefined}
            title="Tema claro"
            onClick={() => setTheme("light")}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:px-2.5",
              mounted && !isDark
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Sun aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Claro</span>
          </button>
          <button
            type="button"
            aria-label="Usar tema oscuro"
            aria-pressed={mounted ? isDark : undefined}
            title="Tema oscuro"
            onClick={() => setTheme("dark")}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:px-2.5",
              mounted && isDark
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Moon aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Oscuro</span>
          </button>
        </fieldset>

        {session?.user && (
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <NotificationCenter />
            <div className="hidden min-w-0 max-w-48 text-right lg:block">
              <p className="truncate text-sm font-medium text-foreground">{session.user.name}</p>
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
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
