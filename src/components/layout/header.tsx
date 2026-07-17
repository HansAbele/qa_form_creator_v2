"use client";

import { ChevronDown, Loader2, LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";
import { toast } from "sonner";
import { MobileSidebar } from "@/components/layout/sidebar";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { permitNextDocumentUnload, requestAppNavigation } from "@/lib/navigation-guard";
import type { UiAccess } from "@/server/queries/ui-access";

type UserTheme = "light" | "dark" | "system";

function getUserInitials(name: string | null | undefined, email: string | null | undefined) {
  const source = name?.trim() || email?.split("@")[0]?.trim() || "Usuario";
  const words = source.split(/\s+/).filter(Boolean);

  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase("es");
  return `${words[0][0]}${words.at(-1)?.[0] ?? ""}`.toLocaleUpperCase("es");
}

export function Header({ access }: { access: UiAccess }) {
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const roleLabel =
    session?.user.role === "ADMIN"
      ? "QA Manager"
      : session?.user.role === "SUPERVISOR"
        ? "Supervisor"
        : "QA";
  const userName = session?.user.name?.trim() || session?.user.email || "Usuario";
  const initials = getUserInitials(session?.user.name, session?.user.email);

  async function handleSignOut() {
    if (isSigningOut || !requestAppNavigation()) return;

    setIsSigningOut(true);
    try {
      const { url } = await signOut({ redirect: false, redirectTo: "/login" });
      permitNextDocumentUnload();
      window.location.assign(url);
    } catch {
      setIsSigningOut(false);
      toast.error("No se pudo cerrar la sesión. Inténtalo de nuevo.");
    }
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3 sm:px-4 md:px-6">
      <MobileSidebar access={access} />

      {session?.user && (
        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          <NotificationCenter />

          <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              aria-label={`Abrir menú de usuario: ${userName}`}
              className="group flex min-h-10 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <Avatar className="bg-orange-100 dark:bg-orange-950">
                {session.user.image && <AvatarImage src={session.user.image} alt="" />}
                <AvatarFallback className="bg-orange-100 font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden min-w-0 max-w-40 sm:block">
                <span className="block truncate text-sm font-medium text-foreground">
                  {userName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-popup-open:rotate-180 motion-reduce:transition-none sm:block"
              />
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-72 max-w-[calc(100vw-1.5rem)]"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="p-2 font-normal">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar size="lg" className="bg-orange-100 dark:bg-orange-950">
                      {session.user.image && <AvatarImage src={session.user.image} alt="" />}
                      <AvatarFallback className="bg-orange-100 font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
                      <p className="truncate text-xs text-muted-foreground">Rol: {roleLabel}</p>
                      {session.user.email && (
                        <p className="truncate text-xs text-muted-foreground">
                          {session.user.email}
                        </p>
                      )}
                    </div>
                  </div>
                </DropdownMenuLabel>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  render={
                    <Link
                      href="/settings?section=account"
                      onNavigate={(event) => {
                        if (!requestAppNavigation()) event.preventDefault();
                      }}
                    />
                  }
                  nativeButton={false}
                  className="min-h-10 gap-2 px-2 py-2"
                >
                  <UserRound aria-hidden="true" />
                  <span>
                    <span className="block font-medium">Mi perfil</span>
                    <span className="block text-xs text-muted-foreground">Cuenta y seguridad</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => setTheme(value as UserTheme)}
              >
                <DropdownMenuLabel className="px-2 pb-1 pt-1.5">
                  Preferencias de apariencia
                </DropdownMenuLabel>
                <DropdownMenuRadioItem
                  value="light"
                  closeOnClick={false}
                  className="min-h-9 gap-2 px-2 py-2"
                >
                  <Sun aria-hidden="true" />
                  Claro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="dark"
                  closeOnClick={false}
                  className="min-h-9 gap-2 px-2 py-2"
                >
                  <Moon aria-hidden="true" />
                  Oscuro
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="system"
                  closeOnClick={false}
                  className="min-h-9 gap-2 px-2 py-2"
                >
                  <Monitor aria-hidden="true" />
                  Sistema
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
                className="min-h-10 gap-2 px-2 py-2"
              >
                {isSigningOut ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <LogOut aria-hidden="true" />
                )}
                {isSigningOut ? "Cerrando sesión..." : "Cerrar sesión"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </header>
  );
}
