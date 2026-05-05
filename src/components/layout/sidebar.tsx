"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  LayoutDashboard,
  Settings,
  Target,
  UserCog,
  Users,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import type { UiAccess } from "@/server/queries/ui-access";

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
  { href: "/admin/agents", label: "Agentes", icon: Users },
];

export function Sidebar({ access }: { access: UiAccess }) {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const visibleNavItems = navItems.filter((item) => item.isVisible(access));

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300",
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
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label={sidebarOpen ? "Colapsar sidebar" : "Expandir sidebar"}
        >
          {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
              title={!sidebarOpen ? item.label : undefined}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[hsl(var(--tno-orange))]" />
              )}
              <item.icon className="h-5 w-5 shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </Link>
          );
        })}

        {access.isAdmin && (
          <>
            <div className="my-3 border-t border-sidebar-border" />
            {sidebarOpen && (
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
                Administracion
              </p>
            )}
            {adminItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[hsl(var(--tno-orange))]" />
                  )}
                  <item.icon className="h-5 w-5 shrink-0" />
                  {sidebarOpen && <span>{item.label}</span>}
                </Link>
              );
            })}
          </>
        )}
      </nav>

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
