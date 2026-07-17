"use client";

import {
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  LayoutDashboard,
  Menu,
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
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { UiAccess } from "@/server/queries/ui-access";
import { useAppStore } from "@/stores/app-store";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    isVisible: (access: UiAccess) => access.canViewDashboard,
  },
  {
    href: "/forms",
    label: "Formularios",
    icon: FileText,
    isVisible: (access: UiAccess) => access.canViewForms,
  },
  {
    href: "/reports",
    label: "Reports",
    icon: BarChart3,
    isVisible: (access: UiAccess) => access.canViewReports,
  },
  {
    href: "/kpis",
    label: "KPIs",
    icon: Target,
    isVisible: (access: UiAccess) => access.canViewKPIs,
  },
  {
    href: "/analytics/agents",
    label: "Agentes",
    icon: Users,
    isVisible: (access: UiAccess) => access.canViewKPIs,
  },
  {
    href: "/analytics/export",
    label: "Exportar",
    icon: Download,
    isVisible: (access: UiAccess) => access.canExport,
  },
  {
    href: "/settings",
    label: "Configuracion",
    icon: Settings,
    isVisible: (access: UiAccess) => access.canOpenSettings,
  },
];

const adminItems = [
  { href: "/admin/users", label: "Usuarios", icon: UserCog },
  { href: "/admin/campaigns", label: "Campanas", icon: Building2 },
];

const operationsItems = [
  {
    href: "/operations/agents",
    label: "Agentes",
    icon: Users,
    isVisible: (access: UiAccess) => access.canManageAgents,
  },
  {
    href: "/operations/teams",
    label: "Equipos",
    icon: Building2,
    isVisible: (access: UiAccess) => access.canManageAgents,
  },
  {
    href: "/operations/dispositions",
    label: "Disposiciones",
    icon: Tags,
    isVisible: (access: UiAccess) => access.canManageDispositions,
  },
];

type NavigationItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
};

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
      title={!expanded ? item.label : undefined}
      onClick={onNavigate}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary-foreground"
        />
      )}
      <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
      <span className={cn(!expanded && "sr-only")}>{item.label}</span>
    </Link>
  );
}

function NavigationSectionLabel({ children, expanded }: { children: string; expanded: boolean }) {
  return (
    <p
      className={cn(
        "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50",
        !expanded && "sr-only",
      )}
    >
      {children}
    </p>
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
  const visibleNavItems = navItems.filter((item) => item.isVisible(access));
  const visibleOperationsItems = operationsItems.filter((item) => item.isVisible(access));

  return (
    <nav id={id} aria-label="Navegación principal" className="flex-1 space-y-1 overflow-y-auto p-3">
      {visibleNavItems.map((item) => (
        <NavigationLink
          key={item.href}
          item={item}
          expanded={expanded}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      ))}

      {visibleOperationsItems.length > 0 && (
        <div>
          <div aria-hidden="true" className="my-3 border-t border-sidebar-border" />
          <NavigationSectionLabel expanded={expanded}>Operación</NavigationSectionLabel>
          <div className="space-y-1">
            {visibleOperationsItems.map((item) => (
              <NavigationLink
                key={item.href}
                item={item}
                expanded={expanded}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}

      {access.isAdmin && (
        <div>
          <div aria-hidden="true" className="my-3 border-t border-sidebar-border" />
          <NavigationSectionLabel expanded={expanded}>Administración</NavigationSectionLabel>
          <div className="space-y-1">
            {adminItems.map((item) => (
              <NavigationLink
                key={item.href}
                item={item}
                expanded={expanded}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

export function Sidebar({ access }: { access: UiAccess }) {
  const { sidebarOpen, toggleSidebar } = useAppStore();

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
          aria-label={sidebarOpen ? "Colapsar sidebar" : "Expandir sidebar"}
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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        type="button"
        aria-label="Abrir menú principal"
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "md:hidden")}
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(20rem,calc(100vw-2rem))] gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:max-w-80"
      >
        <SheetHeader className="h-16 justify-center border-b border-sidebar-border px-4 py-0">
          <SheetTitle className="sr-only">Menú principal</SheetTitle>
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
