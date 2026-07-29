"use client";

import {
  ArrowLeft,
  Ban,
  Calendar,
  ClipboardCheck,
  FileText,
  Hash,
  Mail,
  MessageSquareText,
  Pencil,
  ShieldAlert,
  Tag,
  User,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type InteractionMediaContext,
  InteractionMediaPanel,
} from "@/components/call-finder/interaction-media-panel";
import {
  DataLoadError,
  type DataLoadStatus,
  RestrictedResourceState,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatOperationalTimestamp } from "@/lib/date-display";
import { cancelResponseAction } from "@/server/actions/responses";
import { getResponseDetail } from "@/server/queries/analytics";
import { questionTypeLabel } from "@/types/form-builder";

interface Answer {
  id: string;
  questionLabel: string;
  questionType: string;
  value: string;
  category: { id: string; name: string; color: string | null; icon: string | null } | null;
  score: number | null;
  comment: string | null;
  isFatalFail: boolean;
  notApplicable: boolean;
  questionWeight: number;
  fatal: boolean;
  requiresCommentOnFail: boolean;
  ratingMax: number | null;
}

interface ResponseDetailData {
  id: string;
  score: number;
  result: string | null;
  hasFatalFail: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  canEdit: boolean;
  canOpenAnalytics: boolean;
  form: { id: string; title: string };
  agent: {
    id: string;
    name: string;
    agentCode: string | null;
    campaignName: string;
  };
  evaluator: { id: string; name: string };
  disposition: { id: string; name: string; code: string | null } | null;
  interaction: InteractionMediaContext | null;
  answers: Answer[];
}

function scoreTone(result: string | null, status: string): string {
  if (status === "CANCELLED") return "text-muted-foreground";
  if (result === "PASS") return "text-emerald-600 dark:text-emerald-400";
  if (result === "FAIL") return "text-rose-600 dark:text-rose-400";
  return "text-amber-600 dark:text-amber-400";
}

