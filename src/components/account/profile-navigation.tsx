"use client";

import { Settings2, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const items = [
  { href: "/account", label: "My account", icon: UserRound },
  { href: "/preferences", label: "Preferences", icon: Settings2 },
] as const;

export function ProfileNavigation() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("Account settings")}
      className="inline-flex w-full flex-wrap gap-1 rounded-xl bg-muted p-1 sm:w-auto"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: "ghost", size: "lg" }),
              "min-w-36 flex-1 justify-start gap-2 px-4 sm:flex-none",
              active && "bg-background text-foreground shadow-sm hover:bg-background",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}
