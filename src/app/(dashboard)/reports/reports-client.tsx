"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Download,
  Eye,
  FileText,
  Megaphone,
  ShieldAlert,
  SlidersHorizontal,
  Tags,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { FilterCheckbox, FilterSelect } from "@/components/filters/filter-select";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatOperationalTimestamp } from "@/lib/date-display";
import { OUTCOME_LABELS } from "@/lib/disposition-outcome";
import { getReportData } from "@/server/queries/analytics";

type ReportPage = Awaited<ReturnType<typeof getReportData>>;
type ReportResponse = ReportPage["items"][number];

interface ReportsClientProps {
  campaigns: { id: string; name: string }[];
  forms: { id: string; title: string; campaignId: string }[];
  dispositions: { id: string; name: string; campaignId: string; campaignName: string }[];
  canExport: boolean;
}

const REPORT_SUMMARY_SKELETONS = [
  "evaluations",
  "average-score",
  "pass-rate",
  "daily-rate",
  "fatal-failures",
] as const;

export function ReportsClient({ campaigns, forms, dispositions, canExport }: ReportsClientProps) {
  const operationalTimeZone = useOperationalTimeZone();
  const [campaignId, setCampaignId] = useState("");
  const [formId, setFormId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [reportPage, setReportPage] = useState<ReportPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<"all" | "PASS" | "FAIL">("all");
  const [fatalOnly, setFatalOnly] = useState(false);
  const [dispositionFilter, setDispositionFilter] = useState("all");
  const reportRequestGeneration = useRef(0);
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
        campaignId: campaignId || undefined,
        formId: formId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
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
  }, [campaignId, dateFrom, dateTo, dispositionFilter, fatalOnly, formId, page, resultFilter]);

  useEffect(() => {
    void loadReports();
    return () => {
      reportRequestGeneration.current += 1;
    };
  }, [loadReports]);

  const resetFilters = () => {
    setPage(1);
    setCampaignId("");
    setFormId("");
    setDateFrom("");
    setDateTo("");
    setResultFilter("all");
    setDispositionFilter("all");
    setFatalOnly(false);
  };

  const openHistory = () => {
    const params = new URLSearchParams({ scope: "managed" });
    if (campaignId) params.set("campaignId", campaignId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (resultFilter !== "all") params.set("status", resultFilter.toLowerCase());
    if (formId) params.set("formId", formId);
    if (dispositionFilter !== "all") params.set("dispositionId", dispositionFilter);
    if (fatalOnly) params.set("fatalOnly", "true");
    router.push(`/evaluations?${params.toString()}`);
  };

  const responses: ReportResponse[] = reportPage?.items ?? [];
  const summary = reportPage?.summary;
  const hasActiveFilters = Boolean(
    campaignId ||
      formId ||
      dateFrom ||
      dateTo ||
      resultFilter !== "all" ||
      dispositionFilter !== "all" ||
      fatalOnly,
  );
  const campaignOptions = [
    { value: "all", label: "Todas" },
    ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
  ];
  const formOptions = [
    { value: "all", label: "Todos" },
    ...filteredForms.map((form) => ({ value: form.id, label: form.title })),
  ];
  const dispositionSelectOptions = [
    { value: "all", label: "Todas" },
    ...dispositionOptions.map((disposition) => ({
      value: disposition.id,
      label: `${disposition.name} · ${disposition.campaignName}`,
    })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reportes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Indicadores consolidados para las campañas bajo tu responsabilidad.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openHistory}>
            <ClipboardCheck className="h-4 w-4" />
            Ver evaluaciones
          </Button>
          {canExport && (
            <Button variant="outline" onClick={() => router.push("/analytics/export")}>
              <Download className="h-4 w-4" />
              Exportar
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Filtros del reporte</p>
                <p className="text-xs text-muted-foreground">
                  Los cambios se aplican automáticamente a indicadores y resultados.
                </p>
              </div>
            </div>
            {hasActiveFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                <X className="h-4 w-4" />
                Limpiar
              </Button>
            ) : null}
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <FilterSelect
              id="reports-campaign"
              label="Campaña"
              value={campaignId || "all"}
              options={campaignOptions}
              onValueChange={(value) => {
                setPage(1);
                setCampaignId(value === "all" ? "" : value);
                setFormId("");
                setDispositionFilter("all");
              }}
              placeholder="Todas"
              icon={Megaphone}
            />
            <FilterSelect
              id="reports-form"
              label="Formulario"
              value={formId || "all"}
              options={formOptions}
              onValueChange={(value) => {
                setPage(1);
                setFormId(value === "all" ? "" : value);
              }}
              placeholder="Todos"
              icon={FileText}
            />
            <DateRangeFilter
              id="reports-period"
              label="Periodo"
              from={dateFrom}
              to={dateTo}
              onApply={(from, to) => {
                setPage(1);
                setDateFrom(from);
                setDateTo(to);
              }}
              align="start"
            />
            <FilterSelect
              id="reports-result"
              label="Resultado"
              value={resultFilter}
              options={[
                { value: "all", label: "Todos" },
                { value: "PASS", label: "Solo PASS" },
                { value: "FAIL", label: "Solo FAIL" },
              ]}
              onValueChange={(value) => {
                setPage(1);
                setResultFilter(value as "all" | "PASS" | "FAIL");
              }}
              icon={CircleCheck}
            />
            <FilterSelect
              id="reports-disposition"
              label="Disposición"
              value={dispositionFilter}
              options={dispositionSelectOptions}
              onValueChange={(value) => {
                setPage(1);
                setDispositionFilter(value);
              }}
              placeholder="Todas"
              icon={Tags}
              contentClassName="min-w-64"
            />
            <FilterCheckbox
              id="reports-fatal-only"
              fieldLabel="Riesgo"
              label="Solo fatales"
              checked={fatalOnly}
              onCheckedChange={(checked) => {
                setPage(1);
                setFatalOnly(checked);
              }}
              icon={ShieldAlert}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
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
              summary.dailyRate >= summary.targetDailyRate ? "border-green-200" : "border-amber-200"
            }
          >
            <CardContent className="p-4 text-center">
              <p className="text-sm text-muted-foreground">Tasa Diaria</p>
              <p className="text-2xl font-bold">{summary.dailyRate.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">Target: {summary.targetDailyRate}/día</p>
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
          Mostrando{" "}
          <span className="font-medium text-foreground">
            {(reportPage.page - 1) * reportPage.pageSize + 1}–
            {Math.min(reportPage.page * reportPage.pageSize, reportPage.totalCount)}
          </span>{" "}
          de {reportPage.totalCount} evaluaciones
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
                  {formatOperationalTimestamp(r.submittedAt, operationalTimeZone, {
                    dateStyle: "short",
                  })}
                </TableCell>
                <TableCell className="max-w-[150px] truncate">{r.campaignName}</TableCell>
                <TableCell>
                  {r.formTitle}
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
                    onClick={() => router.push(`/evaluations/${r.id}`)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {responses.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {loading
                    ? "Cargando..."
                    : error
                      ? "No se pudieron cargar los datos"
                      : "Sin resultados"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {reportPage && reportPage.totalPages > 1 && (
        <nav
          aria-label="Paginacion de reportes"
          className="flex items-center justify-between gap-3"
        >
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
    </div>
  );
}
