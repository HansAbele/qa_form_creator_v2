"use client";

import {
  Archive,
  Bell,
  CheckCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { requestAppNavigation } from "@/lib/navigation-guard";
import { LatestRequestGuard } from "@/lib/latest-request";
import { cn } from "@/lib/utils";
import {
  archiveNotification,
  getMyNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "@/server/actions/notifications";

const severityClasses: Record<string, string> = {
  CRITICAL: "border-destructive/30 bg-destructive/10 text-destructive",
  WARNING: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  SUCCESS: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  INFO: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
};

function getNotificationIcon(type: string, severity: string) {
  if (severity === "CRITICAL" || type === "fatal_evaluation") {
    return <ShieldAlert className="h-4 w-4" />;
  }
  if (type === "coaching_opportunity" || type === "campaign_risk") {
    return <TrendingDown className="h-4 w-4" />;
  }
  return <Bell className="h-4 w-4" />;
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMinutes < 1) return "Ahora";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

export function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [isPending, startTransition] = useTransition();
  const requestGuard = useRef(new LatestRequestGuard()).current;
  const isMounted = useRef(false);

  const unreadLabel = useMemo(() => {
    if (unreadCount > 9) return "9+";
    return String(unreadCount);
  }, [unreadCount]);
  const triggerLabel =
    loadStatus === "error"
      ? "Notificaciones, no disponibles"
      : loadStatus === "loading"
        ? "Notificaciones, cargando"
        : unreadCount === 0
          ? "Notificaciones, ninguna sin leer"
          : `Notificaciones, ${unreadCount} sin leer`;

  const refresh = useCallback(
    async (showLoading = true) => {
      const requestId = requestGuard.begin();
      if (showLoading) setLoadStatus("loading");

      try {
        const [notifications, count] = await Promise.all([
          getMyNotifications(12),
          getUnreadNotificationCount(),
        ]);
        if (!isMounted.current || !requestGuard.isCurrent(requestId)) return;
        setItems(notifications);
        setUnreadCount(count);
        setLoadStatus("success");
      } catch {
        if (!isMounted.current || !requestGuard.isCurrent(requestId)) return;
        setLoadStatus("error");
      }
    },
    [requestGuard],
  );

  useEffect(() => {
    isMounted.current = true;
    void refresh();
    return () => {
      isMounted.current = false;
      requestGuard.invalidate();
    };
  }, [refresh, requestGuard]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const runMutation = (
    mutation: () => Promise<void>,
    feedback: { success: string; error: string },
  ) => {
    startTransition(async () => {
      try {
        await mutation();
        toast.success(feedback.success);
        if (isMounted.current) await refresh(false);
      } catch {
        toast.error(feedback.error);
      }
    });
  };

  const openNotification = (item: NotificationItem) => {
    if (item.href && !requestAppNavigation()) return;
    runMutation(() => markNotificationRead(item.id), {
      success: "Notificación marcada como leída",
      error: "No se pudo marcar la notificación como leída",
    });
    if (item.href) {
      setOpen(false);
      router.push(item.href);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
        aria-label={triggerLabel}
      >
        <Bell aria-hidden="true" className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="-top-1 -right-1 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground leading-none"
          >
            {unreadLabel}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[calc(100vw-2rem)] max-w-[360px] gap-0 p-0"
      >
        <PopoverHeader className="border-b px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>Notificaciones</PopoverTitle>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isPending || unreadCount === 0}
              onClick={() =>
                runMutation(markAllNotificationsRead, {
                  success: "Todas las notificaciones se marcaron como leídas",
                  error: "No se pudieron marcar las notificaciones como leídas",
                })
              }
            >
              <CheckCheck aria-hidden="true" className="h-3.5 w-3.5" />
              Marcar todas como leídas
            </Button>
          </div>
        </PopoverHeader>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {loadStatus === "loading" ? (
            <div
              role="status"
              className="flex h-28 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Cargando notificaciones...
            </div>
          ) : loadStatus === "error" ? (
            <div
              role="alert"
              className="flex min-h-28 flex-col items-center justify-center gap-2 px-4 text-center text-sm"
            >
              <p className="text-muted-foreground">No fue posible cargar las notificaciones.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                Reintentar
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
              Sin notificaciones
            </div>
          ) : (
            <div className="space-y-1.5">
              {items.map((item) => {
                const isUnread = !item.readAt;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-md border p-2 transition-colors",
                      isUnread ? "bg-muted/60" : "bg-background",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 rounded-md border p-1",
                          severityClasses[item.severity] ?? severityClasses.INFO,
                        )}
                      >
                        {getNotificationIcon(item.type, item.severity)}
                      </div>
                      <button
                        type="button"
                        disabled={isPending}
                        className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openNotification(item)}
                      >
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          {isUnread && (
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-primary"
                            />
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {item.body}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <time dateTime={item.createdAt}>{formatRelativeDate(item.createdAt)}</time>
                          {item.campaignName && (
                            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                              {item.campaignName}
                            </Badge>
                          )}
                        </div>
                      </button>
                      <div className="flex flex-col gap-1">
                        {item.href && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={isPending}
                            onClick={() => openNotification(item)}
                            aria-label={`Abrir notificación: ${item.title}`}
                          >
                            <ExternalLink aria-hidden="true" className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={isPending}
                          onClick={() =>
                            runMutation(() => archiveNotification(item.id), {
                              success: "Notificación archivada",
                              error: "No se pudo archivar la notificación",
                            })
                          }
                          aria-label={`Archivar notificación: ${item.title}`}
                        >
                          <Archive aria-hidden="true" className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
