"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { submitResponse } from "@/server/actions/responses";
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
}

interface AgentOption {
  id: string;
  name: string;
  agentCode: string | null;
}

export function FormViewer({ form }: FormViewerProps) {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("");
  const [dispositionId, setDispositionId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const ratingQuestions = form.questions.filter((question) => question.type === "RATING");
  const ratingWeightTotal = ratingQuestions.reduce(
    (sum, question) => sum + question.weight,
    0,
  );
  const estimatedScore = calculateEstimatedScore(form.questions, answers);
  const fatalCount = form.questions.filter(
    (question) => question.fatal && isFailedRating(question, answers[question.id] ?? ""),
  ).length;
  const missingRequiredComments = form.questions.filter(
    (question) =>
      question.requiresCommentOnFail &&
      isFailedRating(question, answers[question.id] ?? "") &&
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
      if (question.required && !answers[question.id]?.trim()) {
        newErrors[question.id] = "Este campo es obligatorio";
      }

      if (
        question.requiresCommentOnFail &&
        isFailedRating(question, answers[question.id] ?? "") &&
        !comments[question.id]?.trim()
      ) {
        newCommentErrors[question.id] =
          "Este comentario es obligatorio cuando la regla falla";
      }
    }

    setErrors(newErrors);
    setCommentErrors(newCommentErrors);
    return (
      Object.keys(newErrors).length === 0 &&
      Object.keys(newCommentErrors).length === 0
    );
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      await submitResponse({
        formId: form.id,
        agentId,
        dispositionId,
        answers: form.questions.map((question) => ({
          questionId: question.id,
          value: answers[question.id] ?? "",
          comment: comments[question.id] ?? "",
        })),
      });
      toast.success("Evaluacion enviada correctamente");
      router.push("/forms");
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
                  return agent.agentCode
                    ? `${agent.name} (${agent.agentCode})`
                    : agent.name;
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

        {ratingQuestions.length > 0 && (
          <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-4 sm:grid-cols-3">
            <SummaryItem label="Score estimado" value={`${estimatedScore.toFixed(1)}%`} />
            <SummaryItem label="Peso configurado" value={`${ratingWeightTotal || 100}%`} />
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
            error={errors[question.id]}
            commentError={commentErrors[question.id]}
          />
        ))}

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={() => router.push("/forms")}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Enviando..." : "Enviar evaluacion"}
          </Button>
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
) {
  const ratingQuestions = questions.filter((question) => question.type === "RATING");
  if (ratingQuestions.length === 0) return 0;

  const totalWeight = ratingQuestions.reduce(
    (sum, question) => sum + question.weight,
    0,
  );

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

function isFailedRating(question: { type: QuestionType }, value: string) {
  return question.type === "RATING" && Boolean(value) && getRatingScore(value) < 100;
}
