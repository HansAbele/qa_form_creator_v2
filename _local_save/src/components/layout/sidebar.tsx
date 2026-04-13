"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard,
  FileText,
  BarChart3,
  Users,
  Target,
  Download,
  Building2,
  UserCog,
  Settings,
  ChevronLeft,
  ChevronRight,
  UsersRound,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { Logo } from "@/components/brand/logo";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/forms", label: "Formularios", icon: FileText },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/kpis", label: "KPIs", icon: Target },
  { href: "/analytics/agents", label: "Agentes", icon: Users },
  { href: "/analytics/teams", label: "Equipos", icon: UsersRound },
  { href: "/analytics/dispositions", label: "Disposiciones", icon: Tag },
  { href: "/analytics/export", label: "Exportar", icon: Download },
  { href: "/settings", label: "Configuración", icon: Settings },
];

const adminItems = [
  { href: "/admin/users", label: "Usuarios", icon: UserCog },
  { href: "/admin/campaigns", label: "Campañas", icon: Building2 },
  { href: "/admin/agents", label: "Agentes", icon: Users },
  { href: "/admin/teams", label: "Equipos", icon: UsersRound },
  { href: "/admin/dispositions", label: "Disposiciones", icon: Tag },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300",
        sidebarOpen ? "w-64" : "w-16",
      )}
    >
      {/* Brand header */}
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
          onClick={toggleSidebar}
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          aria-label={sidebarOpen ? "Colapsar sidebar" : "Expandir sidebar"}
        >
          {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
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
              {/* Orange accent bar on active */}
              {isActive && (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[hsl(var(--tno-orange))]" />
              )}
              <item.icon className="h-5 w-5 shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <div className="my-3 border-t border-sidebar-border" />
            {sidebarOpen && (
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
                Administración
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

      {/* Footer brand stripe */}
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
