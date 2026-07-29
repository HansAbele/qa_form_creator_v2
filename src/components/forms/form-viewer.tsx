"use client";

import type { QuestionType } from "@prisma/client";
import { AlertTriangle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type InteractionMediaContext,
  InteractionMediaPanel,
} from "@/components/call-finder/interaction-media-panel";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
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
import {
  APP_NAVIGATION_REQUEST_EVENT,
  type AppNavigationRequestEvent,
  consumeDocumentUnloadPermission,
  requestAppNavigation,
} from "@/lib/navigation-guard";
import {
  computeScore,
  type ScoringAnswer,
  type ScoringQuestion,
  type WeightedOption,
} from "@/lib/scoring";
import { cn } from "@/lib/utils";
import { getAgentsForEvaluation } from "@/server/actions/agents";
import { saveResponseDraftAction, submitResponseAction } from "@/server/actions/responses";
import type { RatingStyleValue } from "@/types/form-builder";
import { DispositionCombobox } from "./disposition-combobox";
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
    questions: ViewerQuestion[];
    campaign: { name: string };
  };
  passThreshold: number;
  fatalZeroesScore: boolean;
  canManageDispositions: boolean;
  initialResponse?: {
    id: string;
    updatedAt: string;
    status: string;
    agentId: string;
    dispositionId: string | null;
    agent: AgentOption;
    disposition: {
      id: string;
      name: string;
      code: string | null;
      category: null;
    } | null;
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

export function FormViewer({
  form,
  passThreshold,
  fatalZeroesScore,
  canManageDispositions,
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
  const initialDisposition = initialResponse?.disposition ?? linkedInteraction?.disposition ?? null;
  const [agents, setAgents] = useState<AgentOption[]>(initialAgent ? [initialAgent] : []);
  const [agentId, setAgentId] = useState(
    initialResponse?.agentId ?? linkedInteraction?.agent?.id ?? "",
  );
  const [dispositionId, setDispositionId] = useState(
    initialResponse?.dispositionId ?? linkedInteraction?.disposition?.id ?? "",
  );
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [comments, setComments] = useState<Record<string, string>>(initialComments);
  const [notApplicable, setNotApplicableState] =
    useState<Record<string, boolean>>(initialNotApplicable);
  const [draftId, setDraftId] = useState(
    initialResponse?.status === "DRAFT" ? initialResponse.id : "",
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [lastSavedPayload, setLastSavedPayload] = useState("");
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [autosaveRevision, setAutosaveRevision] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const [contextErrors, setContextErrors] = useState<{
    agent?: string;
    disposition?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const autosaveInitializedRef = useRef(false);
  const draftIdRef = useRef(draftId);
  const responseVersionRef = useRef(initialResponse?.updatedAt ?? null);
  const clientResponseIdRef = useRef(crypto.randomUUID());
  const draftSavePromiseRef = useRef<Promise<string | null> | null>(null);
  const autosaveQueuedRef = useRef(false);
  const mountedRef = useRef(true);

  const isEditingSubmitted = initialResponse?.status === "SUBMITTED";
  const preservesMissingHistoricalDisposition =
    isEditingSubmitted && initialResponse?.dispositionId === null && !dispositionId;

  const scoringQuestions = useMemo(() => form.questions.map(toScoringQuestion), [form.questions]);

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

  const buildPayload = useCallback(
    (responseId?: string) => ({
      ...(responseId ? { responseId } : {}),
      ...(responseId && responseVersionRef.current
        ? { expectedUpdatedAt: responseVersionRef.current }
        : {}),
      ...(!responseId ? { clientResponseId: clientResponseIdRef.current } : {}),
      formId: form.id,
      agentId,
      dispositionId: dispositionId || null,
      interactionId: linkedInteraction?.id ?? null,
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
      dispositionId,
      form.id,
      form.questions,
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
  const hasLocalDraftContent = Boolean(
    draftId || agentId || dispositionId || hasLocalAnswerContent,
  );
  const canPersistDraft = Boolean(agentId && dispositionId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (autosaveInitializedRef.current) return;
    autosaveInitializedRef.current = true;
    if (initialResponse) {
      setLastSavedPayload(JSON.stringify(buildPayload(initialResponse.id)));
    }
  }, [buildPayload, initialResponse]);

  const handleSaveDraft = useCallback(
    ({ silent = false }: { silent?: boolean } = {}): Promise<string | null> => {
      if (isEditingSubmitted) return Promise.resolve(null);
      if (!agentId || !dispositionId) {
        if (!silent) toast.error(t("Select an agent and disposition before saving a draft"));
        return Promise.resolve(null);
      }
      if (draftSavePromiseRef.current) return draftSavePromiseRef.current;

      setSavingDraft(true);
      setDraftSaveError(null);
      const operation = (async () => {
        try {
          const currentDraftId = draftIdRef.current || undefined;
          const result = await saveResponseDraftAction(buildPayload(currentDraftId));
          if (!result.ok) throw new Error(result.error.message);
          const response = result.data;
          const savedDraftId = response.id;
          draftIdRef.current = savedDraftId;
          responseVersionRef.current = response.updatedAt;
          if (mountedRef.current) {
            if (response.replayed) {
              // The create reached the database but its response was lost. Recover its
              // identity/version, then queue a versioned update for the current payload.
              autosaveQueuedRef.current = true;
            } else {
              setLastSavedPayload(JSON.stringify(buildPayload(savedDraftId)));
            }
            if (!currentDraftId) {
              setDraftId(savedDraftId);
              window.history.replaceState(null, "", `/forms/${form.id}?responseId=${savedDraftId}`);
            }
            if (!response.replayed) {
              setLastSavedAt(
                formatOperationalTimestamp(
                  new Date(),
                  operationalTimeZone,
                  { timeStyle: "short" },
                  locale === "es" ? "es-ES" : "en-US",
                ),
              );
            }
            if (!silent) {
              toast.success(
                response.replayed
                  ? t("Draft recovered; confirming current changes")
                  : t("Draft saved"),
              );
            }
          }
          return savedDraftId;
        } catch (error) {
          const message = error instanceof Error ? t(error.message) : t("Unable to save draft");
          if (mountedRef.current) {
            setDraftSaveError(message);
            if (!silent) {
              toast.error(message);
            }
          }
          return null;
        }
      })();

      draftSavePromiseRef.current = operation;
      void operation.finally(() => {
        if (draftSavePromiseRef.current === operation) {
          draftSavePromiseRef.current = null;
        }
        if (mountedRef.current) setSavingDraft(false);
        if (autosaveQueuedRef.current) {
          autosaveQueuedRef.current = false;
          if (mountedRef.current) setAutosaveRevision((revision) => revision + 1);
        }
      });

      return operation;
    },
    [
      agentId,
      buildPayload,
      dispositionId,
      form.id,
      isEditingSubmitted,
      locale,
      operationalTimeZone,
      t,
    ],
  );

  useEffect(() => {
    // A queued edit increments this revision to re-arm autosave after the active request settles.
    void autosaveRevision;
    if (isEditingSubmitted || submitting || !canPersistDraft) return;

    const payload = JSON.stringify(buildPayload(draftId || undefined));
    if (payload === lastSavedPayload) return;

    const timeout = window.setTimeout(() => {
      if (draftSavePromiseRef.current) {
        autosaveQueuedRef.current = true;
        return;
      }
      void handleSaveDraft({ silent: true });
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [
    autosaveRevision,
    buildPayload,
    canPersistDraft,
    draftId,
    handleSaveDraft,
    isEditingSubmitted,
    lastSavedPayload,
    submitting,
  ]);

  const currentResponseId = draftId || initialResponse?.id || undefined;
  const currentPayload = JSON.stringify(buildPayload(currentResponseId));
  const hasUnsavedChanges = hasLocalDraftContent && currentPayload !== lastSavedPayload;

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
    const newContextErrors: { agent?: string; disposition?: string } = {};

    if (!agentId) {
      newContextErrors.agent = t("Select an agent.");
    }

    if (!dispositionId && !preservesMissingHistoricalDisposition) {
      newContextErrors.disposition = t("Select a disposition.");
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
        : newContextErrors.disposition
          ? "evaluation-disposition"
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
      let responseId = draftIdRef.current || initialResponse?.id;
      if (!isEditingSubmitted) {
        const pendingSave = draftSavePromiseRef.current;
        if (pendingSave) {
          const pendingDraftId = await pendingSave;
          if (!pendingDraftId) {
            throw new Error(t("The draft could not be confirmed before submission"));
          }
          responseId = pendingDraftId;
        }

        if (hasUnsavedChanges || !responseId) {
          const flushedDraftId = await handleSaveDraft({ silent: true });
          if (!flushedDraftId) {
            throw new Error(t("The draft could not be saved before submission"));
          }
          responseId = flushedDraftId;
        }
      }

      const result = await submitResponseAction({
        ...buildPayload(responseId),
      });
      if (!result.ok) throw new Error(result.error.message);
      const response = result.data;
      responseVersionRef.current = response.updatedAt;
      setLastSavedPayload(JSON.stringify(buildPayload(response.id)));
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

  const handleCancel = () => {
    if (draftSavePromiseRef.current) {
      toast.info(t("Wait for the draft to finish saving"));
      return;
    }
    if (hasUnsavedChanges && !window.confirm(t("You have unsaved changes. Leave anyway?"))) {
      return;
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
        {linkedInteraction ? (
          <InteractionMediaPanel interaction={linkedInteraction} compact />
        ) : null}
        {/* Context bar */}
        <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
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
            <DispositionCombobox
              id="evaluation-disposition"
              key={form.campaignId}
              campaignId={form.campaignId}
              value={dispositionId}
              onChange={(value) => {
                setDispositionId(value);
                setContextErrors((current) => ({ ...current, disposition: undefined }));
              }}
              canManageDispositions={canManageDispositions}
              initialDisposition={initialDisposition}
              error={contextErrors.disposition}
              disabled={Boolean(linkedInteraction?.disposition)}
            />
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
                    index={`${group.index + 1}.${i + 1}`}
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

        <div className="flex items-center justify-between pt-1">
          <span
            className={cn(
              "min-h-5 text-xs",
              draftSaveError ? "text-destructive" : "text-muted-foreground",
            )}
            role={draftSaveError ? "alert" : "status"}
            aria-live="polite"
          >
            {!isEditingSubmitted && draftSaveError
              ? t("Unsaved draft: {error}", { error: draftSaveError })
              : savingDraft
                ? t("Saving draft...")
                : hasUnsavedChanges
                  ? canPersistDraft
                    ? t("Changes waiting to be saved")
                    : t("Select an agent and disposition to save changes")
                  : lastSavedAt
                    ? t("Draft saved at {time}", { time: lastSavedAt })
                    : null}
          </span>
          {!isEditingSubmitted && (
            <Button
              variant="outline"
              onClick={() => void handleSaveDraft()}
              disabled={savingDraft || submitting}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {savingDraft ? t("Saving...") : t("Save draft")}
            </Button>
          )}
        </div>
      </fieldset>

      {/* Right — sticky summary */}
      <div className="lg:sticky lg:top-[82px] lg:w-[328px] lg:shrink-0">
        <EvaluationSummary
          scoreResult={scoreResult}
          categories={categoryInfos}
          totalQuestions={form.questions.length}
          answeredQuestions={answeredQuestions}
          submitting={submitting}
          savingDraft={savingDraft}
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
