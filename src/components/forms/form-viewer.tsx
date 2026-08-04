"use client";

import type { QuestionType } from "@prisma/client";
import { AlertTriangle, ClipboardCheck, Clock3, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type InteractionMediaContext,
  InteractionMediaPanel,
} from "@/components/call-finder/interaction-media-panel";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatOperationalTimestamp } from "@/lib/date-display";
import { formDisplayName } from "@/lib/form-display-name";
import {
  APP_NAVIGATION_REQUEST_EVENT,
  type AppNavigationRequestEvent,
  consumeDocumentUnloadPermission,
  requestAppNavigation,
} from "@/lib/navigation-guard";
import {
  HAPUSA_SCORECARD_KEY,
  isOfficialScorecardKey,
  PARKER_DAVIS_SCORECARD_KEY,
  parseOfficialQuestionLabel,
} from "@/lib/official-form-templates";
import { createRuntimeUuid } from "@/lib/runtime-uuid";
import {
  computeScore,
  type ScoringAnswer,
  type ScoringQuestion,
  type WeightedOption,
} from "@/lib/scoring";
import { cn } from "@/lib/utils";
import { getAgentsForEvaluation } from "@/server/actions/agents";
import {
  pauseEvaluationActivityAction,
  startEvaluationActivityAction,
  submitResponseAction,
} from "@/server/actions/responses";
import type { RatingStyleValue } from "@/types/form-builder";
import { EvaluationSummary } from "./evaluation-summary";
import { QuestionRenderer } from "./question-renderer";

type ViewerQuestion = {
  id: string;
  type: QuestionType;
  label: string;
  options: unknown;
  required: boolean;
  weight: number;
  fatal: boolean;
  fatalOptions: unknown;
  ratingFailThreshold: number | null;
  ratingMax: number | null;
  ratingStyle: string | null;
  requiresCommentOnFail: boolean;
  order: number;
  formCategory?: {
    qaCategoryId: string | null;
    weight?: number;
    sortOrder?: number;
    qaCategory?: {
      id: string;
      name: string;
      systemColor?: string | null;
    } | null;
  } | null;
};

interface FormViewerProps {
  form: {
    id: string;
    title: string;
    description: string | null;
    campaignId: string;
    templateKey: string | null;
    templateVersion: string | null;
    gradingScale: unknown;
    questions: ViewerQuestion[];
    campaign: { name: string };
  };
  passThreshold: number;
  fatalZeroesScore: boolean;
  initialResponse?: {
    id: string;
    updatedAt: string;
    status: string;
    agentId: string;
    agent: AgentOption;
    answers: {
      questionId: string;
      value: string;
      comment: string | null;
      notApplicable: boolean;
    }[];
  } | null;
  linkedInteraction?:
    | (InteractionMediaContext & {
        agent: AgentOption | null;
        disposition: {
          id: string;
          name: string;
          code: string | null;
          category: null;
        } | null;
      })
    | null;
}

interface AgentOption {
  id: string;
  name: string;
  agentCode: string | null;
}

function getStringOptions(options: unknown): string[] {
  return Array.isArray(options)
    ? options
        .map((option) =>
          typeof option === "string"
            ? option
            : option && typeof option === "object" && "value" in option
              ? String((option as { value: unknown }).value)
              : "",
        )
        .map((option) => option.trim())
        .filter(Boolean)
    : [];
}

function getWeightedOptions(options: unknown): WeightedOption[] | null {
  if (!Array.isArray(options)) return null;
  const weighted = options.filter(
    (o): o is { value: unknown; points: unknown } =>
      Boolean(o) && typeof o === "object" && "value" in o && "points" in o,
  );
  if (weighted.length === 0) return null;
  return weighted.map((o) => ({ value: String(o.value), points: Number(o.points) || 0 }));
}

function toScoringQuestion(question: ViewerQuestion): ScoringQuestion {
  return {
    id: question.id,
    type: question.type,
    weight: question.weight,
    fatal: question.fatal,
    fatalOptions: getStringOptions(question.fatalOptions),
    requiresCommentOnFail: question.requiresCommentOnFail,
    categoryId:
      question.formCategory?.qaCategory?.id ?? question.formCategory?.qaCategoryId ?? null,
    ratingFailThreshold: question.ratingFailThreshold ?? null,
    ratingMax: question.ratingMax ?? null,
    weightedOptions: getWeightedOptions(question.options),
  };
}

function formatTimerDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function FormViewer({
  form,
  passThreshold,
  fatalZeroesScore,
  initialResponse = null,
  linkedInteraction = null,
}: FormViewerProps) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const operationalTimeZone = useOperationalTimeZone();
  const initialAnswers = Object.fromEntries(
    (initialResponse?.answers ?? []).map((answer) => [answer.questionId, answer.value]),
  );
  const initialComments = Object.fromEntries(
    (initialResponse?.answers ?? []).map((answer) => [answer.questionId, answer.comment ?? ""]),
  );
  const initialNotApplicable = Object.fromEntries(
    (initialResponse?.answers ?? []).map((answer) => [answer.questionId, answer.notApplicable]),
  );
  const initialAgent = initialResponse?.agent ?? linkedInteraction?.agent ?? null;
  const [agents, setAgents] = useState<AgentOption[]>(initialAgent ? [initialAgent] : []);
  const [agentId, setAgentId] = useState(
    initialResponse?.agentId ?? linkedInteraction?.agent?.id ?? "",
  );
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [comments, setComments] = useState<Record<string, string>>(initialComments);
  const [notApplicable, setNotApplicableState] =
    useState<Record<string, boolean>>(initialNotApplicable);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const [contextErrors, setContextErrors] = useState<{
    agent?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [evaluationActivity, setEvaluationActivity] = useState<{
    id: string;
    status: string;
    totalSeconds: number;
    openIntervalStartedAt: string;
  } | null>(null);
  const [evaluationTimerError, setEvaluationTimerError] = useState<string | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const activityStartRequestedRef = useRef(false);
  const responseVersionRef = useRef(initialResponse?.updatedAt ?? null);
  const clientResponseIdRef = useRef(createRuntimeUuid());
  const initialEvaluationContentRef = useRef(
    JSON.stringify({
      agentId: initialResponse?.agentId ?? linkedInteraction?.agent?.id ?? "",
      answers: initialAnswers,
      comments: initialComments,
      notApplicable: initialNotApplicable,
    }),
  );

  const isEditingSubmitted = initialResponse?.status === "SUBMITTED";
  const scoringQuestions = useMemo(() => form.questions.map(toScoringQuestion), [form.questions]);
  const isParkerDavisScorecard = form.templateKey === PARKER_DAVIS_SCORECARD_KEY;
  const isHapusaScorecard = form.templateKey === HAPUSA_SCORECARD_KEY;
  const isOfficialScorecard = isOfficialScorecardKey(form.templateKey);
  const partsWarrantyQuestionIds = useMemo(
    () =>
      form.questions
        .filter((question) => parseOfficialQuestionLabel(question.label).partsWarranty)
        .map((question) => question.id),
    [form.questions],
  );
  const partsWarrantyDisabled =
    partsWarrantyQuestionIds.length > 0 &&
    partsWarrantyQuestionIds.every((questionId) => notApplicable[questionId]);

  const scoreResult = useMemo(() => {
    const map = new Map<string, ScoringAnswer>();
    for (const question of form.questions) {
      map.set(question.id, {
        value: answers[question.id] ?? "",
        notApplicable: Boolean(notApplicable[question.id]),
        comment: comments[question.id] ?? "",
      });
    }
    return computeScore(scoringQuestions, map, { passThreshold, fatalZeroesScore });
  }, [
    scoringQuestions,
    form.questions,
    answers,
    comments,
    notApplicable,
    passThreshold,
    fatalZeroesScore,
  ]);

  const failedByQuestion = useMemo(
    () => new Map(scoreResult.questions.map((q) => [q.questionId, q.failed])),
    [scoreResult],
  );

  const categoryGroups = useMemo(
    () => groupByCategory(form.questions, t("No category")),
    [form.questions, t],
  );
  const categoryInfos = useMemo(
    () =>
      categoryGroups.map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color,
      })),
    [categoryGroups],
  );

  const answeredQuestions = form.questions.filter(
    (question) =>
      notApplicable[question.id] ||
      (question.type !== "TEXT" ? Boolean(answers[question.id]?.trim()) : true),
  ).length;

  const hasFatal = scoreResult.hasFatalFail;

  useEffect(() => {
    getAgentsForEvaluation(form.campaignId).then((data) => {
      const historicalAgent = initialResponse?.agent;
      setAgents(
        historicalAgent && !data.some((agent) => agent.id === historicalAgent.id)
          ? [historicalAgent, ...data]
          : data,
      );
    });
  }, [form.campaignId, initialResponse?.agent]);

  useEffect(() => {
    if (activityStartRequestedRef.current) return;
    activityStartRequestedRef.current = true;
    void startEvaluationActivityAction({
      formId: form.id,
      responseId: initialResponse?.id,
      interactionId: linkedInteraction?.id,
    })
      .then((activity) => {
        setEvaluationActivity(activity);
        setEvaluationTimerError(null);
      })
      .catch((error) => {
        setEvaluationTimerError(
          error instanceof Error ? t(error.message) : t("Evaluation timer unavailable"),
        );
      });
  }, [form.id, initialResponse?.id, linkedInteraction?.id, t]);

  useEffect(() => {
    if (!evaluationActivity) return;
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [evaluationActivity]);

  const trackedEvaluationSeconds = evaluationActivity
    ? evaluationActivity.totalSeconds +
      Math.max(
        0,
        Math.floor(
          (timerNow - new Date(evaluationActivity.openIntervalStartedAt).getTime()) / 1_000,
        ),
      )
    : 0;

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    if (errors[questionId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  };

  const setComment = (questionId: string, value: string) => {
    setComments((prev) => ({ ...prev, [questionId]: value }));
    if (commentErrors[questionId]) {
      setCommentErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  };

  const setNotApplicable = (questionId: string, value: boolean) => {
    setNotApplicableState((prev) => ({ ...prev, [questionId]: value }));
    if (value) {
      setAnswers((prev) => ({ ...prev, [questionId]: "" }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
      setCommentErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  };

  const togglePartsWarrantyApplicability = () => {
    const markNotApplicable = !partsWarrantyDisabled;
    const questionIds = new Set(partsWarrantyQuestionIds);
    setNotApplicableState((previous) => {
      const next = { ...previous };
      for (const questionId of questionIds) next[questionId] = markNotApplicable;
      return next;
    });
    if (markNotApplicable) {
      setAnswers((previous) => {
        const next = { ...previous };
        for (const questionId of questionIds) next[questionId] = "";
        return next;
      });
      setErrors((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([questionId]) => !questionIds.has(questionId)),
        ),
      );
      setCommentErrors((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([questionId]) => !questionIds.has(questionId)),
        ),
      );
    }
  };

  const buildPayload = useCallback(
    (responseId?: string) => ({
      ...(responseId ? { responseId } : {}),
      ...(responseId && responseVersionRef.current
        ? { expectedUpdatedAt: responseVersionRef.current }
        : {}),
      ...(!responseId ? { clientResponseId: clientResponseIdRef.current } : {}),
      formId: form.id,
      agentId,
      interactionId: linkedInteraction?.id ?? null,
      ...(evaluationActivity ? { evaluationActivityId: evaluationActivity.id } : {}),
      answers: form.questions.map((question) => ({
        questionId: question.id,
        value: notApplicable[question.id] ? "" : (answers[question.id] ?? ""),
        comment: comments[question.id] ?? "",
        notApplicable: Boolean(notApplicable[question.id]),
      })),
    }),
    [
      agentId,
      answers,
      comments,
      form.id,
      form.questions,
      evaluationActivity,
      linkedInteraction?.id,
      notApplicable,
    ],
  );

  const hasLocalAnswerContent = form.questions.some(
    (question) =>
      Boolean(answers[question.id]?.trim()) ||
      Boolean(comments[question.id]?.trim()) ||
      Boolean(notApplicable[question.id]),
  );
  const hasLocalEvaluationContent = Boolean(agentId || hasLocalAnswerContent);
  const currentEvaluationContent = JSON.stringify({
    agentId,
    answers,
    comments,
    notApplicable,
  });
  const hasUnsavedChanges =
    hasLocalEvaluationContent && currentEvaluationContent !== initialEvaluationContentRef.current;

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (consumeDocumentUnloadPermission()) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const guardAppNavigation = (event: Event) => {
      const request = event as AppNavigationRequestEvent;
      if (request.detail.allowed && !window.confirm(t("You have unsaved changes. Leave anyway?"))) {
        request.detail.allowed = false;
      }
    };

    window.addEventListener(APP_NAVIGATION_REQUEST_EVENT, guardAppNavigation);
    return () => window.removeEventListener(APP_NAVIGATION_REQUEST_EVENT, guardAppNavigation);
  }, [hasUnsavedChanges, t]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const guardInternalNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.download) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (
        !requestAppNavigation({
          documentUnload: destination.origin !== window.location.origin,
        })
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener("click", guardInternalNavigation, true);
    return () => document.removeEventListener("click", guardInternalNavigation, true);
  }, [hasUnsavedChanges]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    const newCommentErrors: Record<string, string> = {};
    const newContextErrors: { agent?: string } = {};

    if (!agentId) {
      newContextErrors.agent = t("Select an agent.");
    }

    for (const question of form.questions) {
      if (question.required && !notApplicable[question.id] && !answers[question.id]?.trim()) {
        newErrors[question.id] = t("This field is required");
      }
    }

    for (const questionScore of scoreResult.questions) {
      if (questionScore.needsComment) {
        newCommentErrors[questionScore.questionId] = t(
          "A comment is required when this rule fails",
        );
      }
    }

    setErrors(newErrors);
    setCommentErrors(newCommentErrors);
    setContextErrors(newContextErrors);
    const valid =
      Object.keys(newContextErrors).length === 0 &&
      Object.keys(newErrors).length === 0 &&
      Object.keys(newCommentErrors).length === 0;

    if (!valid) {
      toast.error(t("Review the highlighted fields before submitting."));
      const firstInvalidId = newContextErrors.agent
        ? "evaluation-agent"
        : Object.keys(newErrors)[0]
          ? `${Object.keys(newErrors)[0]}-answer`
          : Object.keys(newCommentErrors)[0]
            ? `${Object.keys(newCommentErrors)[0]}-comment`
            : null;
      requestAnimationFrame(() => {
        if (!firstInvalidId) return;
        const control = document.getElementById(firstInvalidId);
        const focusTarget = control?.matches('[role="radiogroup"], fieldset')
          ? control.querySelector<HTMLElement>('[role="radio"], input[type="radio"]')
          : control;
        focusTarget?.focus();
        control?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }

    return valid;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await submitResponseAction({
        ...buildPayload(initialResponse?.id),
      });
      if (!result.ok) throw new Error(result.error.message);
      const response = result.data;
      responseVersionRef.current = response.updatedAt;
      toast.success(isEditingSubmitted ? t("Evaluation updated") : t("Evaluation submitted"));
      router.push(
        isEditingSubmitted
          ? `/evaluations/${initialResponse?.id}`
          : linkedInteraction
            ? `/evaluations/${response.id}`
            : "/forms",
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to submit evaluation"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (hasUnsavedChanges && !window.confirm(t("You have unsaved changes. Leave anyway?"))) {
      return;
    }
    if (evaluationActivity?.status === "ACTIVE") {
      try {
        await pauseEvaluationActivityAction({
          activitySessionId: evaluationActivity.id,
        });
      } catch (error) {
        toast.error(error instanceof Error ? t(error.message) : t("Evaluation timer unavailable"));
        return;
      }
    }
    router.push(linkedInteraction ? `/call-finder/${linkedInteraction.id}` : "/forms");
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Left — form */}
      <fieldset
        disabled={submitting}
        aria-busy={submitting}
        className="m-0 min-w-0 flex-1 space-y-4 border-0 p-0"
      >
        {isOfficialScorecard && (
          <section
            className={cn(
              "overflow-hidden rounded-2xl border bg-card shadow-sm",
              isHapusaScorecard ? "border-teal-800/25" : "border-[#003366]/25",
            )}
          >
            <div
              className={cn(
                "px-5 py-5 text-white sm:px-6",
                isHapusaScorecard ? "bg-teal-800" : "bg-[#003366]",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-white/25 bg-white/10 text-white hover:bg-white/10">
                      <ClipboardCheck className="mr-1 size-3.5" />
                      {t("Official scorecard")}
                    </Badge>
                  </div>
                  <h2 className="font-heading text-2xl font-bold tracking-tight">
                    {formDisplayName(form.title)}
                  </h2>
                  {form.description && (
                    <p className="max-w-3xl text-sm text-white/80">{form.description}</p>
                  )}
                </div>
                <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-right">
                  <p className="text-xs font-medium uppercase tracking-wider text-white/70">
                    {t("Passing score")}
                  </p>
                  <p className="font-heading text-3xl font-bold tabular-nums">{passThreshold}%</p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
              <div className="space-y-2 text-sm">
                <p className="flex items-start gap-2 text-muted-foreground">
                  <ShieldCheck
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      isHapusaScorecard ? "text-teal-700" : "text-destructive",
                    )}
                  />
                  <span>
                    {isHapusaScorecard
                      ? t(
                          "Use the exact partial-point choices for every criterion. A final score of 95% or higher passes the official HAPUSA quality standard.",
                        )
                      : t(
                          "Any critical failure forces FAIL regardless of the total score. Award full points when the entire procedure is correct; otherwise award half points.",
                        )}
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {isHapusaScorecard ? (
                    <>
                      <Badge variant="outline">95–100 · {t("Pass")}</Badge>
                      <Badge variant="outline">&lt;95 · {t("Needs Improvement")}</Badge>
                    </>
                  ) : (
                    <>
                      <Badge variant="outline">95–100 · {t("Pass (Excellent)")}</Badge>
                      <Badge variant="outline">90–94.9 · {t("Acceptable")}</Badge>
                      <Badge variant="outline">80–89.9 · {t("Needs Improvement")}</Badge>
                      <Badge variant="outline">70–79.9 · {t("Below Standard")}</Badge>
                      <Badge variant="outline">&lt;70 · {t("Unsatisfactory")}</Badge>
                    </>
                  )}
                </div>
              </div>
              {isParkerDavisScorecard && partsWarrantyQuestionIds.length > 0 && (
                <Button
                  type="button"
                  variant={partsWarrantyDisabled ? "default" : "outline"}
                  onClick={togglePartsWarrantyApplicability}
                  className="border-[#2E75B6]/40"
                >
                  {partsWarrantyDisabled ? t("Apply P&W checks") : t("This call is not P&W")}
                </Button>
              )}
            </div>
          </section>
        )}
        {linkedInteraction ? (
          <InteractionMediaPanel interaction={linkedInteraction} compact />
        ) : null}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3",
            evaluationTimerError
              ? "border-destructive/30 bg-destructive/5"
              : "border-emerald-600/25 bg-emerald-500/5",
          )}
        >
          <div className="flex items-center gap-2">
            <Clock3
              className={cn(
                "size-4",
                evaluationTimerError ? "text-destructive" : "text-emerald-600",
              )}
            />
            <div>
              <p className="text-sm font-semibold">{t("Evaluation timer")}</p>
              <p className="text-xs text-muted-foreground">
                {evaluationTimerError
                  ? evaluationTimerError
                  : evaluationActivity
                    ? t("Time is recorded automatically in QA Activity.")
                    : t("Starting secure timer...")}
              </p>
            </div>
          </div>
          <Badge variant={evaluationTimerError ? "destructive" : "outline"} className="font-mono">
            {evaluationActivity ? formatTimerDuration(trackedEvaluationSeconds) : "00:00:00"}
          </Badge>
        </div>
        {/* Context bar */}
        <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="evaluation-agent" className="text-xs text-muted-foreground">
              {t("Evaluated Agent")}
            </Label>
            <Select
              value={agentId}
              disabled={Boolean(linkedInteraction?.agent)}
              onValueChange={(value) => {
                if (!value) return;
                setAgentId(value);
                setContextErrors((current) => ({ ...current, agent: undefined }));
              }}
            >
              <SelectTrigger
                id="evaluation-agent"
                aria-describedby={contextErrors.agent ? "evaluation-agent-error" : undefined}
                aria-invalid={Boolean(contextErrors.agent)}
                aria-required="true"
                className="h-10 w-full"
              >
                <SelectValue placeholder={t("Select an agent...")}>
                  {(value: string | null) => {
                    if (!value) return t("Select an agent...");
                    const agent = agents.find((a) => a.id === value);
                    if (!agent) return t("Select an agent...");
                    return agent.agentCode ? `${agent.name} (${agent.agentCode})` : agent.name;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.agentCode && ` (${agent.agentCode})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contextErrors.agent ? (
              <p id="evaluation-agent-error" role="alert" className="text-xs text-destructive">
                {contextErrors.agent}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("Campaign")}</p>
            <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
              {form.campaign.name}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("Date")}</p>
            <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm capitalize">
              {formatOperationalTimestamp(
                linkedInteraction ? new Date(linkedInteraction.startedAt) : new Date(),
                operationalTimeZone,
                { day: "numeric", month: "short", year: "numeric" },
                locale === "es" ? "es-ES" : "en-US",
              )}
            </div>
          </div>
        </div>

        {/* Fatal banner */}
        {hasFatal && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/40 border-l-4 border-l-destructive bg-destructive-tint p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-heading font-semibold text-destructive">
                {t("Critical failure detected")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t(
                  "The evaluation will be submitted as FAIL. Review the flagged questions and add the required comments.",
                )}
              </p>
            </div>
          </div>
        )}

        {/* Category sections */}
        {categoryGroups.map((group) => {
          const cat = scoreResult.perCategory.find((c) => c.categoryId === group.id);
          const totalWeight = scoreResult.perCategory.reduce((sum, c) => sum + c.weight, 0) || 100;
          const earnedPct = cat ? (cat.earned / totalWeight) * 100 : 0;
          const weightPct = cat ? (cat.weight / totalWeight) * 100 : 0;
          return (
            <section key={group.id} className="space-y-3">
              <div
                className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 shadow-sm ring-1 ring-border/60 ring-inset"
                style={{ backgroundColor: tintFor(group.color) }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: group.color ?? "hsl(var(--primary))" }}
                />
                <span className="font-heading text-sm font-semibold">{group.name}</span>
                {weightPct > 0 && (
                  <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs font-medium tabular-nums">
                    {t("Weight {weight}%", { weight: weightPct.toFixed(0) })}
                  </span>
                )}
                {weightPct > 0 && (
                  <span className="ml-auto text-sm font-semibold tabular-nums text-muted-foreground">
                    {earnedPct.toFixed(0)}% / {weightPct.toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="space-y-3">
                {group.questions.map((question, i) => (
                  <QuestionRenderer
                    key={question.id}
                    question={question}
                    index={isParkerDavisScorecard ? undefined : `${group.index + 1}.${i + 1}`}
                    value={answers[question.id] ?? ""}
                    onChange={(value) => setAnswer(question.id, value)}
                    comment={comments[question.id] ?? ""}
                    onCommentChange={(value) => setComment(question.id, value)}
                    notApplicable={Boolean(notApplicable[question.id])}
                    onNotApplicableChange={(value) => setNotApplicable(question.id, value)}
                    error={errors[question.id]}
                    commentError={commentErrors[question.id]}
                    failed={failedByQuestion.get(question.id) ?? false}
                    ratingMax={question.ratingMax ?? undefined}
                    ratingStyle={question.ratingStyle as RatingStyleValue | null}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </fieldset>

      {/* Right — sticky summary */}
      <div className="lg:sticky lg:top-[82px] lg:w-[328px] lg:shrink-0">
        <EvaluationSummary
          scoreResult={scoreResult}
          gradingScale={form.gradingScale}
          categories={categoryInfos}
          totalQuestions={form.questions.length}
          answeredQuestions={answeredQuestions}
          submitting={submitting}
          isEditing={isEditingSubmitted}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

interface CategoryGroup {
  id: string;
  index: number;
  name: string;
  color: string | null;
  questions: ViewerQuestion[];
}

function groupByCategory(questions: ViewerQuestion[], uncategorizedLabel: string): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const question of questions) {
    const id =
      question.formCategory?.qaCategory?.id ?? question.formCategory?.qaCategoryId ?? "none";
    const existing = groups.get(id);
    if (existing) {
      existing.questions.push(question);
    } else {
      groups.set(id, {
        id,
        index: groups.size,
        name: question.formCategory?.qaCategory?.name ?? uncategorizedLabel,
        color: question.formCategory?.qaCategory?.systemColor ?? null,
        questions: [question],
      });
    }
  }
  return Array.from(groups.values());
}

/** Soft translucent tint from a category color for section headers. */
function tintFor(color: string | null): string {
  if (!color) return "hsl(var(--muted) / 0.5)";
  return `color-mix(in srgb, ${color} 12%, transparent)`;
}
