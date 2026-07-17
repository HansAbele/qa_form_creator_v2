"use client";

import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  ClipboardCheck,
  FileText,
  Filter,
  Gauge,
  Megaphone,
  ShieldAlert,
  Tags,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataLoadError,
  type DataLoadStatus,
  reportDataLoadError,
} from "@/components/dashboard/data-load-state";
import { DateRangeFilter, dateRangeLabel } from "@/components/filters/date-range-filter";
import { FilterCheckbox, FilterSelect } from "@/components/filters/filter-select";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  type EvaluationHistoryFilterOptions,
  type EvaluationHistoryScope,
  getEvaluationHistory,
  getEvaluationHistoryFilterOptions,
} from "@/server/queries/analytics";

type ResultStatus = "PASS" | "FAIL";
type EvaluationHistoryData = Awaited<ReturnType<typeof getEvaluationHistory>>;
type CampaignOption = { id: string; name: string };

function parseScore(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseResultStatus(value: string | undefined): ResultStatus | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized === "PASS" || normalized === "FAIL" ? normalized : undefined;
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

export function EvaluationsListClient({
  ownCampaigns,
  managedCampaigns,
  ownFilterOptions,
  managedFilterOptions,
  ownFilterOptionsLoaded,
  managedFilterOptionsLoaded,
  canViewOwn,
  canViewManaged,
  initialScope,
  initialMinScore,
  initialMaxScore,
  initialCampaignId,
  initialDateFrom,
  initialDateTo,
  initialResultStatus,
  initialAgentId,
  initialEvaluatorId,
  initialFormId,
  initialDispositionId,
  initialFatalOnly = false,
  initialPage = 1,
}: {
  ownCampaigns: CampaignOption[];
  managedCampaigns: CampaignOption[];
  ownFilterOptions: EvaluationHistoryFilterOptions;
  managedFilterOptions: EvaluationHistoryFilterOptions;
  ownFilterOptionsLoaded: boolean;
  managedFilterOptionsLoaded: boolean;
  canViewOwn: boolean;
  canViewManaged: boolean;
  initialScope: EvaluationHistoryScope;
  initialMinScore?: string;
  initialMaxScore?: string;
  initialCampaignId?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
  initialResultStatus?: string;
  initialAgentId?: string;
  initialEvaluatorId?: string;
  initialFormId?: string;
  initialDispositionId?: string;
  initialFatalOnly?: boolean;
  initialPage?: number;
}) {
  const operationalTimeZone = useOperationalTimeZone();
  const [scope, setScope] = useState<EvaluationHistoryScope>(initialScope);
  const [minScore, setMinScore] = useState<number | undefined>(parseScore(initialMinScore));
  const [maxScore, setMaxScore] = useState<number | undefined>(parseScore(initialMaxScore));
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? "");
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialDateTo ?? "");
  const [resultStatus, setResultStatus] = useState<ResultStatus | undefined>(
    parseResultStatus(initialResultStatus),
  );
  const [agentId, setAgentId] = useState(initialAgentId ?? "");
  const [evaluatorId, setEvaluatorId] = useState(initialEvaluatorId ?? "");
  const [formId, setFormId] = useState(initialFormId ?? "");
  const [dispositionId, setDispositionId] = useState(initialDispositionId ?? "");
  const [fatalOnly, setFatalOnly] = useState(initialFatalOnly);
  const debouncedMinScore = useDebouncedValue(minScore, 350);
  const debouncedMaxScore = useDebouncedValue(maxScore, 350);
  const [page, setPage] = useState(initialPage);
  const [data, setData] = useState<EvaluationHistoryData | null>(null);
  const [loadStatus, setLoadStatus] = useState<DataLoadStatus>("loading");
  const [filterOptionsByScope, setFilterOptionsByScope] = useState({
    own: ownFilterOptions,
    managed: managedFilterOptions,
  });
  const [loadedFilterScopes, setLoadedFilterScopes] = useState({
    own: ownFilterOptionsLoaded,
    managed: managedFilterOptionsLoaded,
  });
  const requestGeneration = useRef(0);

  const campaigns = useMemo(
    () => (scope === "managed" ? managedCampaigns : ownCampaigns),
    [managedCampaigns, ownCampaigns, scope],
  );
  const filterOptions = filterOptionsByScope[scope];
  const agentOptions = campaignId
    ? filterOptions.agents.filter((option) => option.campaignId === campaignId)
    : filterOptions.agents;
  const formOptions = campaignId
    ? filterOptions.forms.filter((option) => option.campaignId === campaignId)
    : filterOptions.forms;
  const dispositionOptions = campaignId
    ? filterOptions.dispositions.filter((option) => option.campaignId === campaignId)
    : filterOptions.dispositions;
  const evaluatorOptions = campaignId
    ? filterOptions.evaluators.filter((option) => option.campaignIds.includes(campaignId))
    : filterOptions.evaluators;

  useEffect(() => {
    if (campaignId && !campaigns.some((campaign) => campaign.id === campaignId)) {
      setCampaignId("");
      setPage(1);
    }
  }, [campaignId, campaigns]);

  useEffect(() => {
    const canLoadScope = scope === "managed" ? canViewManaged : canViewOwn;
    if (!canLoadScope || loadedFilterScopes[scope]) return;

    let active = true;
    void getEvaluationHistoryFilterOptions(scope)
      .then((options) => {
        if (!active) return;
        setFilterOptionsByScope((current) => ({ ...current, [scope]: options }));
        setLoadedFilterScopes((current) => ({ ...current, [scope]: true }));
      })
      .catch((error) => reportDataLoadError(error, `evaluation-history-options-${scope}`));

    return () => {
      active = false;
    };
  }, [canViewManaged, canViewOwn, loadedFilterScopes, scope]);

  const loadData = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoadStatus("loading");

    try {
      const result = await getEvaluationHistory({
        scope,
        minScore: debouncedMinScore,
        maxScore: debouncedMaxScore,
        campaignId: campaignId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        resultStatus,
        agentId: agentId || undefined,
        evaluatorId: scope === "managed" ? evaluatorId || undefined : undefined,
        formId: formId || undefined,
        dispositionId: dispositionId || undefined,
        fatalOnly,
        page,
        pageSize: 25,
      });
      if (requestId !== requestGeneration.current) return;
      if (result.page > result.totalPages) {
        setPage(result.totalPages);
        return;
      }
      setData(result);
      setLoadStatus(result.responses.length === 0 ? "empty" : "success");
    } catch (error) {
      if (requestId !== requestGeneration.current) return;
      reportDataLoadError(error, "evaluation-history");
      setData(null);
      setLoadStatus("error");
    }
  }, [
    agentId,
    campaignId,
    dateFrom,
    dateTo,
    dispositionId,
    evaluatorId,
    fatalOnly,
    formId,
    debouncedMaxScore,
    debouncedMinScore,
    page,
    resultStatus,
    scope,
  ]);

  useEffect(() => {
    void loadData();
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (canViewOwn && canViewManaged) params.set("scope", scope);
    if (debouncedMinScore !== undefined) params.set("minScore", String(debouncedMinScore));
    if (debouncedMaxScore !== undefined) params.set("maxScore", String(debouncedMaxScore));
    if (campaignId) params.set("campaignId", campaignId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (resultStatus) params.set("status", resultStatus.toLowerCase());
    if (agentId) params.set("agentId", agentId);
    if (scope === "managed" && evaluatorId) params.set("evaluatorId", evaluatorId);
    if (formId) params.set("formId", formId);
    if (dispositionId) params.set("dispositionId", dispositionId);
    if (fatalOnly) params.set("fatalOnly", "true");
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/evaluations?${query}` : "/evaluations");
  }, [
    agentId,
    campaignId,
    canViewManaged,
    canViewOwn,
    dateFrom,
    dateTo,
    dispositionId,
    evaluatorId,
    fatalOnly,
    formId,
    debouncedMaxScore,
    debouncedMinScore,
    page,
    resultStatus,
    scope,
  ]);

  const activeCampaign = campaignId
    ? campaigns.find((campaign) => campaign.id === campaignId)?.name
    : null;
  const activeAgent = agentId
    ? filterOptions.agents.find((option) => option.id === agentId)?.name
    : null;
  const activeEvaluator = evaluatorId
    ? filterOptions.evaluators.find((option) => option.id === evaluatorId)?.name
    : null;

  const resetDimensionFilters = () => {
    setAgentId("");
    setEvaluatorId("");
    setFormId("");
    setDispositionId("");
    setFatalOnly(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-heading text-3xl font-bold tracking-tight">Evaluaciones</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {scope === "own"
                ? "Consulta por mes las llamadas que evaluaste y el promedio de cada agente."
                : "Compara llamadas, agentes y evaluadores dentro de las campañas que administras."}
            </p>
          </div>
        </div>
        {canViewOwn && canViewManaged ? (
          <FilterSelect
            id="evaluation-scope"
            label="Vista"
            value={scope}
            options={[
              { value: "managed", label: "Equipo y campañas" },
              { value: "own", label: "Mis evaluaciones" },
            ]}
            onValueChange={(value) => {
              setScope(value === "managed" ? "managed" : "own");
              setCampaignId("");
              resetDimensionFilters();
              setPage(1);
            }}
            icon={scope === "managed" ? Users : ClipboardCheck}
            className="w-full sm:w-56"
          />
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Llamadas evaluadas
              </p>
              {data && loadStatus !== "loading" ? (
                <p className="text-2xl font-bold tabular-nums">{data.summary.totalEvaluations}</p>
              ) : (
                <Skeleton className="mt-1 h-7 w-16" />
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Gauge className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Promedio general
              </p>
              {data && loadStatus !== "loading" ? (
                <p className="text-2xl font-bold tabular-nums">
                  {data.summary.avgScore.toFixed(1)}%
                </p>
              ) : (
                <Skeleton className="mt-1 h-7 w-20" />
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CircleCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pass rate
              </p>
              {data && loadStatus !== "loading" ? (
                <p className="text-2xl font-bold tabular-nums">
                  {data.summary.passRate.toFixed(1)}%
                </p>
              ) : (
                <Skeleton className="mt-1 h-7 w-20" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Filter className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">Filtros de seguimiento</p>
              <p className="text-xs text-muted-foreground">
                Elige un mes y un agente para revisar cada llamada y su promedio general.
              </p>
            </div>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <FilterSelect
              id="evaluations-campaign"
              label="Campaña"
              value={campaignId || "all"}
              options={[
                { value: "all", label: "Todas" },
                ...campaigns.map((campaign) => ({
                  value: campaign.id,
                  label: campaign.name,
                })),
              ]}
              onValueChange={(value) => {
                setCampaignId(value === "all" ? "" : value);
                setAgentId("");
                setEvaluatorId("");
                setFormId("");
                setDispositionId("");
                setPage(1);
              }}
              icon={Megaphone}
              disabled={campaigns.length === 0}
            />
            <DateRangeFilter
              id="evaluations-period"
              label="Periodo"
              from={dateFrom}
              to={dateTo}
              onApply={(from, to) => {
                setDateFrom(from);
                setDateTo(to);
                setPage(1);
              }}
              align="start"
            />
            <FilterSelect
              id="evaluations-agent"
              label="Agente"
              value={agentId || "all"}
              options={[
                { value: "all", label: "Todos" },
                ...agentOptions.map((option) => ({
                  value: option.id,
                  label: campaignId ? option.name : `${option.name} · ${option.campaignName}`,
                })),
              ]}
              onValueChange={(value) => {
                setAgentId(value === "all" ? "" : value);
                setPage(1);
              }}
              icon={UserRound}
              disabled={agentOptions.length === 0}
              contentClassName="min-w-64"
            />
            {scope === "managed" ? (
              <FilterSelect
                id="evaluations-evaluator"
                label="Evaluador"
                value={evaluatorId || "all"}
                options={[
                  { value: "all", label: "Todos" },
                  ...evaluatorOptions.map((option) => ({
                    value: option.id,
                    label: option.name,
                  })),
                ]}
                onValueChange={(value) => {
                  setEvaluatorId(value === "all" ? "" : value);
                  setPage(1);
                }}
                icon={Users}
                disabled={evaluatorOptions.length === 0}
              />
            ) : null}
            <FilterSelect
              id="evaluations-form"
              label="Formulario"
              value={formId || "all"}
              options={[
                { value: "all", label: "Todos" },
                ...formOptions.map((option) => ({
                  value: option.id,
                  label: campaignId ? option.name : `${option.name} · ${option.campaignName}`,
                })),
              ]}
              onValueChange={(value) => {
                setFormId(value === "all" ? "" : value);
                setPage(1);
              }}
              icon={FileText}
              disabled={formOptions.length === 0}
              contentClassName="min-w-64"
            />
            <FilterSelect
              id="evaluations-disposition"
              label="Disposición"
              value={dispositionId || "all"}
              options={[
                { value: "all", label: "Todas" },
                ...dispositionOptions.map((option) => ({
                  value: option.id,
                  label: campaignId ? option.name : `${option.name} · ${option.campaignName}`,
                })),
              ]}
              onValueChange={(value) => {
                setDispositionId(value === "all" ? "" : value);
                setPage(1);
              }}
              icon={Tags}
              disabled={dispositionOptions.length === 0}
              contentClassName="min-w-64"
            />
            <FilterSelect
              id="evaluations-status"
              label="Resultado"
              value={resultStatus ?? "all"}
              options={[
                { value: "all", label: "Todos" },
                { value: "PASS", label: "Solo PASS" },
                { value: "FAIL", label: "Solo FAIL" },
              ]}
              onValueChange={(value) => {
                setResultStatus(value === "PASS" || value === "FAIL" ? value : undefined);
                setPage(1);
              }}
              icon={CircleCheck}
            />
            <FilterCheckbox
              id="evaluations-fatal-only"
              fieldLabel="Riesgo"
              label="Solo fatales"
              checked={fatalOnly}
              onCheckedChange={(checked) => {
                setFatalOnly(checked);
                setPage(1);
              }}
              icon={ShieldAlert}
            />
            <div className="min-w-0 space-y-1">
              <Label htmlFor="evaluations-score-min" className="text-xs font-medium">
                Score mín.
              </Label>
              <Input
                id="evaluations-score-min"
                type="number"
                min={0}
                max={100}
                value={minScore ?? ""}
                onChange={(event) => {
                  setMinScore(parseScore(event.target.value));
                  setPage(1);
                }}
                className="h-10 rounded-[11px] bg-card shadow-sm hover:border-primary"
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="evaluations-score-max" className="text-xs font-medium">
                Score máx.
              </Label>
              <Input
                id="evaluations-score-max"
                type="number"
                min={0}
                max={100}
                value={maxScore ?? ""}
                onChange={(event) => {
                  setMaxScore(parseScore(event.target.value));
                  setPage(1);
                }}
                className="h-10 rounded-[11px] bg-card shadow-sm hover:border-primary"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Resultados</span>
            {loadStatus === "loading" ? (
              <Skeleton className="h-5 w-10" />
            ) : (
              <span className="font-semibold tabular-nums">{data?.totalCount ?? 0}</span>
            )}
            <Badge variant="secondary">
              {scope === "own" ? "Solo tu actividad" : "Alcance administrado"}
            </Badge>
            {activeCampaign ? <Badge variant="outline">{activeCampaign}</Badge> : null}
            {activeAgent ? <Badge variant="outline">Agente: {activeAgent}</Badge> : null}
            {scope === "managed" && activeEvaluator ? (
              <Badge variant="outline">Evaluador: {activeEvaluator}</Badge>
            ) : null}
            {fatalOnly ? <Badge variant="destructive">Solo fatales</Badge> : null}
            {dateFrom || dateTo ? (
              <Badge variant="outline">{dateRangeLabel(dateFrom, dateTo)}</Badge>
            ) : null}
          </div>

          {loadStatus === "loading" ? (
            <div className="space-y-2 pt-4">
              {["agent", "evaluator", "form", "disposition", "score", "submitted"].map((field) => (
                <Skeleton key={field} className="h-11 w-full" />
              ))}
            </div>
          ) : loadStatus === "error" ? (
            <div className="pt-4">
              <DataLoadError
                compact
                onRetry={() => void loadData()}
                title="No pudimos cargar las evaluaciones"
              />
            </div>
          ) : data && data.responses.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agente</TableHead>
                      {scope === "managed" ? <TableHead>Evaluador</TableHead> : null}
                      <TableHead>Formulario</TableHead>
                      <TableHead>Disposición</TableHead>
                      <TableHead className="text-center">Score / estado</TableHead>
                      <TableHead className="text-right">Enviada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.responses.map((response) => (
                      <TableRow key={response.id}>
                        <TableCell>
                          <Link
                            href={`/evaluations/${response.id}`}
                            className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {response.agent.name}
                          </Link>
                        </TableCell>
                        {scope === "managed" ? (
                          <TableCell className="text-muted-foreground">
                            {response.evaluator.name}
                          </TableCell>
                        ) : null}
                        <TableCell className="max-w-[220px] truncate text-muted-foreground">
                          {response.form.title}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {response.disposition?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={response.result === "PASS" ? "default" : "destructive"}
                            className="tabular-nums"
                          >
                            {response.score.toFixed(1)}% · {response.result}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatOperationalTimestamp(response.submittedAt, operationalTimeZone, {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Página <span className="font-medium text-foreground">{data.page}</span> de{" "}
                  <span className="font-medium text-foreground">{data.totalPages}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={data.page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={data.page >= data.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Siguiente
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center">
              <ClipboardCheck className="h-8 w-8 text-muted-foreground/60" />
              <p className="font-medium">No hay evaluaciones para estos filtros</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Prueba otro periodo, campaña o rango de score.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
