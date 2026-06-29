"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Bell, CheckCheck, ExternalLink, ShieldAlert, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  archiveNotification,
  getMyNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "@/server/actions/notifications";
import { cn } from "@/lib/utils";

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
  const [isPending, startTransition] = useTransition();

  const unreadLabel = useMemo(() => {
    if (unreadCount > 9) return "9+";
    return String(unreadCount);
  }, [unreadCount]);

  const refresh = useCallback(async () => {
    const [notifications, count] = await Promise.all([
      getMyNotifications(12),
      getUnreadNotificationCount(),
    ]);
    setItems(notifications);
    setUnreadCount(count);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const runMutation = (mutation: () => Promise<void>) => {
    startTransition(async () => {
      await mutation();
      await refresh();
    });
  };

  const openNotification = (item: NotificationItem) => {
    runMutation(() => markNotificationRead(item.id));
    if (item.href) {
      setOpen(false);
      router.push(item.href);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
        aria-label="Notificaciones"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="-top-1 -right-1 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground leading-none">
            {unreadLabel}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] gap-0 p-0">
        <PopoverHeader className="border-b px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>Notificaciones</PopoverTitle>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isPending || unreadCount === 0}
              onClick={() => runMutation(markAllNotificationsRead)}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Leidas
            </Button>
          </div>
        </PopoverHeader>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {items.length === 0 ? (
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
                        className={cn(
                          "mt-0.5 rounded-md border p-1",
                          severityClasses[item.severity] ?? severityClasses.INFO,
                        )}
                      >
                        {getNotificationIcon(item.type, item.severity)}
                      </div>
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => openNotification(item)}
                      >
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {item.body}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{formatRelativeDate(item.createdAt)}</span>
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
                            onClick={() => openNotification(item)}
                            aria-label="Abrir"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => runMutation(() => archiveNotification(item.id))}
                          aria-label="Archivar"
                        >
                          <Archive className="h-3 w-3" />
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
