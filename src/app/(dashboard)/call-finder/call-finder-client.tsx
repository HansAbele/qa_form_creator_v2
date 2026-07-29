"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileAudio,
  Filter,
  FolderOpen,
  PhoneCall,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatOperationalTimestamp } from "@/lib/date-display";
import { cn } from "@/lib/utils";
import { syncNiceCxoneCalls } from "@/server/actions/call-finder";
import type { CallFinderPageData } from "@/server/queries/call-finder";

type FilterState = {
  campaignId: string;
  agentId: string;
  provider: string;
  direction: string;
  phoneNumber: string;
  dateFrom: string;
  dateTo: string;
  minDuration: string;
  maxDuration: string;
};

const EMPTY_FILTER_STATE: FilterState = {
  campaignId: "",
  agentId: "",
  provider: "",
  direction: "",
  phoneNumber: "",
  dateFrom: "",
  dateTo: "",
  minDuration: "",
  maxDuration: "",
};

function durationLabel(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function toFilterState(data: CallFinderPageData): FilterState {
  return {
    campaignId: data.filters.campaignId ?? "",
    agentId: data.filters.agentId ?? "",
    provider: data.filters.provider ?? "",
    direction: data.filters.direction ?? "",
    phoneNumber: data.filters.phoneNumber ?? "",
    dateFrom: data.filters.dateFrom ?? "",
    dateTo: data.filters.dateTo ?? "",
    minDuration: data.filters.minDuration?.toString() ?? "",
    maxDuration: data.filters.maxDuration?.toString() ?? "",
  };
}

function buildQuery(filters: FilterState, page = 1) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    const normalized = value.trim();
    if (normalized) query.set(key, normalized);
  }
  if (page > 1) query.set("page", String(page));
  const serialized = query.toString();
  return serialized ? `/call-finder?${serialized}` : "/call-finder";
}

