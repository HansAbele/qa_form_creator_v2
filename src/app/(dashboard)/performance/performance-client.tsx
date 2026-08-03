"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  HeartHandshake,
  Pause,
  Play,
  ShieldCheck,
  Square,
  Target,
  TimerReset,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatOperationalTimestamp } from "@/lib/date-display";
import { formDisplayName } from "@/lib/form-display-name";
import { formatTrackedDuration, QA_ACTIVITY_TYPES } from "@/lib/performance-management";
import {
  finishQaActivity,
  pauseQaActivity,
  resumeQaActivity,
  startQaActivity,
} from "@/server/actions/performance-management";
import type { PerformanceWorkspaceData } from "@/server/queries/performance-management";
import {
  AcknowledgementDialog,
  NewCoachingDialog,
  NewPipDialog,
  PipLifecycleButtons,
} from "./performance-dialogs";

type WorkspaceData = PerformanceWorkspaceData;
type CoachingItem = WorkspaceData["coachingSessions"][number];
type ActivityItem = WorkspaceData["activities"][number];
type PipItem = WorkspaceData["pipPlans"][number];

const COACHING_OPEN = new Set(["DRAFT", "SCHEDULED", "IN_PROGRESS", "AWAITING_ACKNOWLEDGEMENT"]);
const PIP_ACTIVE = new Set(["ACTIVE", "ON_HOLD", "EXTENDED"]);

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (
    status === "COMPLETED" ||
    status === "ACKNOWLEDGED" ||
    status === "COMPLETED_SUCCESSFULLY" ||
    status === "IMPROVED"
  ) {
    return "default";
  }
  if (
    status === "REFUSED" ||
    status === "COMPLETED_UNSUCCESSFULLY" ||
    status === "NO_PROGRESS" ||
    status === "CANCELLED"
  ) {
    return "destructive";
  }
  if (status === "ACTIVE" || status === "IN_PROGRESS" || status === "ON_TRACK") {
    return "secondary";
  }
  return "outline";
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Activity;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
      <div className="mb-4 rounded-2xl bg-primary/10 p-3 text-primary">
        <Icon className="size-6" />
      </div>
      <h3 className="font-heading text-base font-medium">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "primary",
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  tone?: "primary" | "warning" | "success" | "neutral";
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    neutral: "bg-muted text-muted-foreground",
  }[tone];

  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${toneClass}`}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function useLiveSeconds(activity: ActivityItem | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activity || activity.status !== "ACTIVE") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [activity]);

  if (!activity) return 0;
  if (activity.status !== "ACTIVE" || !activity.openIntervalStartedAt) {
    return activity.persistedSeconds;
  }
  return (
    activity.persistedSeconds +
    Math.max(0, Math.floor((now - new Date(activity.openIntervalStartedAt).getTime()) / 1_000))
  );
}

function CurrentActivityCard({
  activity,
  onChanged,
}: {
  activity: ActivityItem | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const seconds = useLiveSeconds(activity);
  const [pending, startTransition] = useTransition();

  if (!activity) return null;
  const activityId = activity.id;

  function mutate(action: "pause" | "resume" | "finish") {
    startTransition(async () => {
      try {
        if (action === "pause") {
          await pauseQaActivity({ activitySessionId: activityId });
        } else if (action === "resume") {
          await resumeQaActivity({ activitySessionId: activityId });
        } else {
          await finishQaActivity({ activitySessionId: activityId });
        }
        toast.success(t(action === "finish" ? "Activity completed" : "Timer updated"));
        onChanged();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to update the timer")));
      }
    });
  }

  return (
    <Card className="border-primary/20 bg-[linear-gradient(135deg,var(--card),color-mix(in_oklab,var(--primary)_7%,var(--card)))] ring-primary/20">
      <CardContent className="flex flex-col gap-5 pt-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative rounded-2xl bg-primary p-3 text-primary-foreground">
            <TimerReset className="size-6" />
            {activity.status === "ACTIVE" ? (
              <span className="absolute -top-1 -right-1 size-3 animate-pulse rounded-full bg-emerald-400 ring-2 ring-card" />
            ) : null}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-heading text-base font-semibold">
                {activity.label || t(titleCase(activity.activityType))}
              </p>
              <Badge variant={activity.status === "ACTIVE" ? "default" : "outline"}>
                {t(titleCase(activity.status))}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {activity.campaignName}
              {activity.coachingSession ? ` · ${activity.coachingSession.title}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <p className="font-mono text-4xl font-semibold tracking-tight tabular-nums">
            {formatTrackedDuration(seconds)}
          </p>
          <div className="flex gap-2">
            {activity.status === "ACTIVE" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => mutate("pause")}
              >
                <Pause data-icon="inline-start" />
                {t("Pause")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => mutate("resume")}
              >
                <Play data-icon="inline-start" />
                {t("Resume")}
              </Button>
            )}
            <Button type="button" size="sm" disabled={pending} onClick={() => mutate("finish")}>
              <Square data-icon="inline-start" />
              {t("Finish")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CoachingCard({
  item,
  canTrack,
  hasCurrentActivity,
  isAgent,
  onChanged,
}: {
  item: CoachingItem;
  canTrack: boolean;
  hasCurrentActivity: boolean;
  isAgent: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const timeZone = useOperationalTimeZone();
  const [pending, startTransition] = useTransition();

  function startLiveCoaching() {
    startTransition(async () => {
      try {
        await startQaActivity({
          campaignId: item.campaignId,
          activityType: "COACHING_LIVE",
          label: item.title,
          notes: null,
          responseId: item.response?.id ?? null,
          coachingSessionId: item.id,
          pipPlanId: null,
        });
        toast.success(t("Coaching timer started"));
        onChanged();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to start the timer")));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(item.status)}>{t(titleCase(item.status))}</Badge>
          <Badge variant="outline">{t(titleCase(item.source))}</Badge>
          {item.isAcknowledgementOverdue ? (
            <Badge variant="destructive">{t("Acknowledgement overdue")}</Badge>
          ) : null}
        </div>
        <CardTitle className="mt-2">{item.title}</CardTitle>
        <CardDescription>
          {item.agent.name} · {item.campaign.name} · {t("Coach")}: {item.coach.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 rounded-xl bg-muted/35 p-4 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("Focus and objective")}
            </p>
            <p className="mt-1 font-medium">{item.focusArea}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.objective}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("Live coaching time")}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {formatTrackedDuration(item.liveSeconds)}
            </p>
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">{t("Created")}:</span>{" "}
            {formatOperationalTimestamp(item.createdAt, timeZone, undefined, locale)}
          </div>
          <div>
            <span className="text-muted-foreground">{t("Follow-up")}:</span>{" "}
            {item.followUpAt
              ? formatOperationalTimestamp(item.followUpAt, timeZone, undefined, locale)
              : t("Not scheduled")}
          </div>
          {item.response ? (
            <div>
              <span className="text-muted-foreground">{t("Linked evaluation")}:</span>{" "}
              {Number(item.response.score).toFixed(2)}
              {item.response.hasFatalFail ? ` · ${t("Fatal fail")}` : ""}
            </div>
          ) : null}
          <div>
            <span className="text-muted-foreground">{t("Acknowledgement")}:</span>{" "}
            {t(titleCase(item.acknowledgement?.status ?? "PENDING"))}
          </div>
        </div>

        {item.actionItems.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("Action items")}
            </p>
            <div className="space-y-2">
              {item.actionItems.map((action) => (
                <div
                  key={action.id}
                  className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <p className="text-sm">{action.description}</p>
                  <Badge variant="outline">{t(titleCase(action.status))}</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {COACHING_OPEN.has(item.status) &&
          canTrack &&
          !hasCurrentActivity &&
          item.status !== "AWAITING_ACKNOWLEDGEMENT" ? (
            <Button type="button" size="sm" disabled={pending} onClick={startLiveCoaching}>
              <Play data-icon="inline-start" />
              {t("Start coaching")}
            </Button>
          ) : null}
          {item.status === "AWAITING_ACKNOWLEDGEMENT" && !isAgent ? (
            <AcknowledgementDialog coachingSessionId={item.id} onSaved={onChanged} />
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/performance/coaching/${item.id}`} />}
          >
            <Eye data-icon="inline-start" />
            {t("Open evidence")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CoachingPanel({ data, onChanged }: { data: WorkspaceData; onChanged: () => void }) {
  const { t } = useI18n();
  const trackCampaigns = useMemo(
    () => new Set(data.campaigns.filter((item) => item.canTrackQaActivity).map((item) => item.id)),
    [data.campaigns],
  );

  if (data.coachingSessions.length === 0) {
    return (
      <EmptyState
        icon={HeartHandshake}
        title={t("No coaching sessions yet")}
        description={t(
          "Create a coaching record when an evaluation, trend, or critical behavior requires guided follow-up.",
        )}
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {data.coachingSessions.map((item) => (
        <CoachingCard
          key={item.id}
          item={item}
          canTrack={trackCampaigns.has(item.campaignId)}
          hasCurrentActivity={Boolean(data.ownCurrentActivity)}
          isAgent={data.currentUser.isAgent}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function ActivityStarter({ data, onChanged }: { data: WorkspaceData; onChanged: () => void }) {
  const { t } = useI18n();
  const campaigns = data.campaigns.filter((campaign) => campaign.canTrackQaActivity);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [activityType, setActivityType] = useState("EVALUATION");
  const [pending, startTransition] = useTransition();

  if (data.ownCurrentActivity || campaigns.length === 0) return null;

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await startQaActivity({
          campaignId,
          activityType,
          label: String(formData.get("label") ?? "") || null,
          notes: String(formData.get("notes") ?? "") || null,
          responseId: null,
          coachingSessionId: null,
          pipPlanId: null,
        });
        toast.success(t("Activity timer started"));
        onChanged();
      } catch (error) {
        toast.error(errorMessage(error, t("Unable to start the timer")));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Start QA activity")}</CardTitle>
        <CardDescription>
          {t("Record where QA time is invested using one active timer at a time.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr_1.5fr_auto]">
          <div className="space-y-1.5">
            <Label>{t("Campaign")}</Label>
            {campaigns.length === 1 ? (
              <div className="flex min-h-10 items-center justify-between rounded-md border bg-muted/30 px-3 text-sm">
                <span className="font-medium">{campaigns[0]?.name}</span>
                <Badge variant="secondary">{t("Automatic")}</Badge>
              </div>
            ) : (
              <Select value={campaignId} onValueChange={(value) => setCampaignId(value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) =>
                      campaigns.find((campaign) => campaign.id === value)?.name ??
                      t("Select campaign")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{t("Activity type")}</Label>
            <Select value={activityType} onValueChange={(value) => setActivityType(value ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => (value ? t(titleCase(value)) : t("Select activity"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {QA_ACTIVITY_TYPES.filter((type) => type !== "COACHING_LIVE").map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(titleCase(type))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="activity-label">{t("Label")}</Label>
            <Input
              id="activity-label"
              name="label"
              placeholder={t("Example: Weekly calibration")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="activity-notes">{t("Notes")}</Label>
            <Input id="activity-notes" name="notes" placeholder={t("Optional context")} />
          </div>
          <Button className="self-end" type="submit" disabled={pending || !campaignId}>
            <Play data-icon="inline-start" />
            {pending ? t("Starting…") : t("Start")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ActivityPanel({ data, onChanged }: { data: WorkspaceData; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const timeZone = useOperationalTimeZone();

  return (
    <div className="space-y-4">
      <ActivityStarter data={data} onChanged={onChanged} />

      {data.access.canViewQaActivity ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("QA workload")}</CardTitle>
            <CardDescription>
              {t("Documented time by QA, including evaluation and coaching work.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.qaWorkload.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title={t("No tracked workload yet")}
                description={t("The dashboard will populate as QA activities are completed.")}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("QA")}</TableHead>
                    <TableHead className="text-right">{t("Sessions")}</TableHead>
                    <TableHead className="text-right">{t("Evaluations")}</TableHead>
                    <TableHead className="text-right">{t("Coaching")}</TableHead>
                    <TableHead className="text-right">{t("Total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.qaWorkload.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.sessionCount}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatTrackedDuration(row.evaluationSeconds)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatTrackedDuration(row.coachingSeconds)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {formatTrackedDuration(row.totalSeconds)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("Activity history")}</CardTitle>
          <CardDescription>
            {t("A durable record of QA work with server-controlled timestamps.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.activities.length === 0 ? (
            <EmptyState
              icon={Clock3}
              title={t("No activity recorded")}
              description={t("Start a timer to create the first operational record.")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Activity")}</TableHead>
                  <TableHead>{t("QA")}</TableHead>
                  <TableHead>{t("Campaign")}</TableHead>
                  <TableHead>{t("Started")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead className="text-right">{t("Duration")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.activities.map((activity) => (
                  <TableRow key={activity.id}>
                    <TableCell>
                      <p className="font-medium">
                        {activity.label || t(titleCase(activity.activityType))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(titleCase(activity.activityType))}
                      </p>
                      {activity.response ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {activity.response.agent.name} ·{" "}
                            {formDisplayName(activity.response.form.title)}
                            {activity.response.interaction
                              ? ` · #${activity.response.interaction.providerInteractionId}`
                              : ""}
                          </span>
                          <Link
                            href={`/evaluations/${activity.response.id}`}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {t("View evaluation")}
                          </Link>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{activity.userName}</TableCell>
                    <TableCell>{activity.campaignName}</TableCell>
                    <TableCell>
                      {formatOperationalTimestamp(activity.startedAt, timeZone, undefined, locale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(activity.status)}>
                        {t(titleCase(activity.status))}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {formatTrackedDuration(activity.totalSeconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PipCard({
  pip,
  data,
  onChanged,
}: {
  pip: PipItem;
  data: WorkspaceData;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const timeZone = useOperationalTimeZone();
  const canManage = data.campaigns.some(
    (campaign) => campaign.id === pip.campaignId && campaign.canManagePips,
  );
  const finishedGoals = pip.goals.filter((goal) => goal.status === "MET").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(pip.status)}>{t(titleCase(pip.status))}</Badge>
          {PIP_ACTIVE.has(pip.status) ? (
            <Badge variant={statusVariant(pip.acknowledgementStatus)}>
              {t("Receipt")}: {t(titleCase(pip.acknowledgementStatus))}
            </Badge>
          ) : null}
        </div>
        <CardTitle className="mt-2">{pip.title}</CardTitle>
        <CardDescription>
          {pip.agent.name} · {pip.campaign.name} · {t("Owner")}: {pip.owner.name}
        </CardDescription>
        <CardAction>
          {PIP_ACTIVE.has(pip.status) ? (
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <Target className="size-5" />
            </div>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl bg-muted/35 p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("Objective")}
          </p>
          <p className="mt-1 text-sm leading-6">{pip.objective}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{t("Target end date")}</p>
            <p className="mt-1 font-medium">
              {formatOperationalTimestamp(
                pip.targetEndDate,
                timeZone,
                { dateStyle: "medium" },
                locale,
              )}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{t("Goals achieved")}</p>
            <p className="mt-1 font-medium">
              {finishedGoals}/{pip.goals.length}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{t("Reviews")}</p>
            <p className="mt-1 font-medium">{pip.reviews.length}</p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("Measurable goals")}
          </p>
          <div className="space-y-2">
            {pip.goals.map((goal) => (
              <div key={goal.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{goal.area}</p>
                  <div className="flex gap-2">
                    {goal.isCritical ? <Badge variant="destructive">{t("Critical")}</Badge> : null}
                    <Badge variant={statusVariant(goal.status)}>{t(titleCase(goal.status))}</Badge>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <p>
                    <span className="font-medium text-foreground">{t("Baseline")}:</span>{" "}
                    {goal.baseline}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">{t("Target")}:</span>{" "}
                    {goal.target}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {pip.reviews[0] ? (
          <div className="rounded-lg border-l-4 border-l-primary bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{t("Latest review")}</p>
              <Badge variant={statusVariant(pip.reviews[0].outcome ?? "PENDING")}>
                {t(titleCase(pip.reviews[0].outcome ?? "PENDING"))}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{pip.reviews[0].summary}</p>
          </div>
        ) : null}

        {canManage ? (
          <div className="border-t pt-4">
            <PipLifecycleButtons pip={pip} isAdmin={data.currentUser.isAdmin} onSaved={onChanged} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {pip.evidence.length + pip.coachingSessions.length} {t("evidence sources")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/performance/pips/${pip.id}`} />}
          >
            <Eye data-icon="inline-start" />
            {t("Open evidence")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PipPanel({ data, onChanged }: { data: WorkspaceData; onChanged: () => void }) {
  const { t } = useI18n();
  if (data.pipPlans.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title={t("No improvement plans yet")}
        description={t(
          "PIPs will appear here with measurable goals, approvals, formal reviews, and closure evidence.",
        )}
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {data.pipPlans.map((pip) => (
        <PipCard key={pip.id} pip={pip} data={data} onChanged={onChanged} />
      ))}
    </div>
  );
}

export function PerformanceClient({ data }: { data: WorkspaceData }) {
  const router = useRouter();
  const { t } = useI18n();
  const onChanged = () => router.refresh();
  const applyDateRange = (from: string, to: string) => {
    const params = new URLSearchParams(window.location.search);
    if (from) params.set("from", from);
    else params.delete("from");
    if (to) params.set("to", to);
    else params.delete("to");
    const query = params.toString();
    router.replace(query ? `/performance?${query}` : "/performance");
  };

  return (
    <div className="space-y-6 pb-10">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-5 py-6 sm:px-7">
        <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
              <ShieldCheck className="size-4" />
              {t("Quality operations")}
            </div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              {data.currentUser.isAgent ? t("My Performance") : t("Performance Management")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              {data.currentUser.isAgent
                ? t(
                    "Review your private coaching evidence, listen to linked calls, and follow your improvement plans.",
                  )
                : t(
                    "Document coaching, measure QA effort, and manage improvement plans from one auditable workspace.",
                  )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.access.canManageCoaching ? (
              <NewCoachingDialog data={data} onSaved={onChanged} />
            ) : null}
            {data.access.canManagePips ? <NewPipDialog data={data} onSaved={onChanged} /> : null}
          </div>
        </div>
      </section>

      <Card size="sm">
        <CardContent className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium">{t("Filter records by date")}</p>
            <p className="text-xs text-muted-foreground">
              {t("The same operational period applies to coaching, QA activity, and PIP records.")}
            </p>
          </div>
          <DateRangeFilter
            id="performance-date-range"
            from={data.filters.from}
            to={data.filters.to}
            onApply={applyDateRange}
            triggerClassName="sm:w-72"
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          icon={HeartHandshake}
          label={t("Open coaching")}
          value={data.summary.openCoaching}
        />
        <SummaryCard
          icon={UserCheck}
          label={t("Awaiting acknowledgement")}
          value={data.summary.awaitingAcknowledgement}
          tone="neutral"
        />
        <SummaryCard
          icon={AlertTriangle}
          label={t("Overdue acknowledgement")}
          value={data.summary.overdueAcknowledgement}
          tone="warning"
        />
        <SummaryCard
          icon={Target}
          label={t("Active PIPs")}
          value={data.summary.activePips}
          tone="success"
        />
        <SummaryCard
          icon={CheckCircle2}
          label={t("Pending approval")}
          value={data.summary.pendingPipApproval}
          tone="neutral"
        />
      </div>

      {!data.currentUser.isAgent ? (
        <CurrentActivityCard activity={data.ownCurrentActivity} onChanged={onChanged} />
      ) : null}

      <Tabs
        defaultValue={
          data.access.canViewCoaching
            ? "coaching"
            : data.access.canTrackQaActivity || data.access.canViewQaActivity
              ? "activity"
              : "pips"
        }
        className="gap-4"
      >
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          {data.access.canViewCoaching ? (
            <TabsTrigger value="coaching">
              <HeartHandshake data-icon="inline-start" />
              {t("Coaching")}
            </TabsTrigger>
          ) : null}
          {data.access.canTrackQaActivity || data.access.canViewQaActivity ? (
            <TabsTrigger value="activity">
              <Activity data-icon="inline-start" />
              {t("QA activity")}
            </TabsTrigger>
          ) : null}
          {data.access.canViewPips ? (
            <TabsTrigger value="pips">
              <Target data-icon="inline-start" />
              {t("Improvement plans")}
            </TabsTrigger>
          ) : null}
        </TabsList>
        {data.access.canViewCoaching ? (
          <TabsContent value="coaching">
            <CoachingPanel data={data} onChanged={onChanged} />
          </TabsContent>
        ) : null}
        {data.access.canTrackQaActivity || data.access.canViewQaActivity ? (
          <TabsContent value="activity">
            <ActivityPanel data={data} onChanged={onChanged} />
          </TabsContent>
        ) : null}
        {data.access.canViewPips ? (
          <TabsContent value="pips">
            <PipPanel data={data} onChanged={onChanged} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
