"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

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

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div />

      <div className="flex items-center gap-4">
        {/* Horizontal segmented theme switcher */}
        <div
          role="radiogroup"
          aria-label="Cambiar tema"
          className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mounted ? !isDark : undefined}
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
            role="radio"
            aria-checked={mounted ? isDark : undefined}
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
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{session.user.name}</p>
              <p className="text-xs text-muted-foreground">
                {session.user.role === "ADMIN" ? "QA Manager" : "QA"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
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