function getEarnedPoints(answer: Answer): number {
  if (answer.notApplicable || answer.score === null) return 0;
  return (answer.score / 100) * answer.questionWeight;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-[400px] rounded-xl" />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function ResponseDetailClient({ responseId }: { responseId: string }) {
  const { locale, t } = useI18n();
  const operationalTimeZone = useOperationalTimeZone();
  const router = useRouter();
  const [data, setData] = useState<ResponseDetailData | null>(null);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const [cancelling, setCancelling] = useState(false);
  const requestGeneration = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");
    try {
      const result = await getResponseDetail(responseId);
      if (requestId !== requestGeneration.current) return;
      setData(result);
      setLoadStatus(result ? "success" : "empty");
    } catch (e) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(e, "response-detail");
      setLoadStatus("error");
    }
  }, [responseId]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  if (loadStatus === "loading" && !data) return <LoadingSkeleton />;
  if (loadStatus === "error") {
    return (
      <DataLoadError onRetry={() => void loadData()} title={t("We couldn't load the evaluation")} />
    );
  }
  if (loadStatus === "empty" || !data) {
    return <RestrictedResourceState resourceLabel={t("This evaluation")} />;
  }

  const answerGroups = groupAnswersByCategory(data.answers, t("No category"));

  const handleCancel = async () => {
    const reason = window.prompt(t("Cancellation reason"));
    if (!reason?.trim()) return;

    setCancelling(true);
    try {
      const result = await cancelResponseAction({
        id: data.id,
        reason,
        expectedUpdatedAt: data.updatedAt,
      });
      if (!result.ok) throw new Error(result.error.message);
      toast.success(t("Evaluation cancelled"));
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to cancel evaluation"));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("Back")}
      </Button>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 ring-1 ring-orange-500/20">
                <ClipboardCheck className="h-8 w-8 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{data.form.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary" className="gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatOperationalTimestamp(
                      data.submittedAt ?? data.createdAt,
                      operationalTimeZone,
                      {
                        dateStyle: "medium",
                        timeStyle: "short",
                      },
                      locale === "es" ? "es-ES" : "en-US",
                    )}
                  </Badge>
                  <Badge variant="secondary">{data.agent.campaignName}</Badge>
                  <Badge variant={data.status === "CANCELLED" ? "destructive" : "outline"}>
                    {data.status === "CANCELLED"
                      ? t("Cancelled")
                      : data.status === "SUBMITTED"
                        ? t("Submitted")
                        : data.status === "DRAFT"
                          ? t("Draft")
                          : data.status}
                  </Badge>
                  {data.result && (
                    <Badge variant={data.result === "PASS" ? "default" : "destructive"}>
                      {data.result}
                    </Badge>
                  )}
                  {data.hasFatalFail && (
                    <Badge variant="destructive" className="gap-1">
                      <ShieldAlert className="h-3 w-3" />
                      {t("Critical failure triggered")}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="text-left sm:text-right">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("Final Score")}
                </span>
                <div
                  className={`font-heading text-5xl font-bold tabular-nums ${scoreTone(
                    data.result,
                    data.status,
                  )}`}
                >
                  {data.score.toFixed(1)}%
                </div>
              </div>

              {data.canEdit && data.status !== "CANCELLED" && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => router.push(`/forms/${data.form.id}?responseId=${data.id}`)}
                  >
                    <Pencil className="h-4 w-4" />
                    {t("Edit")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                    onClick={handleCancel}
                    disabled={cancelling}
                  >
                    <Ban className="h-4 w-4" />
                    {cancelling ? t("Cancelling...") : t("Cancel evaluation")}
                  </Button>
                </div>
              )}

              {data.status === "CANCELLED" && data.cancellationReason && (
                <p className="max-w-xs text-sm text-muted-foreground">
                  {t("Cancelled: {reason}", { reason: data.cancellationReason })}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {data.interaction ? <InteractionMediaPanel interaction={data.interaction} /> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard
          icon={<User className="h-5 w-5 text-orange-600 dark:text-orange-400" />}
          label={t("Agent")}
          title={data.agent.name}
          detail={data.agent.agentCode ? `#${data.agent.agentCode}` : null}
          onClick={
            data.canOpenAnalytics
              ? () => router.push(`/analytics/agents/${data.agent.id}`)
              : undefined
          }
        />
        <InfoCard
          icon={<Users className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
          label={t("Evaluator")}
          title={data.evaluator.name}
          detail={null}
          onClick={
            data.canOpenAnalytics
              ? () => router.push(`/analytics/evaluators/${data.evaluator.id}`)
              : undefined
          }
        />
        <InfoCard
          icon={<Tag className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
          label={t("Disposition")}
          title={data.disposition?.name ?? t("No disposition")}
          detail={data.disposition?.code ? `#${data.disposition.code}` : null}
          onClick={
            data.disposition && data.canOpenAnalytics
              ? () => router.push(`/analytics/dispositions/${data.disposition?.id}`)
              : undefined
          }
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="size-5 text-primary" />
          <h2 className="font-heading text-xl font-semibold">
            {t("Answers ({count})", { count: data.answers.length })}
          </h2>
        </div>
        {answerGroups.length > 0 ? (
          answerGroups.map((group) => {
            const possiblePoints = group.answers.reduce(
              (total, answer) => total + (answer.notApplicable ? 0 : answer.questionWeight),
              0,
            );
            const categoryEarnedPoints = group.answers.reduce(
              (total, answer) => total + getEarnedPoints(answer),
              0,
            );
            const categoryPercent =
              possiblePoints > 0
                ? Math.round((categoryEarnedPoints / possiblePoints) * 1000) / 10
                : null;

            return (
              <Card key={group.id} className="overflow-hidden">
                <CardHeader
                  className="border-b"
                  style={{ backgroundColor: `${group.color ?? "#ff6600"}14` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: group.color ?? "#ff6600" }}
                      />
                      {group.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {group.answers.length} {t("questions")}
                      </Badge>
                      <Badge className="tabular-nums">
                        {categoryPercent == null
                          ? "N/A"
                          : `${categoryEarnedPoints.toFixed(1)} / ${possiblePoints.toFixed(1)} ${t("pts")} · ${categoryPercent.toFixed(1)}%`}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  {group.answers.map((answer, index) => (
                    <article key={answer.id} className="space-y-4 p-5 sm:p-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t("Question {number}", { number: index + 1 })}
                          </p>
                          <h3 className="text-base font-semibold leading-6">
                            {answer.questionLabel}
                          </h3>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="outline">
                              {t(questionTypeLabel(answer.questionType))}
                            </Badge>
                            {answer.fatal ? (
                              <Badge variant="destructive">{t("Critical")}</Badge>
                            ) : null}
                            {answer.notApplicable ? (
                              <Badge variant="secondary">{t("Not applicable")}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 rounded-xl border bg-background px-4 py-3 text-right">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {t("Points scored")}
                          </p>
                          <p
                            className={`font-heading text-xl font-bold tabular-nums ${
                              answer.isFatalFail
                                ? "text-destructive"
                                : answer.score !== null && answer.score >= 100
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {answer.notApplicable || answer.score === null
                              ? "N/A"
                              : `${getEarnedPoints(answer).toFixed(1)} / ${answer.questionWeight.toFixed(1)}`}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                        <div className="rounded-xl border bg-muted/25 p-4">
                          <p className="text-xs font-medium text-muted-foreground">{t("Answer")}</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-6">
                            {answer.notApplicable ? "N/A" : answer.value || "—"}
                            {answer.questionType === "RATING" && !answer.notApplicable
                              ? ` / ${answer.ratingMax ?? 5}`
                              : ""}
                          </p>
                        </div>
                        <div className="rounded-xl border bg-muted/25 p-4">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <MessageSquareText className="size-3.5" />
                            {t("QA Comment")}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                            {answer.comment || (
                              <span className="italic text-muted-foreground">
                                {t("No comment recorded")}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card>
            <CardContent>
              <EmptyState label={t("No answers")} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function groupAnswersByCategory(answers: Answer[], fallbackName: string) {
  const groups = new Map<
    string,
    { id: string; name: string; color: string | null; answers: Answer[] }
  >();
  for (const answer of answers) {
    const id = answer.category?.id ?? "uncategorized";
    const group = groups.get(id) ?? {
      id,
      name: answer.category?.name ?? fallbackName,
      color: answer.category?.color ?? null,
      answers: [],
    };
    group.answers.push(answer);
    groups.set(id, group);
  }
  return [...groups.values()];
}

function InfoCard({
  icon,
  label,
  title,
  detail,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  detail: string | null;
  onClick?: () => void;
}) {
  return (
    <Card
      className={onClick ? "cursor-pointer transition-colors hover:bg-muted/40" : ""}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="truncate font-medium">{title}</p>
            {detail && (
              <p className="truncate text-xs text-muted-foreground">
                {detail.startsWith("#") ? (
                  <Hash className="mr-0.5 inline h-3 w-3" />
                ) : (
                  <Mail className="mr-0.5 inline h-3 w-3" />
                )}
                {detail}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
