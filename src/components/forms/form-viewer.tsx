"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { computeScore, type ScoringAnswer, type ScoringQuestion, type WeightedOption } from "@/lib/scoring";
import { getAgents } from "@/server/actions/agents";
import { saveResponseDraft, submitResponse } from "@/server/actions/responses";
import type { QuestionType } from "@prisma/client";
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
  initialResponse?: {
    id: string;
    status: string;
    agentId: string;
    dispositionId: string | null;
    answers: {
      questionId: string;
      value: string;
      comment: string | null;
      notApplicable: boolean;
    }[];
  } | null;
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
    categoryId: question.formCategory?.qaCategory?.id ?? question.formCategory?.qaCategoryId ?? null,
    ratingFailThreshold: question.ratingFailThreshold ?? null,
    ratingMax: question.ratingMax ?? null,
    weightedOptions: getWeightedOptions(question.options),
  };
}

export function FormViewer({ form, passThreshold, initialResponse = null }: FormViewerProps) {
  const router = useRouter();
  const initialAnswers = Object.fromEntries(
    (initialResponse?.answers ?? []).map((answer) => [answer.questionId, answer.value]),
  );
  const initialComments = Object.fromEntries(
    (initialResponse?.answers ?? []).map((answer) => [answer.questionId, answer.comment ?? ""]),
  );
  const initialNotApplicable = Object.fromEntries(
    (initialResponse?.answers ?? []).map((answer) => [answer.questionId, answer.notApplicable]),
  );
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState(initialResponse?.agentId ?? "");
  const [dispositionId, setDispositionId] = useState(initialResponse?.dispositionId ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [comments, setComments] = useState<Record<string, string>>(initialComments);
  const [notApplicable, setNotApplicableState] =
    useState<Record<string, boolean>>(initialNotApplicable);
  const [draftId, setDraftId] = useState(
    initialResponse?.status === "DRAFT" ? initialResponse.id : "",
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const lastAutosavePayloadRef = useRef("");

  const isEditingSubmitted = initialResponse?.status === "SUBMITTED";

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
    return computeScore(scoringQuestions, map, { passThreshold });
  }, [scoringQuestions, form.questions, answers, comments, notApplicable, passThreshold]);

  const failedByQuestion = useMemo(
    () => new Map(scoreResult.questions.map((q) => [q.questionId, q.failed])),
    [scoreResult],
  );

  const categoryGroups = useMemo(() => groupByCategory(form.questions), [form.questions]);
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
    getAgents(form.campaignId).then((data) => {
      setAgents(data.filter((a) => a.active));
    });
  }, [form.campaignId]);

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
      formId: form.id,
      agentId,
      dispositionId,
      answers: form.questions.map((question) => ({
        questionId: question.id,
        value: notApplicable[question.id] ? "" : (answers[question.id] ?? ""),
        comment: comments[question.id] ?? "",
        notApplicable: Boolean(notApplicable[question.id]),
      })),
    }),
    [agentId, answers, comments, dispositionId, form.id, form.questions, notApplicable],
  );

  const hasDraftableContent = useCallback(() => {
    return (
      Boolean(agentId && dispositionId) &&
      form.questions.some(
        (question) =>
          Boolean(answers[question.id]?.trim()) ||
          Boolean(comments[question.id]?.trim()) ||
          Boolean(notApplicable[question.id]),
      )
    );
  }, [agentId, answers, comments, dispositionId, form.questions, notApplicable]);

  const handleSaveDraft = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (isEditingSubmitted) return;
      if (!agentId || !dispositionId) {
        if (!silent) toast.error("Selecciona agente y disposicion antes de guardar borrador");
        return;
      }

      setSavingDraft(true);
      try {
        const response = await saveResponseDraft(buildPayload(draftId || undefined));
        if (!draftId) {
          setDraftId(response.id);
          router.replace(`/forms/${form.id}?responseId=${response.id}`, { scroll: false });
        }
        setLastSavedAt(new Date().toLocaleTimeString("es-ES", { timeStyle: "short" }));
        if (!silent) toast.success("Borrador guardado");
      } catch (error) {
        if (!silent) {
          toast.error(error instanceof Error ? error.message : "Error al guardar borrador");
        }
      } finally {
        setSavingDraft(false);
      }
    },
    [agentId, buildPayload, dispositionId, draftId, form.id, isEditingSubmitted, router],
  );

  useEffect(() => {
    if (isEditingSubmitted || !hasDraftableContent()) return;

    const payload = JSON.stringify(buildPayload(draftId || undefined));
    if (payload === lastAutosavePayloadRef.current) return;

    const timeout = window.setTimeout(() => {
      lastAutosavePayloadRef.current = payload;
      void handleSaveDraft({ silent: true });
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [buildPayload, draftId, handleSaveDraft, hasDraftableContent, isEditingSubmitted]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    const newCommentErrors: Record<string, string> = {};

    if (!agentId) {
      toast.error("Selecciona un agente");
      return false;
    }

    if (!dispositionId) {
      toast.error("Selecciona una disposicion");
      return false;
    }

    for (const question of form.questions) {
      if (question.required && !notApplicable[question.id] && !answers[question.id]?.trim()) {
        newErrors[question.id] = "Este campo es obligatorio";
      }
    }

    for (const questionScore of scoreResult.questions) {
      if (questionScore.needsComment) {
        newCommentErrors[questionScore.questionId] =
          "Este comentario es obligatorio cuando la regla falla";
      }
    }

    setErrors(newErrors);
    setCommentErrors(newCommentErrors);
    return Object.keys(newErrors).length === 0 && Object.keys(newCommentErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      await submitResponse({
        ...buildPayload(draftId || initialResponse?.id),
      });
      toast.success(isEditingSubmitted ? "Evaluacion actualizada" : "Evaluacion enviada");
      router.push(isEditingSubmitted ? `/analytics/responses/${initialResponse?.id}` : "/forms");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al enviar");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Left — form */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Context bar */}
        <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Agente evaluado</Label>
              <Select value={agentId} onValueChange={(v) => v && setAgentId(v)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Seleccionar agente...">
                    {(value: string | null) => {
                      if (!value) return "Seleccionar agente...";
                      const agent = agents.find((a) => a.id === value);
                      if (!agent) return "Seleccionar agente...";
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
            </div>
            <div className="space-y-1">
              <DispositionCombobox
                campaignId={form.campaignId}
                value={dispositionId}
                onChange={setDispositionId}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Campana</Label>
              <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
                {form.campaign.name}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Fecha</Label>
              <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm capitalize">
                {format(new Date(), "d MMM yyyy", { locale: es })}
              </div>
            </div>
        </div>

        {/* Fatal banner */}
        {hasFatal && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/40 border-l-4 border-l-destructive bg-destructive-tint p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-heading font-semibold text-destructive">
                Se detecto una falla fatal
              </p>
              <p className="text-sm text-muted-foreground">
                La evaluacion se enviara como FAIL. Revisa las preguntas marcadas y agrega los
                comentarios requeridos.
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
            <Card key={group.id}>
              <div
                className="flex flex-wrap items-center gap-2 rounded-t-xl border-b border-border px-4 py-3"
                style={{ backgroundColor: tintFor(group.color) }}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: group.color ?? "hsl(var(--primary))" }}
                />
                <span className="font-heading text-sm font-semibold">{group.name}</span>
                {weightPct > 0 && (
                  <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs font-medium tabular-nums">
                    Peso {weightPct.toFixed(0)}%
                  </span>
                )}
                {weightPct > 0 && (
                  <span className="ml-auto text-sm font-semibold tabular-nums text-muted-foreground">
                    {earnedPct.toFixed(0)}% / {weightPct.toFixed(0)}%
                  </span>
                )}
              </div>
              <CardContent className="space-y-3 p-4">
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
                    ratingStyle={question.ratingStyle}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}

        <div className="flex items-center justify-between pt-1">
          <span className="min-h-5 text-xs text-muted-foreground">
            {!isEditingSubmitted && lastSavedAt && `Borrador guardado ${lastSavedAt}`}
          </span>
          {!isEditingSubmitted && (
            <Button
              variant="outline"
              onClick={() => handleSaveDraft()}
              disabled={savingDraft || submitting}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              {savingDraft ? "Guardando..." : "Guardar borrador"}
            </Button>
          )}
        </div>
      </div>

      {/* Right — sticky summary */}
      <div className="lg:sticky lg:top-[82px] lg:w-[328px] lg:shrink-0">
        <EvaluationSummary
          scoreResult={scoreResult}
          categories={categoryInfos}
          totalQuestions={form.questions.length}
          answeredQuestions={answeredQuestions}
          submitting={submitting}
          isEditing={isEditingSubmitted}
          onSubmit={handleSubmit}
          onCancel={() => router.push("/forms")}
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

function groupByCategory(questions: ViewerQuestion[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const question of questions) {
    const id = question.formCategory?.qaCategory?.id ?? question.formCategory?.qaCategoryId ?? "none";
    const existing = groups.get(id);
    if (existing) {
      existing.questions.push(question);
    } else {
      groups.set(id, {
        id,
        index: groups.size,
        name: question.formCategory?.qaCategory?.name ?? "Sin categoria",
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
