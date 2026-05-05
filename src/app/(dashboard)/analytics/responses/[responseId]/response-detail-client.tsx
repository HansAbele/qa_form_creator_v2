"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Award,
  Calendar,
  ClipboardCheck,
  FileText,
  Hash,
  Mail,
  Tag,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getResponseDetail } from "@/server/queries/analytics";

interface Answer {
  id: string;
  questionLabel: string;
  questionType: string;
  value: string;
}

interface ResponseDetailData {
  id: string;
  score: number;
  createdAt: string;
  form: { id: string; title: string };
  agent: {
    id: string;
    name: string;
    agentCode: string | null;
    campaignName: string;
  };
  evaluator: { id: string; name: string; email: string };
  disposition: { id: string; name: string; code: string | null } | null;
  answers: Answer[];
}

function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

function scoreTone(score: number): string {
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function questionTypeLabel(type: string): string {
  switch (type) {
    case "RATING":
      return "Calificación";
    case "TEXT":
      return "Texto";
    case "BOOLEAN":
      return "Sí/No";
    case "SELECT":
      return "Selección";
    case "MULTISELECT":
      return "Múltiple";
    default:
      return type;
  }
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

function EmptyState({ label = "Sin datos" }: { label?: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function ResponseDetailClient({
  responseId,
}: {
  responseId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<ResponseDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getResponseDetail(responseId);
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [responseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading && !data) return <LoadingSkeleton />;
  if (!data) return <EmptyState label="Evaluación no encontrada" />;

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="mb-4 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
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
                      {new Date(data.createdAt).toLocaleString("es-ES", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </Badge>
                    <Badge variant="secondary">{data.agent.campaignName}</Badge>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-1 sm:items-end">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Score Final
                </span>
                <span
                  className={`font-heading text-5xl font-bold tabular-nums ${scoreTone(data.score)}`}
                >
                  {data.score.toFixed(1)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card
          className="cursor-pointer transition-colors hover:bg-muted/40"
          onClick={() => router.push(`/analytics/agents/${data.agent.id}`)}
        >
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
                <User className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Agente
                </p>
                <p className="truncate font-medium">{data.agent.name}</p>
                {data.agent.agentCode && (
                  <p className="text-xs text-muted-foreground">
                    <Hash className="mr-0.5 inline h-3 w-3" />
                    {data.agent.agentCode}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-colors hover:bg-muted/40"
          onClick={() => router.push(`/analytics/evaluators/${data.evaluator.id}`)}
        >
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                <Users className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Evaluador
                </p>
                <p className="truncate font-medium">{data.evaluator.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <Mail className="mr-0.5 inline h-3 w-3" />
                  {data.evaluator.email}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={
            data.disposition
              ? "cursor-pointer transition-colors hover:bg-muted/40"
              : ""
          }
          onClick={
            data.disposition
              ? () => router.push(`/analytics/dispositions/${data.disposition!.id}`)
              : undefined
          }
        >
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
                <Tag className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Disposición
                </p>
                {data.disposition ? (
                  <>
                    <p className="truncate font-medium">{data.disposition.name}</p>
                    {data.disposition.code && (
                      <p className="text-xs text-muted-foreground">
                        <Hash className="mr-0.5 inline h-3 w-3" />
                        {data.disposition.code}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Sin disposición</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-slate-500" />
            Respuestas ({data.answers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.answers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50%]">Pregunta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Respuesta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.answers.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="align-top font-medium">
                      {a.questionLabel}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {questionTypeLabel(a.questionType)}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      {a.questionType === "RATING" ? (
                        <Badge
                          variant={scoreBadgeVariant((Number(a.value) / 5) * 100)}
                          className="tabular-nums"
                        >
                          {a.value} / 5
                        </Badge>
                      ) : a.questionType === "BOOLEAN" ? (
                        <Badge
                          variant={a.value === "true" ? "default" : "destructive"}
                        >
                          {a.value === "true" ? "Sí" : "No"}
                        </Badge>
                      ) : (
                        <span className="whitespace-pre-wrap text-sm">
                          {a.value || <span className="text-muted-foreground italic">—</span>}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState label="Sin respuestas" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
