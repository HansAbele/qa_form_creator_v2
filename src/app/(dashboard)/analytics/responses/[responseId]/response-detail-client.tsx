"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { questionTypeLabel } from "@/types/form-builder";
import {
  ArrowLeft,
  Ban,
  Calendar,
  ClipboardCheck,
  FileText,
  Hash,
  Mail,
  Pencil,
  Tag,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";
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
import { cancelResponseAction } from "@/server/actions/responses";
import { getResponseDetail } from "@/server/queries/analytics";

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

function scoreTone(result: string | null, status: string): string {
  if (status === "CANCELLED") return "text-muted-foreground";
  if (result === "PASS") return "text-emerald-600 dark:text-emerald-400";
  if (result === "FAIL") return "text-rose-600 dark:text-rose-400";
  return "text-amber-600 dark:text-amber-400";
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

export function ResponseDetailClient({ responseId }: { responseId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ResponseDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

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
  if (!data) return <EmptyState label="Evaluacion no encontrada" />;

  const handleCancel = async () => {
    const reason = window.prompt("Razon de anulacion");
    if (!reason?.trim()) return;

    setCancelling(true);
    try {
      const result = await cancelResponseAction({
        id: data.id,
        reason,
        expectedUpdatedAt: data.updatedAt,
      });
      if (!result.ok) throw new Error(result.error.message);
      toast.success("Evaluacion anulada");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al anular evaluacion");
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
                  <Badge variant={data.status === "CANCELLED" ? "destructive" : "outline"}>
                    {data.status}
                  </Badge>
                  {data.result && (
                    <Badge variant={data.result === "PASS" ? "default" : "destructive"}>
                      {data.result}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="text-left sm:text-right">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Score final
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
                    Editar
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                    onClick={handleCancel}
                    disabled={cancelling}
                  >
                    <Ban className="h-4 w-4" />
                    {cancelling ? "Anulando..." : "Anular"}
                  </Button>
                </div>
              )}

              {data.status === "CANCELLED" && data.cancellationReason && (
                <p className="max-w-xs text-sm text-muted-foreground">
                  Anulada: {data.cancellationReason}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard
          icon={<User className="h-5 w-5 text-orange-600 dark:text-orange-400" />}
          label="Agente"
          title={data.agent.name}
          detail={data.agent.agentCode ? `#${data.agent.agentCode}` : null}
          onClick={() => router.push(`/analytics/agents/${data.agent.id}`)}
        />
        <InfoCard
          icon={<Users className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
          label="Evaluador"
          title={data.evaluator.name}
          detail={data.evaluator.email}
          onClick={() => router.push(`/analytics/evaluators/${data.evaluator.id}`)}
        />
        <InfoCard
          icon={<Tag className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
          label="Disposicion"
          title={data.disposition?.name ?? "Sin disposicion"}
          detail={data.disposition?.code ? `#${data.disposition.code}` : null}
          onClick={
            data.disposition
              ? () => router.push(`/analytics/dispositions/${data.disposition?.id}`)
              : undefined
          }
        />
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
                  <TableHead className="w-[38%]">Pregunta</TableHead>
                  <TableHead>Categoria QA</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Respuesta</TableHead>
                  <TableHead className="text-right">Score QA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.answers.map((answer) => (
                  <TableRow key={answer.id}>
                    <TableCell className="align-top font-medium">
                      <div className="space-y-1">
                        <p>{answer.questionLabel}</p>
                        <div className="flex flex-wrap gap-1">
                          {answer.questionWeight > 0 && (
                            <Badge variant="outline" className="text-xs">
                              Peso {answer.questionWeight}%
                            </Badge>
                          )}
                          {answer.fatal && (
                            <Badge variant="destructive" className="text-xs">
                              Fatal
                            </Badge>
                          )}
                          {answer.requiresCommentOnFail && (
                            <Badge variant="secondary" className="text-xs">
                              Comentario si falla
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {answer.category ? (
                        <Badge variant="outline" className="gap-1.5 text-xs">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: answer.category.color ?? "#ff6600" }}
                          />
                          {answer.category.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin categoria</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {questionTypeLabel(answer.questionType)}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      {answer.notApplicable ? (
                        <Badge variant="secondary">N/A</Badge>
                      ) : answer.questionType === "RATING" ? (
                        <Badge
                          variant={
                            answer.score !== null ? scoreBadgeVariant(answer.score) : "secondary"
                          }
                          className="tabular-nums"
                        >
                          {answer.value} / {answer.ratingMax ?? 5}
                        </Badge>
                      ) : (
                        <span className="whitespace-pre-wrap text-sm">
                          {answer.value || <span className="text-muted-foreground italic">-</span>}
                        </span>
                      )}
                      {answer.comment && (
                        <p className="mt-2 whitespace-pre-wrap border-l-2 border-orange-500/50 pl-2 text-xs text-muted-foreground">
                          {answer.comment}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {answer.notApplicable ? (
                        <span className="text-xs text-muted-foreground">N/A</span>
                      ) : answer.score !== null ? (
                        <Badge
                          variant={
                            answer.isFatalFail ? "destructive" : scoreBadgeVariant(answer.score)
                          }
                          className="tabular-nums"
                        >
                          {answer.score.toFixed(1)}%
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">N/A</span>
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
