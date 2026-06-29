"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { getAgents } from "@/server/actions/agents";
import { saveResponseDraft, submitResponse } from "@/server/actions/responses";
import type { QuestionType } from "@prisma/client";
import { DispositionCombobox } from "./disposition-combobox";
import { QuestionRenderer } from "./question-renderer";

interface FormViewerProps {
  form: {
    id: string;
    title: string;
    description: string | null;
    campaignId: string;
    questions: {
      id: string;
      type: QuestionType;
      label: string;
      options: unknown;
      required: boolean;
      weight: number;
      fatal: boolean;
      fatalOptions: unknown;
      requiresCommentOnFail: boolean;
      order: number;
      formCategory?: {
        qaCategory?: {
          name: string;
        } | null;
      } | null;
    }[];
    campaign: { name: string };
  };
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

export function FormViewer({ form, initialResponse = null }: FormViewerProps) {
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

  const ratingQuestions = form.questions.filter((question) => question.type === "RATING");
  const applicableRatingQuestions = ratingQuestions.filter(
    (question) => !notApplicable[question.id],
  );
  const ratingWeightTotal = applicableRatingQuestions.reduce(
    (sum, question) => sum + question.weight,
    0,
  );
  const estimatedScore = calculateEstimatedScore(form.questions, answers, notApplicable);
  const hasCriticalRules = form.questions.some(
    (question) => question.fatal || question.requiresCommentOnFail,
  );
  const fatalCount = form.questions.filter(
    (question) =>
      !notApplicable[question.id] &&
      question.fatal &&
      isFailedQuestion(question, answers[question.id] ?? ""),
  ).length;
  const missingRequiredComments = form.questions.filter(
    (question) =>
      !notApplicable[question.id] &&
      question.requiresCommentOnFail &&
      isFailedQuestion(question, answers[question.id] ?? "") &&
      !comments[question.id]?.trim(),
  ).length;

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

      if (
        !notApplicable[question.id] &&
        question.requiresCommentOnFail &&
        isFailedQuestion(question, answers[question.id] ?? "") &&
        !comments[question.id]?.trim()
      ) {
        newCommentErrors[question.id] = "Este comentario es obligatorio cuando la regla falla";
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
    <Card>
      <CardHeader>
        <CardTitle>{form.title}</CardTitle>
        {form.description && <CardDescription>{form.description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Agente evaluado</Label>
          <Select value={agentId} onValueChange={(v) => v && setAgentId(v)}>
            <SelectTrigger className="w-full">
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

        <DispositionCombobox
          campaignId={form.campaignId}
          value={dispositionId}
          onChange={setDispositionId}
        />

        {(ratingQuestions.length > 0 || hasCriticalRules) && (
          <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-4 sm:grid-cols-3">
            <SummaryItem label="Score estimado" value={`${estimatedScore.toFixed(1)}%`} />
            <SummaryItem
              label="Peso configurado"
              value={applicableRatingQuestions.length > 0 ? `${ratingWeightTotal || 100}%` : "N/A"}
            />
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Reglas criticas</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant={fatalCount > 0 ? "destructive" : "secondary"}>
                  {fatalCount} fatal
                </Badge>
                <Badge variant={missingRequiredComments > 0 ? "destructive" : "outline"}>
                  {missingRequiredComments} comentario
                </Badge>
              </div>
            </div>
            {fatalCount > 0 && (
              <p className="flex items-center gap-2 text-sm text-destructive sm:col-span-3">
                <AlertTriangle className="h-4 w-4" />
                Hay fallas fatales marcadas en la evaluacion.
              </p>
            )}
          </div>
        )}

        <Separator />

        {form.questions.map((question) => (
          <QuestionRenderer
            key={question.id}
            question={question}
            value={answers[question.id] ?? ""}
            onChange={(value) => setAnswer(question.id, value)}
            comment={comments[question.id] ?? ""}
            onCommentChange={(value) => setComment(question.id, value)}
            notApplicable={Boolean(notApplicable[question.id])}
            onNotApplicableChange={(value) => setNotApplicable(question.id, value)}
            error={errors[question.id]}
            commentError={commentErrors[question.id]}
          />
        ))}

        <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-5 text-xs text-muted-foreground">
            {!isEditingSubmitted && lastSavedAt && `Borrador guardado ${lastSavedAt}`}
          </div>
          <div className="flex justify-end gap-3">
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
            <Button variant="outline" onClick={() => router.push("/forms")}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || savingDraft} className="gap-2">
              <Send className="h-4 w-4" />
              {submitting
                ? "Guardando..."
                : isEditingSubmitted
                  ? "Guardar cambios"
                  : "Enviar evaluacion"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function calculateEstimatedScore(
  questions: FormViewerProps["form"]["questions"],
  answers: Record<string, string>,
  notApplicable: Record<string, boolean>,
) {
  const ratingQuestions = questions.filter(
    (question) => question.type === "RATING" && !notApplicable[question.id],
  );
  if (ratingQuestions.length === 0) return 0;

  const totalWeight = ratingQuestions.reduce((sum, question) => sum + question.weight, 0);

  if (totalWeight > 0) {
    return ratingQuestions.reduce((sum, question) => {
      const ratingScore = getRatingScore(answers[question.id] ?? "");
      return sum + ratingScore * (question.weight / totalWeight);
    }, 0);
  }

  const totalValue = ratingQuestions.reduce(
    (sum, question) => sum + (Number(answers[question.id]) || 0),
    0,
  );

  return (totalValue / (ratingQuestions.length * 5)) * 100;
}

function getRatingScore(value: string) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 5) {
    return 0;
  }

  return (numericValue / 5) * 100;
}

function isFailedQuestion(question: { type: QuestionType; fatalOptions: unknown }, value: string) {
  if (!value) return false;
  if (question.type === "RATING") return getRatingScore(value) < 100;
  if (question.type === "SELECT" || question.type === "RADIO") {
    return getStringOptions(question.fatalOptions).includes(value);
  }

  return false;
}

function getStringOptions(options: unknown) {
  return Array.isArray(options)
    ? options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter(Boolean)
    : [];
}