export function CallFinderClient({
  data,
  canSyncCalls,
}: {
  data: CallFinderPageData;
  canSyncCalls: boolean;
}) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const operationalTimeZone = useOperationalTimeZone();
  const [filters, setFilters] = useState<FilterState>(() => toFilterState(data));
  const [syncPending, startSyncTransition] = useTransition();
  const filteredAgents = useMemo(
    () =>
      filters.campaignId
        ? data.agents.filter((agent) => agent.campaignId === filters.campaignId)
        : data.agents,
    [data.agents, filters.campaignId],
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const updateFilter = (key: keyof FilterState, value: string) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "campaignId" ? { agentId: "" } : {}),
    }));
  };

  return (
    <div className="mx-auto max-w-[1480px] space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">{t("Call Finder")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Find calls by campaign, agent, date, direction, phone, or duration.")}
          </p>
        </div>
        {canSyncCalls ? (
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={syncPending}
            onClick={() =>
              startSyncTransition(async () => {
                try {
                  const result = await syncNiceCxoneCalls();
                  toast.success(
                    t("NICE CXone synchronized: {created} new, {updated} updated.", {
                      created: result.created,
                      updated: result.updated,
                    }),
                  );
                  router.refresh();
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : t("Unable to synchronize calls"),
                  );
                }
              })
            }
          >
            <RefreshCw className={cn("size-4", syncPending && "animate-spin")} />
            {syncPending ? t("Synchronizing calls") : t("Synchronize NICE")}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="size-4 text-primary" />
            {t("Search calls")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label>{t("Campaign")}</Label>
              <Select
                value={filters.campaignId || "all"}
                onValueChange={(value) =>
                  updateFilter("campaignId", !value || value === "all" ? "" : value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("All campaigns")}</SelectItem>
                  {data.campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Agent")}</Label>
              <Select
                value={filters.agentId || "all"}
                onValueChange={(value) =>
                  updateFilter("agentId", !value || value === "all" ? "" : value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("All agents")}</SelectItem>
                  {filteredAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.agentCode ? ` (${agent.agentCode})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Provider")}</Label>
              <Select
                value={filters.provider || "all"}
                onValueChange={(value) =>
                  updateFilter("provider", !value || value === "all" ? "" : value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("All providers")}</SelectItem>
                  <SelectItem value="NICE_CXONE">NICE CXone</SelectItem>
                  <SelectItem value="VICIDIAL">VICIdial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Direction")}</Label>
              <Select
                value={filters.direction || "all"}
                onValueChange={(value) =>
                  updateFilter("direction", !value || value === "all" ? "" : value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("All directions")}</SelectItem>
                  <SelectItem value="INBOUND">{t("Inbound")}</SelectItem>
                  <SelectItem value="OUTBOUND">{t("Outbound")}</SelectItem>
                  <SelectItem value="UNKNOWN">{t("Unknown")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="call-phone">{t("Phone number")}</Label>
              <Input
                id="call-phone"
                value={filters.phoneNumber}
                onChange={(event) => updateFilter("phoneNumber", event.target.value)}
                placeholder="Ej. 5550100"
              />
            </div>
            <DateRangeFilter
              from={filters.dateFrom}
              to={filters.dateTo}
              onApply={(dateFrom, dateTo) =>
                setFilters((current) => ({ ...current, dateFrom, dateTo }))
              }
              label={t("Period")}
              align="start"
            />
            <div className="space-y-1.5">
              <Label htmlFor="call-min-duration">{t("Minimum duration (sec)")}</Label>
              <Input
                id="call-min-duration"
                type="number"
                min={0}
                value={filters.minDuration}
                onChange={(event) => updateFilter("minDuration", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="call-max-duration">{t("Maximum duration (sec)")}</Label>
              <Input
                id="call-max-duration"
                type="number"
                min={0}
                value={filters.maxDuration}
                onChange={(event) => updateFilter("maxDuration", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFilters(EMPTY_FILTER_STATE);
                router.push("/call-finder");
              }}
            >
              {t("Clear filters")}
            </Button>
            <Button
              type="button"
              className="gap-2"
              onClick={() => router.push(buildQuery(filters))}
            >
              <Search className="size-4" />
              {t("Search calls")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={PhoneCall} label={t("Calls found")} value={data.pagination.totalCount} />
        <SummaryCard icon={FolderOpen} label={t("Current page")} value={data.pagination.page} />
        <SummaryCard icon={Filter} label={t("Active filters")} value={activeFilterCount} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileAudio className="size-5 text-primary" />
            {t("Calls")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.interactions.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Agent")}</TableHead>
                    <TableHead>{t("Phone number")}</TableHead>
                    <TableHead>{t("Campaign")}</TableHead>
                    <TableHead>{t("Date")}</TableHead>
                    <TableHead>{t("Duration")}</TableHead>
                    <TableHead>{t("Direction")}</TableHead>
                    <TableHead>{t("Recording")}</TableHead>
                    <TableHead>{t("Transcript")}</TableHead>
                    <TableHead className="text-right">{t("Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.interactions.map((interaction) => (
                    <TableRow key={interaction.id}>
                      <TableCell>
                        <div className="font-medium">
                          {interaction.agent?.name ?? interaction.providerAgentName ?? t("Unknown")}
                        </div>
                        {interaction.agent?.agentCode ? (
                          <div className="text-xs text-muted-foreground">
                            {t("Agent code")}: {interaction.agent.agentCode}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {interaction.phoneNumber ?? "—"}
                      </TableCell>
                      <TableCell>{interaction.campaign.name}</TableCell>
                      <TableCell>
                        {formatOperationalTimestamp(
                          interaction.startedAt,
                          operationalTimeZone,
                          { dateStyle: "medium", timeStyle: "short" },
                          locale === "es" ? "es-ES" : "en-US",
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {durationLabel(interaction.durationSeconds)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {interaction.direction === "INBOUND"
                            ? t("Inbound")
                            : interaction.direction === "OUTBOUND"
                              ? t("Outbound")
                              : t("Unknown")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <AvailabilityBadge
                          available={interaction.recordingAvailable}
                          pending={interaction.hasRecording && !interaction.recordingAvailable}
                          pendingLabel={t("Available in NICE")}
                          label={t("Recording")}
                        />
                      </TableCell>
                      <TableCell>
                        <AvailabilityBadge
                          available={Boolean(interaction.transcript)}
                          pending={!interaction.transcript && interaction.hasRecording}
                          pendingLabel={
                            interaction.recordingAvailable
                              ? t("Ready to transcribe")
                              : t("Download recording first")
                          }
                          label={t("Transcript")}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/call-finder/${interaction.id}`}
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "gap-1.5",
                          )}
                        >
                          {interaction.response?.status === "SUBMITTED" ? (
                            <CheckCircle2 className="size-4" />
                          ) : (
                            <ScrollText className="size-4" />
                          )}
                          {t("Open")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  {t("Page {page} of {total}", {
                    page: data.pagination.page,
                    total: data.pagination.totalPages,
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={data.pagination.page <= 1}
                    onClick={() => router.push(buildQuery(filters, data.pagination.page - 1))}
                  >
                    <ArrowLeft className="size-4" />
                    {t("Previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={data.pagination.page >= data.pagination.totalPages}
                    onClick={() => router.push(buildQuery(filters, data.pagination.page + 1))}
                  >
                    {t("Next")}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
              <PhoneCall className="size-10 text-muted-foreground/50" />
              <p className="mt-3 font-medium">{t("No calls match these filters")}</p>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                {t(
                  "Calls will appear here after NICE CXone or VICIdial synchronization is configured.",
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof PhoneCall;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="font-heading text-2xl font-bold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AvailabilityBadge({
  available,
  pending = false,
  pendingLabel,
  label,
}: {
  available: boolean;
  pending?: boolean;
  pendingLabel?: string;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <Badge
      variant={available ? "secondary" : "outline"}
      className={cn("gap-1", pending && "border-primary/30 text-primary")}
    >
      {available ? <CheckCircle2 className="size-3" /> : null}
      <span className="sr-only">{label}: </span>
      {available
        ? t("Available")
        : pending
          ? (pendingLabel ?? t("Pending"))
          : t("Not available")}
    </Badge>
  );
}
