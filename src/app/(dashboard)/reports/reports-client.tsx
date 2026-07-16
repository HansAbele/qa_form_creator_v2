"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getReportData, getReportResponseDetail } from "@/server/queries/analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, ChevronLeft, ChevronRight, Download, Eye, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { OUTCOME_LABELS } from "@/lib/disposition-outcome";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { formatOperationalTimestamp } from "@/lib/date-display";

type ReportPage = Awaited<ReturnType<typeof getReportData>>;
type ReportResponse = ReportPage["items"][number];
type ReportDetail = Awaited<ReturnType<typeof getReportResponseDetail>>;

interface ReportsClientProps {
  campaigns: { id: string; name: string }[];
  forms: { id: string; title: string; campaignId: string }[];
  dispositions: { id: string; name: string; campaignId: string; campaignName: string }[];
  canExport: boolean;
}

const CRITICAL_LABEL: Record<string, string> = {
  CUSTOMER: "Customer",
  BUSINESS: "Business",
  COMPLIANCE: "Compliance",
};

const REPORT_SUMMARY_SKELETONS = [
  "evaluations",
  "average-score",
  "pass-rate",
  "daily-rate",
  "fatal-failures",
] as const;

export function ReportsClient({
  campaigns,
  forms,
  dispositions,
  canExport,
}: ReportsClientProps) {
  const operationalTimeZone = useOperationalTimeZone();
  const [campaignId, setCampaignId] = useState("");
  const [formId, setFormId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    campaignId: "",
    formId: "",
    dateFrom: "",
    dateTo: "",
  });
  const [reportPage, setReportPage] = useState<ReportPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<ReportDetail | null>(null);
  const [resultFilter, setResultFilter] = useState<"all" | "PASS" | "FAIL">("all");
  const [fatalOnly, setFatalOnly] = useState(false);
  const [dispositionFilter, setDispositionFilter] = useState("all");
  const reportRequestGeneration = useRef(0);
  const detailRequestGeneration = useRef(0);
  const router = useRouter();

  const filteredForms = campaignId ? forms.filter((f) => f.campaignId === campaignId) : forms;
  const dispositionOptions = campaignId
    ? dispositions.filter((disposition) => disposition.campaignId === campaignId)
    : dispositions;

  const loadReports = useCallback(async () => {
    const requestId = ++reportRequestGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getReportData({
        campaignId: appliedFilters.campaignId || undefined,
        formId: appliedFilters.formId || undefined,
        dateFrom: appliedFilters.dateFrom || undefined,
        dateTo: appliedFilters.dateTo || undefined,
        dispositionId: dispositionFilter === "all" ? undefined : dispositionFilter,
        resultStatus: resultFilter === "all" ? undefined : resultFilter,
        fatalOnly,
        page,
      });
      if (requestId !== reportRequestGeneration.current) return;
      setReportPage(data);
      if (page > data.totalPages) setPage(data.totalPages);
    } catch {
      if (requestId !== reportRequestGeneration.current) return;
      setReportPage(null);
      setError("No fue posible cargar los reportes. Intenta nuevamente.");
    } finally {
      if (requestId === reportRequestGeneration.current) setLoading(false);
    }
  }, [appliedFilters, dispositionFilter, fatalOnly, page, resultFilter]);

  useEffect(() => {
    void loadReports();
    return () => {
      reportRequestGeneration.current += 1;
    };
  }, [loadReports]);

  useEffect(
    () => () => {
      detailRequestGeneration.current += 1;
    },
    [],
  );

  const handleSearch = () => {
    setPage(1);
    setAppliedFilters({ campaignId, formId, dateFrom, dateTo });
  };

  const openDetail = async (responseId: string) => {
    const requestId = ++detailRequestGeneration.current;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setSelectedResponse(null);
    try {
      const result = await getReportResponseDetail(responseId);
      if (requestId !== detailRequestGeneration.current) return;
      setSelectedResponse(result);
    } catch {
      if (requestId !== detailRequestGeneration.current) return;
      setDetailError("No fue posible cargar el detalle de la evaluacion.");
    } finally {
      if (requestId === detailRequestGeneration.current) setDetailLoading(false);
    }
  };

  const responses: ReportResponse[] = reportPage?.items ?? [];
  const summary = reportPage?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Reportes</h1>
        {canExport && (
          <Button variant="outline" onClick={() => router.push("/analytics/export")}>
            <Download className="mr-1 h-4 w-4" />
            Exportar
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="reports-campaign" className="text-xs">
                Campaña
              </Label>
              <Select
                value={campaignId || "all"}
                onValueChange={(v) => {
                  if (!v) return;
                  setCampaignId(v === "all" ? "" : v);
                  setFormId("");
                  setDispositionFilter("all");
                }}
              >
                <SelectTrigger id="reports-campaign" className="w-44">
                  <SelectValue placeholder="Todas">
                    {(value: string | null) => {
                      if (!value || value === "all") return "Todas";
                      return campaigns.find((c) => c.id === value)?.name ?? "Todas";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reports-form" className="text-xs">
                Formulario
              </Label>
              <Select
                value={formId || "all"}
                onValueChange={(v) => v && setFormId(v === "all" ? "" : v)}
              >
                <SelectTrigger id="reports-form" className="w-52">
                  <SelectValue placeholder="Todos">
                    {(value: string | null) => {
                      if (!value || value === "all") return "Todos";
                      return filteredForms.find((f) => f.id === value)?.title ?? "Todos";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {filteredForms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reports-date-from" className="text-xs">
                Desde
              </Label>
              <Input
                id="reports-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reports-date-to" className="text-xs">
                Hasta
              </Label>
              <Input
                id="reports-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={handleSearch} disabled={loading}>
              <Search className="mr-1 h-4 w-4" />
              {loading ? "Buscando..." : "Buscar"}
            </Button>
          </div>
          {/* Server-side refinements keep totals and pagination coherent. */}
          <div className="mt-3 flex flex-wrap items-end gap-4 border-t pt-3">
            <div className="space-y-1">
              <Label htmlFor="reports-result" className="text-xs">
                Resultado
              </Label>
              <Select
                value={resultFilter}
                onValueChange={(v) => {
                  if (!v) return;
                  setPage(1);
                  setResultFilter(v as "all" | "PASS" | "FAIL");
                }}
              >
                <SelectTrigger id="reports-result" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="PASS">Solo Pass</SelectItem>
                  <SelectItem value="FAIL">Solo Fail</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reports-disposition" className="text-xs">
                Disposición
              </Label>
              <Select
                value={dispositionFilter}
                onValueChange={(v) => {
                  if (!v) return;
                  setPage(1);
                  setDispositionFilter(v);
                }}
              >
                <SelectTrigger id="reports-disposition" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {dispositionOptions.map((disposition) => (
                    <SelectItem key={disposition.id} value={disposition.id}>
                      {disposition.name} · {disposition.campaignName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Label
              htmlFor="reports-fatal-only"
              className="flex cursor-pointer items-center gap-2 pb-2 text-sm"
            >
              <input
                id="reports-fatal-only"
                type="checkbox"
                checked={fatalOnly}
                onChange={(e) => {
                  setPage(1);
                  setFatalOnly(e.target.checked);
                }}
                className="h-4 w-4 rounded border-input"
              />
              Solo fatales
            </Label>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span className="flex-1">{error}</span>
          <Button variant="outline" size="sm" onClick={() => void loadReports()}>
            Reintentar
          </Button>
        </div>
      )}

      {/* Summary */}
      {loading && !summary ? (
        <div
          role="status"
          aria-label="Cargando indicadores del reporte"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          {REPORT_SUMMARY_SKELETONS.map((skeleton) => (
            <Card key={skeleton} aria-hidden="true">
              <CardContent className="space-y-3 p-4">
                <Skeleton className="mx-auto h-4 w-24" />
                <Skeleton className="mx-auto h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-busy={loading}>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Evaluaciones</p>
              <p className="text-2xl font-bold">{summary.totalEvaluations}</p>
            </CardContent>
          </Card>
          <Card
            className={
              summary.avgScore >= summary.targetAvgScore ? "border-green-200" : "border-red-200"
            }
          >
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Score Promedio</p>
              <p className="text-2xl font-bold">{summary.avgScore.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Target: {summary.targetAvgScore}%</p>
            </CardContent>
          </Card>
          <Card
            className={
              summary.passRate >= summary.targetPassRate ? "border-green-200" : "border-red-200"
            }
          >
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Pass Rate</p>
              <p className="text-2xl font-bold">{summary.passRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Target: {summary.targetPassRate}%</p>
            </CardContent>
          </Card>
          <Card
            className={
              summary.dailyRate >= summary.targetDailyRate
                ? "border-green-200"
                : "border-amber-200"
            }
          >
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Tasa Diaria</p>
              <p className="text-2xl font-bold">{summary.dailyRate.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">
                Target: {summary.targetDailyRate}/día
              </p>
            </CardContent>
          </Card>
          <Card
            className={
              summary.fatalFailCount <= summary.fatalFailuresAllowed
                ? "border-green-200"
                : "border-red-200"
            }
          >
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Fatales</p>
              <p className="text-2xl font-bold">{summary.fatalFailCount}</p>
              <p className="text-xs text-muted-foreground">
                Permitidas: {summary.fatalFailuresAllowed}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {reportPage && reportPage.totalCount > 0 && (
        <p className="text-sm text-muted-foreground">
          Mostrando <span className="font-medium text-foreground">{(reportPage.page - 1) * reportPage.pageSize + 1}–{Math.min(reportPage.page * reportPage.pageSize, reportPage.totalCount)}</span> de{" "}
          {reportPage.totalCount} evaluaciones
        </p>
      )}

      {/* Results Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Campaña</TableHead>
              <TableHead>Formulario</TableHead>
              <TableHead>Agente</TableHead>
              <TableHead>Evaluador</TableHead>
              <TableHead>Disposición</TableHead>
              <TableHead>Score</TableHead>
              <TableHead className="w-16">Detalle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {responses.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatOperationalTimestamp(r.createdAt, operationalTimeZone, {
                    dateStyle: "short",
                  })}
                </TableCell>
                <TableCell className="max-w-[150px] truncate">{r.campaignName}</TableCell>
                <TableCell>
                  {r.formTitle}
                  {r.formVersion && (
                    <span className="ml-1 text-xs text-muted-foreground">v{r.formVersion}</span>
                  )}
                </TableCell>
                <TableCell>
                  {r.agentName}
                  {r.agentCode && (
                    <span className="ml-1 text-xs text-muted-foreground">({r.agentCode})</span>
                  )}
                </TableCell>
                <TableCell>{r.evaluatorName}</TableCell>
                <TableCell>
                  {r.dispositionName ? (
                    <div className="flex flex-col">
                      <span className="max-w-[150px] truncate">{r.dispositionName}</span>
                      {r.dispositionOutcome && (
                        <span className="text-xs text-muted-foreground">
                          {OUTCOME_LABELS[r.dispositionOutcome as keyof typeof OUTCOME_LABELS] ??
                            r.dispositionOutcome}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={r.passesThreshold ? "default" : "destructive"}>
                      {r.score.toFixed(1)}%
                    </Badge>
                    <Badge
                      variant={r.score >= r.targetAvgScore ? "outline" : "secondary"}
                      className="tabular-nums"
                    >
                      {r.scoreTargetDelta >= 0 ? "+" : ""}
                      {r.scoreTargetDelta.toFixed(1)}
                    </Badge>
                    {!r.passesThreshold && (
                      <Badge variant="destructive">{r.hasFatalFail ? "Fatal" : "Fail"}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Ver detalle de ${r.agentName}`}
                    onClick={() => void openDetail(r.id)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {responses.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {loading ? "Cargando..." : error ? "No se pudieron cargar los datos" : "Sin resultados"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {reportPage && reportPage.totalPages > 1 && (
        <nav aria-label="Paginacion de reportes" className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Pagina {reportPage.page} de {reportPage.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || reportPage.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || reportPage.page >= reportPage.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      )}

      {/* Detail Dialog */}
      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            detailRequestGeneration.current += 1;
            setDetailLoading(false);
            setDetailError(null);
            setSelectedResponse(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle de Evaluación</DialogTitle>
          </DialogHeader>
          {detailLoading && (
            <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando detalle...
            </div>
          )}
          {detailError && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              {detailError}
            </div>
          )}
          {selectedResponse && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Formulario: </span>
                  {selectedResponse.formTitle}
                </div>
                <div>
                  <span className="text-muted-foreground">Score: </span>
                  <Badge variant={selectedResponse.passesThreshold ? "default" : "destructive"}>
                    {selectedResponse.score.toFixed(1)}%
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Resultado: </span>
                  <Badge variant={selectedResponse.passesThreshold ? "default" : "destructive"}>
                    {selectedResponse.passesThreshold ? "PASS" : "FAIL"}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Target score: </span>
                  {selectedResponse.targetAvgScore}%
                </div>
                <div>
                  <span className="text-muted-foreground">Umbral pass: </span>
                  {selectedResponse.passThreshold}%
                </div>
                <div>
                  <span className="text-muted-foreground">Falla fatal: </span>
                  {selectedResponse.hasFatalFail ? "Si" : "No"}
                </div>
                <div>
                  <span className="text-muted-foreground">Agente: </span>
                  {selectedResponse.agentName}
                </div>
                <div>
                  <span className="text-muted-foreground">Evaluador: </span>
                  {selectedResponse.evaluatorName}
                </div>
                <div>
                  <span className="text-muted-foreground">Versión formulario: </span>
                  {selectedResponse.formVersion ? `v${selectedResponse.formVersion}` : "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Disposición: </span>
                  {selectedResponse.dispositionName ?? "—"}
                  {selectedResponse.dispositionOutcome && (
                    <span className="text-muted-foreground">
                      {" "}
                      ·{" "}
                      {OUTCOME_LABELS[
                        selectedResponse.dispositionOutcome as keyof typeof OUTCOME_LABELS
                      ] ?? selectedResponse.dispositionOutcome}
                    </span>
                  )}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Fecha: </span>
                  {formatOperationalTimestamp(selectedResponse.createdAt, operationalTimeZone)}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Respuestas</p>
                {selectedResponse.answers.map((a) => (
                  <div key={a.questionId} className="rounded-lg border p-3 text-sm">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {a.category && (
                          <Badge variant="outline" className="gap-1.5 text-xs">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: a.category.color ?? "#ff6600" }}
                            />
                            {a.category.name}
                          </Badge>
                        )}
                        {a.questionWeight > 0 && (
                          <Badge variant="outline" className="text-xs">
                            Peso {a.questionWeight}%
                          </Badge>
                        )}
                        {a.fatal && (
                          <Badge variant="destructive" className="text-xs">
                            Fatal
                          </Badge>
                        )}
                        {a.criticalType && (
                          <Badge variant="outline" className="text-xs">
                            {CRITICAL_LABEL[a.criticalType] ?? a.criticalType}
                          </Badge>
                        )}
                      </div>
                      {a.score !== null && (
                        <Badge
                          variant={
                            a.isFatalFail ? "destructive" : a.score >= 70 ? "default" : "secondary"
                          }
                          className="tabular-nums"
                        >
                          {a.score.toFixed(1)}%
                        </Badge>
                      )}
                    </div>
                    <p className="font-medium">{a.question}</p>
                    <p className="text-muted-foreground">
                      {a.questionType === "RATING" ? `${a.value} ★` : a.value}
                    </p>
                    {a.comment && (
                      <p className="mt-2 whitespace-pre-wrap border-l-2 border-orange-500/50 pl-2 text-xs text-muted-foreground">
                        {a.comment}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
