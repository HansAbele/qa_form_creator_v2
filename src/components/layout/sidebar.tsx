"use client";

import {
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  Menu,
  PhoneCall,
  Settings,
  Tags,
  Target,
  UserCog,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { useI18n } from "@/components/providers/i18n-provider";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { UiAccess } from "@/server/queries/ui-access";
import { useAppStore } from "@/stores/app-store";

type NavigationItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isVisible: (access: UiAccess) => boolean;
};

type NavigationSection = {
  label: string;
  items: NavigationItem[];
};

const primaryItems: NavigationItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    isVisible: (access: UiAccess) => access.canViewDashboard,
  },
  {
    href: "/forms",
    label: "Forms",
    icon: FileText,
    isVisible: (access: UiAccess) => access.canViewForms,
  },
  {
    href: "/call-finder",
    label: "Call Finder",
    icon: PhoneCall,
    isVisible: (access: UiAccess) => access.canEvaluate,
  },
  {
    href: "/evaluations",
    label: "Evaluations",
    icon: ClipboardCheck,
    isVisible: (access: UiAccess) =>
      access.canViewDashboard || access.canViewEvaluations || access.canViewReports,
  },
  {
    href: "/performance",
    label: "Performance Management",
    icon: HeartHandshake,
    isVisible: (access: UiAccess) =>
      access.canViewCoaching ||
      access.canManageCoaching ||
      access.canTrackQaActivity ||
      access.canViewQaActivity ||
      access.canViewPips ||
      access.canManagePips,
  },
  {
    href: "/reports",
    label: "Reports",
    icon: BarChart3,
    isVisible: (access: UiAccess) => access.canViewReports,
  },
];

const analyticsItems: NavigationItem[] = [
  {
    href: "/kpis",
    label: "KPIs",
    icon: Target,
    isVisible: (access: UiAccess) => access.canViewKPIs,
  },
  {
    href: "/analytics/agents",
    label: "Agents",
    icon: Users,
    isVisible: (access: UiAccess) => access.canViewKPIs,
  },
  {
    href: "/analytics/teams",
    label: "Teams",
    icon: Building2,
    isVisible: (access: UiAccess) => access.canViewKPIs,
  },
  {
    href: "/analytics/dispositions",
    label: "Dispositions",
    icon: Tags,
    isVisible: (access: UiAccess) => access.canViewKPIs,
  },
];

const configurationItems: NavigationItem[] = [
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    isVisible: (access: UiAccess) => access.canOpenSettings,
  },
];

const adminItems: NavigationItem[] = [
  {
    href: "/admin/users",
    label: "Users",
    icon: UserCog,
    isVisible: (access: UiAccess) => access.isAdmin,
  },
  {
    href: "/admin/campaigns",
    label: "Campaigns",
    icon: Building2,
    isVisible: (access: UiAccess) => access.isAdmin,
  },
];

const operationsItems: NavigationItem[] = [
  {
    href: "/operations/agents",
    label: "Manage agents",
    icon: Users,
    isVisible: (access: UiAccess) => access.canManageAgents,
  },
  {
    href: "/operations/teams",
    label: "Manage teams",
    icon: Building2,
    isVisible: (access: UiAccess) => access.canManageAgents,
  },
  {
    href: "/operations/dispositions",
    label: "Manage dispositions",
    icon: Tags,
    isVisible: (access: UiAccess) => access.canManageDispositions,
  },
];

const navigationSections: NavigationSection[] = [
  { label: "Workspace", items: primaryItems },
  { label: "Performance", items: analyticsItems },
  { label: "Operations", items: operationsItems },
  { label: "Administration", items: adminItems },
  { label: "Settings", items: configurationItems },
];

function isPathActive(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationLink({
  item,
  expanded,
  pathname,
  onNavigate,
}: {
  item: NavigationItem;
  expanded: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  const isActive = isPathActive(pathname, item.href);
  const { t } = useI18n();
  const label = t(item.label);

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring motion-reduce:transition-none",
        isActive
          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
      title={!expanded ? label : undefined}
      onClick={onNavigate}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary-foreground"
        />
      )}
      <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
      <span className={cn(!expanded && "sr-only")}>{label}</span>
    </Link>
  );
}

function NavigationSectionLabel({
  children,
  expanded,
  id,
}: {
  children: string;
  expanded: boolean;
  id: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50",
        !expanded && "sr-only",
      )}
    >
      {children}
    </h2>
  );
}

function SidebarNavigation({
  access,
  expanded,
  id,
  onNavigate,
}: {
  access: UiAccess;
  expanded: boolean;
  id?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const visibleSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.isVisible(access)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <nav
      id={id}
      aria-label={t("Primary navigation")}
      className="flex-1 space-y-1 overflow-y-auto p-3"
    >
      {visibleSections.map((section, index) => {
        const sectionLabelId = `${id ?? "mobile-primary-navigation"}-section-${index}`;

        return (
          <section key={section.label} aria-labelledby={sectionLabelId}>
            {index > 0 && (
              <div aria-hidden="true" className="my-3 border-t border-sidebar-border" />
            )}
            <NavigationSectionLabel id={sectionLabelId} expanded={expanded}>
              {t(section.label)}
            </NavigationSectionLabel>
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavigationLink
                  key={item.href}
                  item={item}
                  expanded={expanded}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        );
      })}
    </nav>
  );
}

export function Sidebar({ access }: { access: UiAccess }) {
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const { t } = useI18n();

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 self-start flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 motion-reduce:transition-none md:flex",
        sidebarOpen ? "w-64" : "w-16",
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-3">
        {sidebarOpen ? (
          <Logo
            size="md"
            showText
            className="text-sidebar-foreground"
            textClassName="text-sidebar-foreground"
          />
        ) : (
          <Logo size="sm" showText={false} className="mx-auto" />
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-controls="desktop-primary-navigation"
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? t("Collapse sidebar") : t("Expand sidebar")}
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring motion-reduce:transition-none"
        >
          {sidebarOpen ? (
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          ) : (
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
      </div>

      <SidebarNavigation access={access} expanded={sidebarOpen} id="desktop-primary-navigation" />

      {sidebarOpen && (
        <div className="border-t border-sidebar-border px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-sidebar-foreground/50">
            Powered by <span className="text-[hsl(var(--tno-orange))]">TNO</span>
          </p>
        </div>
      )}
    </aside>
  );
}

export function MobileSidebar({ access }: { access: UiAccess }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        type="button"
        aria-label={t("Open main menu")}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "md:hidden")}
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(20rem,calc(100vw-2rem))] gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:max-w-80"
      >
        <SheetHeader className="h-16 justify-center border-b border-sidebar-border px-4 py-0">
          <SheetTitle className="sr-only">{t("Main menu")}</SheetTitle>
          <Logo
            size="md"
            showText
            className="text-sidebar-foreground"
            textClassName="text-sidebar-foreground"
          />
        </SheetHeader>
        <SidebarNavigation access={access} expanded onNavigate={() => setOpen(false)} />
        <div className="border-t border-sidebar-border px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-sidebar-foreground/50">
            Powered by <span className="text-[hsl(var(--tno-orange))]">TNO</span>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
