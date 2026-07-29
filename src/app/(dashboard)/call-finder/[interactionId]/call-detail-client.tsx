"use client";

import {
  ArrowLeft,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  Hash,
  Phone,
  Radio,
  Tags,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { InteractionMediaPanel } from "@/components/call-finder/interaction-media-panel";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatOperationalTimestamp } from "@/lib/date-display";
import { cn } from "@/lib/utils";
import type { CallFinderInteractionDetail } from "@/server/queries/call-finder";

function durationLabel(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function CallDetailClient({ interaction }: { interaction: CallFinderInteractionDetail }) {
  const { locale, t } = useI18n();
  const operationalTimeZone = useOperationalTimeZone();
  const [formId, setFormId] = useState(interaction.forms[0]?.id ?? "");
  const linkedResponse = interaction.response;
  const evaluationHref = linkedResponse
    ? linkedResponse.status === "DRAFT"
      ? `/forms/${linkedResponse.formId}?responseId=${linkedResponse.id}`
      : `/evaluations/${linkedResponse.id}`
    : formId
      ? `/forms/${formId}?interactionId=${interaction.id}`
      : null;
  const evaluationLabel = linkedResponse
    ? linkedResponse.status === "DRAFT"
      ? t("Continue evaluation")
      : t("View evaluation")
    : t("Start evaluation");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href="/call-finder"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "gap-1.5 text-muted-foreground",
        )}
      >
        <ArrowLeft className="size-4" />
        {t("Back to Call Finder")}
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-3xl font-bold tracking-tight">{t("Call details")}</h1>
            <Badge variant="outline">{interaction.provider.replaceAll("_", " ")}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {interaction.campaign.name} · {interaction.providerInteractionId}
          </p>
        </div>
        {linkedResponse ? <Badge variant="secondary">{linkedResponse.status}</Badge> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DetailCard
          icon={User}
          label={t("Agent")}
          value={interaction.agent?.name ?? interaction.providerAgentName ?? t("Unknown")}
          detail={interaction.agent?.agentCode ?? null}
        />
        <DetailCard
          icon={Phone}
          label={t("Phone number")}
          value={interaction.phoneNumber ?? "—"}
          detail={
            interaction.direction === "INBOUND"
              ? t("Inbound")
              : interaction.direction === "OUTBOUND"
                ? t("Outbound")
                : t("Unknown")
          }
        />
        <DetailCard
          icon={CalendarClock}
          label={t("Date")}
          value={formatOperationalTimestamp(
            interaction.startedAt,
            operationalTimeZone,
            { dateStyle: "medium", timeStyle: "short" },
            locale === "es" ? "es-ES" : "en-US",
          )}
          detail={durationLabel(interaction.durationSeconds)}
        />
        <DetailCard
          icon={Tags}
          label={t("Disposition")}
          value={interaction.disposition?.name ?? t("No disposition")}
          detail={interaction.disposition?.code ?? interaction.status}
        />
      </div>

      <InteractionMediaPanel
        interaction={{
          id: interaction.id,
          provider: interaction.provider,
          providerInteractionId: interaction.providerInteractionId,
          direction: interaction.direction,
          phoneNumber: interaction.phoneNumber,
          queueName: interaction.queueName,
          startedAt: interaction.startedAt,
          durationSeconds: interaction.durationSeconds,
          status: interaction.status,
          dispositionName: interaction.disposition?.name ?? null,
          callMetadata: interaction.callMetadata,
          audioUrl: interaction.audioUrl,
          recordingExpected: interaction.hasRecording,
          transcript: interaction.transcript,
          transcriptionJob: interaction.transcriptionJob,
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="size-4 text-primary" />
              {t("Call details")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Metadata
              label={t("External ID")}
              value={interaction.providerInteractionId}
              icon={Hash}
            />
            <Metadata label={t("Queue")} value={interaction.queueName ?? "—"} icon={Radio} />
            <Metadata
              label={t("Duration")}
              value={durationLabel(interaction.durationSeconds)}
              icon={Clock3}
            />
            <Metadata
              label={t("Hold time")}
              value={
                interaction.callMetadata.holdSeconds == null
                  ? "—"
                  : `${durationLabel(interaction.callMetadata.holdSeconds)} · ${interaction.callMetadata.holdCount ?? 0} ${t("holds")}`
              }
              icon={Clock3}
            />
            <Metadata label={t("Status")} value={interaction.status ?? t("Unknown")} icon={Tags} />
            <Metadata
              label={t("Skill / queue")}
              value={interaction.callMetadata.skillName ?? interaction.queueName ?? "—"}
              icon={Radio}
            />
            <Metadata
              label={t("Team")}
              value={interaction.callMetadata.teamName ?? "—"}
              icon={Users}
            />
            <Metadata
              label={t("Contact point")}
              value={interaction.callMetadata.pointOfContactName ?? "—"}
              icon={Phone}
            />
            <Metadata
              label={t("Transfer")}
              value={interaction.callMetadata.transferIndicatorName ?? "—"}
              icon={Tags}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="size-4 text-primary" />
              {t("Evaluation")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!linkedResponse ? (
              interaction.forms.length > 0 ? (
                <Select value={formId} onValueChange={(value) => value && setFormId(value)}>
                  <SelectTrigger className="w-full" aria-label={t("Choose a published form")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {interaction.forms.map((form) => (
                      <SelectItem key={form.id} value={form.id}>
                        {form.title} · v{form.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("No published forms are available for this campaign.")}
                </p>
              )
            ) : null}
            {evaluationHref ? (
              <Link href={evaluationHref} className={cn(buttonVariants(), "w-full gap-2")}>
                <ClipboardCheck className="size-4" />
                {evaluationLabel}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof User;
  label: string;
  value: string;
  detail: string | null;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="truncate font-medium">{value}</p>
          {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Metadata({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Radio;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}
