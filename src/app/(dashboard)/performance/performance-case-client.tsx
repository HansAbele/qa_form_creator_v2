"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  HeartHandshake,
  ShieldCheck,
  Target,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { InteractionMediaPanel } from "@/components/call-finder/interaction-media-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatOperationalTimestamp } from "@/lib/date-display";
import type { CoachingCaseDetail, PipCaseDetail } from "@/server/queries/performance-case-detail";
import { AcknowledgementDialog, PipAcknowledgementDialog } from "./performance-dialogs";

type Evidence = CoachingCaseDetail["evidence"][number];

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (
    status === "COMPLETED" ||
    status === "ACKNOWLEDGED" ||
    status === "COMPLETED_SUCCESSFULLY" ||
    status === "MET" ||
    status === "IMPROVED"
  ) {
    return "default";
  }
  if (
    status === "REFUSED" ||
    status === "COMPLETED_UNSUCCESSFULLY" ||
    status === "NOT_MET" ||
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

function EvidenceCard({ evidence, isAgent }: { evidence: Evidence; isAgent: boolean }) {
  const { t } = useI18n();
  const timeZone = useOperationalTimeZone();
  const response = evidence.response;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{t(titleCase(evidence.type))}</Badge>
              {response?.hasFatalFail ? (
                <Badge variant="destructive">{t("Critical failure")}</Badge>
              ) : null}
            </div>
            <CardTitle className="mt-2 text-base">{evidence.title}</CardTitle>
            {evidence.description ? (
              <CardDescription className="mt-1">{evidence.description}</CardDescription>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">
            {formatOperationalTimestamp(evidence.createdAt, timeZone)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {response ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("Score")}
                </p>
                <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">
                  {response.score.toFixed(2)}%
                </p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("Scorecard")}
                </p>
                <p className="mt-1 text-sm font-medium">{response.formTitle}</p>
                <p className="text-xs text-muted-foreground">v{response.formVersion}</p>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("Evaluator")}
                </p>
                <p className="mt-1 text-sm font-medium">{response.evaluatorName}</p>
                <p className="text-xs text-muted-foreground">
                  {response.submittedAt
                    ? formatOperationalTimestamp(response.submittedAt, timeZone)
                    : t("Not available")}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Scorecard item")}</TableHead>
                    <TableHead>{t("Answer")}</TableHead>
                    <TableHead className="text-right">{t("Score")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {response.answers.map((answer) => (
                    <TableRow key={answer.id}>
                      <TableCell className="min-w-64 align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{answer.question.label}</span>
                          {answer.question.fatal ? (
                            <Badge variant={answer.isFatalFail ? "destructive" : "outline"}>
                              CF
                            </Badge>
                          ) : null}
                        </div>
                        {answer.category?.name ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {answer.category.name}
                          </p>
                        ) : null}
                        {answer.comment ? (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                            {answer.comment}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        {answer.notApplicable ? t("Not applicable") : answer.value}
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums">
                        {answer.score === null ? "—" : Number(answer.score).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}

        {evidence.interaction ? (
          <InteractionMediaPanel interaction={evidence.interaction} compact readOnly={isAgent} />
        ) : response ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">{t("No call is linked to this evaluation")}</p>
              <p className="text-xs text-muted-foreground">
                {t("A QA Manager should verify the source before conducting this session.")}
              </p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CaseHeading({
  title,
  subtitle,
  status,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  status: string;
  icon: typeof HeartHandshake;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/performance" />}>
        <ArrowLeft />
        {t("Back to Performance Management")}
      </Button>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Icon className="size-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                {title}
              </h1>
              <Badge variant={statusVariant(status)}>{t(titleCase(status))}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CoachingCaseClient({ data }: { data: CoachingCaseDetail }) {
  const { t } = useI18n();
  const router = useRouter();
  const timeZone = useOperationalTimeZone();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CaseHeading
        title={data.title}
        subtitle={`${data.agent.name} · ${data.campaign.name} · ${t("Coach")}: ${data.coach.name}`}
        status={data.status}
        icon={HeartHandshake}
      />

      {data.viewer.canAcknowledge ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="font-medium">{t("Your acknowledgement is pending")}</p>
              <p className="text-sm text-muted-foreground">
                {t("Review the evidence and action plan before confirming receipt.")}
              </p>
            </div>
            <AcknowledgementDialog
              coachingSessionId={data.id}
              agentSelfService
              onSaved={() => router.refresh()}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-start gap-3">
            <Target className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Focus area")}
              </p>
              <p className="mt-1 font-medium">{data.focusArea}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3">
            <CalendarDays className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Session date")}
              </p>
              <p className="mt-1 font-medium">
                {formatOperationalTimestamp(
                  data.startedAt ?? data.scheduledAt ?? data.createdAt,
                  timeZone,
                )}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Acknowledgement")}
              </p>
              <p className="mt-1 font-medium">
                {t(titleCase(data.acknowledgement?.status ?? "PENDING"))}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Coaching objective")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-6">{data.objective}</p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-semibold">{t("Supporting evidence")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("Evaluation, scorecard, recording, and transcript reviewed during coaching.")}
            </p>
          </div>
          <Badge variant={data.evidence.length > 0 ? "default" : "destructive"}>
            {data.evidence.length} {t("items")}
          </Badge>
        </div>
        {data.evidence.length > 0 ? (
          data.evidence.map((evidence) => (
            <EvidenceCard key={evidence.id} evidence={evidence} isAgent={data.viewer.isAgent} />
          ))
        ) : (
          <Card className="border-destructive/30">
            <CardContent className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="size-5" />
              <p>{t("This coaching has no documented evidence and should not be conducted.")}</p>
            </CardContent>
          </Card>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Action plan")}</CardTitle>
          <CardDescription>{t("Commitments agreed during the coaching session.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.actionItems.length > 0 ? (
            data.actionItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
              >
                <div>
                  <p className="text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.ownerName ?? t(titleCase(item.ownerType))}
                    {item.dueAt ? ` · ${formatOperationalTimestamp(item.dueAt, timeZone)}` : ""}
                  </p>
                </div>
                <Badge variant={statusVariant(item.status)}>{t(titleCase(item.status))}</Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{t("No action items documented.")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PipCaseClient({ data }: { data: PipCaseDetail }) {
  const { t } = useI18n();
  const router = useRouter();
  const timeZone = useOperationalTimeZone();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CaseHeading
        title={data.title}
        subtitle={`${data.agent.name} · ${data.campaign.name} · ${t("Owner")}: ${data.owner.name}`}
        status={data.status}
        icon={Target}
      />

      {data.viewer.canAcknowledge ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="font-medium">{t("Your PIP acknowledgement is pending")}</p>
              <p className="text-sm text-muted-foreground">
                {t("Review the goals, dates, support, and evidence before confirming receipt.")}
              </p>
            </div>
            <PipAcknowledgementDialog
              pipPlanId={data.id}
              agentSelfService
              onSaved={() => router.refresh()}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-start gap-3">
            <CalendarDays className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Plan period")}
              </p>
              <p className="mt-1 text-sm font-medium">
                {formatOperationalTimestamp(data.startDate, timeZone)} –{" "}
                {formatOperationalTimestamp(data.targetEndDate, timeZone)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3">
            <ClipboardCheck className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Goals")}
              </p>
              <p className="mt-1 font-medium">{data.goals.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("Acknowledgement")}
              </p>
              <p className="mt-1 font-medium">{t(titleCase(data.acknowledgementStatus))}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Reason and objective")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6">
            <div>
              <p className="font-medium">{t("Reason")}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{data.reason}</p>
            </div>
            <div>
              <p className="font-medium">{t("Objective")}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{data.objective}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Support and consequences")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6">
            <div>
              <p className="font-medium">{t("Company support")}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {data.supportSummary || t("Not documented")}
              </p>
            </div>
            <div>
              <p className="font-medium">{t("Consequences")}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {data.consequences || t("Not documented")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Measurable goals")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {data.goals.map((goal) => (
            <div key={goal.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{goal.area}</p>
                <Badge variant={statusVariant(goal.status)}>{t(titleCase(goal.status))}</Badge>
              </div>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    {t("Baseline")}
                  </p>
                  <p className="mt-1">{goal.baseline}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    {t("Target")}
                  </p>
                  <p className="mt-1">{goal.target}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("Data source")}: {goal.dataSource}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-xl font-semibold">{t("PIP evidence file")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Evaluations, calls, transcripts, and prior coaching supporting this plan.")}
          </p>
        </div>
        {data.evidence.map((evidence) => (
          <EvidenceCard key={evidence.id} evidence={evidence} isAgent={data.viewer.isAgent} />
        ))}
        {data.coachingSessions.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Linked coaching history")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.coachingSessions.map((coaching) => (
                <Link
                  key={coaching.id}
                  href={`/performance/coaching/${coaching.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <HeartHandshake className="size-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{coaching.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {coaching.focusArea} · {coaching.evidenceCount} {t("evidence items")}
                      </p>
                    </div>
                  </div>
                  <Badge variant={statusVariant(coaching.status)}>
                    {t(titleCase(coaching.status))}
                  </Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : null}
        {data.evidence.length === 0 && data.coachingSessions.length === 0 ? (
          <Card className="border-destructive/30">
            <CardContent className="flex items-center gap-3 text-destructive">
              <AlertTriangle className="size-5" />
              <p>{t("This PIP has no supporting evidence and cannot be considered complete.")}</p>
            </CardContent>
          </Card>
        ) : null}
      </section>

      {data.reviews.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Review history")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.reviews.map((review) => (
              <div key={review.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <UserRound className="size-4 text-primary" />
                    <span className="text-sm font-medium">{review.reviewer.name}</span>
                  </div>
                  <Badge variant={statusVariant(review.outcome ?? "PENDING")}>
                    {t(titleCase(review.outcome ?? "PENDING"))}
                  </Badge>
                </div>
                <p className="mt-2 text-sm">{review.summary}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatOperationalTimestamp(review.scheduledAt, timeZone)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
