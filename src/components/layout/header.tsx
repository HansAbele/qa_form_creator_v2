"use client";

import { ChevronDown, Loader2, LogOut, Settings2, UserRound } from "lucide-react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";
import { toast } from "sonner";
import { MobileSidebar } from "@/components/layout/sidebar";
import { useI18n } from "@/components/providers/i18n-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { permitNextDocumentUnload, requestAppNavigation } from "@/lib/navigation-guard";
import type { UiAccess } from "@/server/queries/ui-access";

function getUserInitials(name: string | null | undefined, email: string | null | undefined) {
  const source = name?.trim() || email?.split("@")[0]?.trim() || "User";
  const words = source.split(/\s+/).filter(Boolean);

  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase("en");
  return `${words[0][0]}${words.at(-1)?.[0] ?? ""}`.toLocaleUpperCase("en");
}

export function Header({ access }: { access: UiAccess }) {
  const { data: session } = useSession();
  const { t } = useI18n();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const roleLabel =
    session?.user.role === "ADMIN"
      ? "QA Manager"
      : session?.user.role === "SUPERVISOR"
        ? "Supervisor"
        : "Quality Analyst";
  const userName = session?.user.name?.trim() || session?.user.email || t("User");
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
      toast.error(t("We couldn't sign you out. Try again."));
    }
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3 sm:px-4 md:px-6">
      <MobileSidebar access={access} />

      {session?.user && (
        <div className="ml-auto flex min-w-0 items-center">
          <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              aria-label={`${t("Open user menu")}: ${userName}`}
              className="group flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
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
                <span className="block truncate text-xs text-muted-foreground">{t(roleLabel)}</span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-popup-open:rotate-180 motion-reduce:transition-none sm:block"
              />
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden p-0"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="bg-sidebar p-4 font-normal text-sidebar-foreground">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar size="lg" className="bg-orange-100 dark:bg-orange-950">
                      {session.user.image && <AvatarImage src={session.user.image} alt="" />}
                      <AvatarFallback className="bg-orange-100 font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-sidebar-foreground">
                        {userName}
                      </p>
                      <p className="truncate text-xs text-sidebar-foreground/75">{t(roleLabel)}</p>
                      {session.user.email && (
                        <p className="truncate text-xs text-sidebar-foreground/60">
                          {session.user.email}
                        </p>
                      )}
                    </div>
                  </div>
                </DropdownMenuLabel>
                <div className="p-1">
                  <DropdownMenuItem
                    render={
                      <Link
                        href="/account"
                        onNavigate={(event) => {
                          if (!requestAppNavigation()) event.preventDefault();
                        }}
                      />
                    }
                    nativeButton={false}
                    className="min-h-11 gap-3 px-3 py-2"
                  >
                    <UserRound aria-hidden="true" />
                    <span>
                      <span className="block font-medium">{t("My account")}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t("Profile and security")}
                      </span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={
                      <Link
                        href="/preferences"
                        onNavigate={(event) => {
                          if (!requestAppNavigation()) event.preventDefault();
                        }}
                      />
                    }
                    nativeButton={false}
                    className="min-h-11 gap-3 px-3 py-2"
                  >
                    <Settings2 aria-hidden="true" />
                    <span>
                      <span className="block font-medium">{t("Preferences")}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t("Appearance and language")}
                      </span>
                    </span>
                  </DropdownMenuItem>
                </div>
              </DropdownMenuGroup>

              <div className="border-t p-1">
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isSigningOut}
                  onClick={() => void handleSignOut()}
                  className="min-h-11 gap-3 px-3 py-2"
                >
                  {isSigningOut ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <LogOut aria-hidden="true" />
                  )}
                  {isSigningOut ? t("Signing out…") : t("Sign out")}
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </header>
  );
}
