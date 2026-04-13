"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { QuestionRenderer } from "./question-renderer";
import { DispositionCombobox } from "./disposition-combobox";
import { getAgents } from "@/server/actions/agents";
import { submitResponse } from "@/server/actions/responses";
import type { QuestionType } from "@prisma/client";

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
      order: number;
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

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

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!agentId) {
      toast.error("Selecciona un agente");
      return false;
    }

    if (!dispositionId) {
      toast.error("Selecciona una disposición");
      return false;
    }

    for (const q of form.questions) {
      if (q.required && !answers[q.id]?.trim()) {
        newErrors[q.id] = "Este campo es obligatorio";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      await submitResponse({
        formId: form.id,
        agentId,
        dispositionId,
        answers: form.questions.map((q) => ({
          questionId: q.id,
          value: answers[q.id] ?? "",
        })),
      });
      toast.success("Evaluación enviada correctamente");
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

        <Separator />

        {form.questions.map((question) => (
          <QuestionRenderer
            key={question.id}
            question={question}
            value={answers[question.id] ?? ""}
            onChange={(value) => setAnswer(question.id, value)}
            error={errors[question.id]}
          />
        ))}

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={() => router.push("/forms")}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Enviando..." : "Enviar evaluación"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
