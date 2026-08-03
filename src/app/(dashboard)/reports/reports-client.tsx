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
import { useI18n } from "@/components/providers/i18n-provider";
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
import { OUTCOME_LABELS_EN } from "@/lib/disposition-outcome";
import { formDisplayName } from "@/lib/form-display-name";
import { getMetricDisplay, type MetricDisplay } from "@/lib/metric-display";
import { getReportData } from "@/server/queries/analytics";

type ReportPage = Awaited<ReturnType<typeof getReportData>>;
type ReportResponse = ReportPage["items"][number];

interface ReportsClientProps {
  campaigns: { id: string; name: string }[];
  forms: { id: string; title: string; campaignId: string }[];
  dispositions: { id: string; name: string; campaignId: string; campaignName: string }[];
  canExport: boolean;
  initialCampaignId?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
}

export function ReportsClient({
  campaigns,
  forms,
  dispositions,
  canExport,
  initialCampaignId,
  initialDateFrom,
  initialDateTo,
}: ReportsClientProps) {
  const { locale, t } = useI18n();
  const operationalTimeZone = useOperationalTimeZone();
  const displayLocale = locale === "es" ? "es" : "en";
  const [campaignId, setCampaignId] = useState(
    campaigns.length === 1 ? (campaigns[0]?.id ?? "") : (initialCampaignId ?? ""),
  );
  const [formId, setFormId] = useState("");
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialDateTo ?? "");
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
      setError("Unable to load reports. Please try again.");
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
    setCampaignId(campaigns.length === 1 ? (campaigns[0]?.id ?? "") : "");
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
    (campaigns.length > 1 && campaignId) ||
      formId ||
      dateFrom ||
      dateTo ||
      resultFilter !== "all" ||
      dispositionFilter !== "all" ||
      fatalOnly,
  );
  const campaignOptions = [
    { value: "all", label: t("All campaigns") },
    ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
  ];
  const formOptions = [
    { value: "all", label: t("All forms") },
    ...filteredForms.map((form) => ({ value: form.id, label: formDisplayName(form.title) })),
  ];
  const dispositionSelectOptions = [
    { value: "all", label: t("All dispositions") },
    ...dispositionOptions.map((disposition) => ({
      value: disposition.id,
      label: `${disposition.name} · ${disposition.campaignName}`,
    })),
  ];
  const metricStatus = loading
    ? "loading"
    : error
      ? "error"
      : summary && summary.totalEvaluations > 0
        ? "success"
        : "empty";
  const hasSummaryData = (summary?.totalEvaluations ?? 0) > 0;
  const totalEvaluationsMetric = getMetricDisplay({
    kind: "count",
    value: summary?.totalEvaluations,
    hasData: hasSummaryData,
    status: metricStatus,
  });
  const averageScoreMetric = getMetricDisplay({
    kind: "measure",
    value: summary?.avgScore,
    hasData: hasSummaryData,
    status: metricStatus,
    decimals: 1,
    suffix: "%",
  });
  const passRateMetric = getMetricDisplay({
    kind: "measure",
    value: summary?.passRate,
    hasData: hasSummaryData,
    status: metricStatus,
    decimals: 1,
    suffix: "%",
  });
  const dailyRateMetric = getMetricDisplay({
    kind: "measure",
    value: summary?.dailyRate,
    hasData: hasSummaryData,
    status: metricStatus,
    decimals: 1,
  });
  const fatalFailuresMetric = getMetricDisplay({
    kind: "count",
    value: summary?.fatalFailCount,
    hasData: hasSummaryData,
    status: metricStatus,
  });
  const renderMetric = (
    metric: MetricDisplay,
    skeletonWidth: string,
    readySupportingText?: string,
  ) => {
    if (metric.state === "loading") {
      return <Skeleton className={`mx-auto h-8 ${skeletonWidth}`} />;
    }

    const stateLabel =
      metric.state === "no-data"
        ? t("No data")
        : metric.state === "unavailable"
          ? t("Unavailable")
          : readySupportingText;

    return (
      <>
        <p className="text-2xl font-bold tabular-nums">{metric.text}</p>
        {stateLabel ? <p className="text-xs text-muted-foreground">{stateLabel}</p> : null}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("Reports")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Consolidated metrics for the campaigns under your responsibility.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openHistory}>
            <ClipboardCheck className="h-4 w-4" />
            {t("View evaluations")}
          </Button>
          {canExport && (
            <Button variant="outline" onClick={() => router.push("/analytics/export")}>
              <Download className="h-4 w-4" />
              {t("Export")}
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
                <p className="text-sm font-semibold">{t("Report filters")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("Changes apply automatically to metrics and results.")}
                </p>
              </div>
            </div>
            {hasActiveFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                <X className="h-4 w-4" />
                {t("Clear")}
              </Button>
            ) : null}
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {campaigns.length === 1 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("Campaign")}</p>
                <div className="flex min-h-10 items-center justify-between rounded-md border bg-muted/30 px-3 text-sm">
                  <span className="font-medium">{campaigns[0]?.name}</span>
                  <Badge variant="secondary">{t("Automatic")}</Badge>
                </div>
              </div>
            ) : (
              <FilterSelect
                id="reports-campaign"
                label={t("Campaign")}
                value={campaignId || "all"}
                options={campaignOptions}
                onValueChange={(value) => {
                  setPage(1);
                  setCampaignId(value === "all" ? "" : value);
                  setFormId("");
                  setDispositionFilter("all");
                }}
                placeholder={t("All campaigns")}
                icon={Megaphone}
              />
            )}
            <FilterSelect
              id="reports-form"
              label={t("Form")}
              value={formId || "all"}
              options={formOptions}
              onValueChange={(value) => {
                setPage(1);
                setFormId(value === "all" ? "" : value);
              }}
              placeholder={t("All forms")}
              icon={FileText}
            />
            <DateRangeFilter
              id="reports-period"
              label={t("Period")}
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
              label={t("Result")}
              value={resultFilter}
              options={[
                { value: "all", label: t("All results") },
                { value: "PASS", label: t("PASS only") },
                { value: "FAIL", label: t("FAIL only") },
              ]}
              onValueChange={(value) => {
                setPage(1);
                setResultFilter(value as "all" | "PASS" | "FAIL");
              }}
              icon={CircleCheck}
            />
            <FilterSelect
              id="reports-disposition"
              label={t("Disposition")}
              value={dispositionFilter}
              options={dispositionSelectOptions}
              onValueChange={(value) => {
                setPage(1);
                setDispositionFilter(value);
              }}
              placeholder={t("All dispositions")}
              icon={Tags}
              contentClassName="min-w-64"
            />
            <FilterCheckbox
              id="reports-fatal-only"
              fieldLabel={t("Risk")}
              label={t("Critical failures only")}
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
          <span className="flex-1">{t(error)}</span>
          <Button variant="outline" size="sm" onClick={() => void loadReports()}>
            {t("Retry")}
          </Button>
        </div>
      )}

      {/* Summary */}
      <div
        role="status"
        aria-live="polite"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        aria-busy={loading}
      >
        {loading ? <span className="sr-only">{t("Loading report metrics")}</span> : null}
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">{t("Evaluated Calls")}</p>
            {renderMetric(totalEvaluationsMetric, "w-16")}
          </CardContent>
        </Card>
        <Card
          className={
            averageScoreMetric.state === "ready" && summary
              ? summary.avgScore >= summary.targetAvgScore
                ? "border-green-200"
                : "border-red-200"
              : undefined
          }
        >
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">{t("Average Score")}</p>
            {renderMetric(
              averageScoreMetric,
              "w-20",
              summary ? t("Target: {value}%", { value: summary.targetAvgScore }) : undefined,
            )}
          </CardContent>
        </Card>
        <Card
          className={
            passRateMetric.state === "ready" && summary
              ? summary.passRate >= summary.targetPassRate
                ? "border-green-200"
                : "border-red-200"
              : undefined
          }
        >
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">{t("Pass Rate")}</p>
            {renderMetric(
              passRateMetric,
              "w-20",
              summary ? t("Target: {value}%", { value: summary.targetPassRate }) : undefined,
            )}
          </CardContent>
        </Card>
        <Card
          className={
            dailyRateMetric.state === "ready" && summary
              ? summary.dailyRate >= summary.targetDailyRate
                ? "border-green-200"
                : "border-amber-200"
              : undefined
          }
        >
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">{t("Daily Rate")}</p>
            {renderMetric(
              dailyRateMetric,
              "w-16",
              summary ? t("Target: {value}/day", { value: summary.targetDailyRate }) : undefined,
            )}
          </CardContent>
        </Card>
        <Card
          className={
            fatalFailuresMetric.state === "ready" && summary
              ? summary.fatalFailCount <= summary.fatalFailuresAllowed
                ? "border-green-200"
                : "border-red-200"
              : undefined
          }
        >
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">{t("Critical Failures")}</p>
            {renderMetric(
              fatalFailuresMetric,
              "w-16",
              summary ? t("Allowed: {value}", { value: summary.fatalFailuresAllowed }) : undefined,
            )}
          </CardContent>
        </Card>
      </div>

      {reportPage && reportPage.totalCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("Showing")}{" "}
          <span className="font-medium text-foreground">
            {(reportPage.page - 1) * reportPage.pageSize + 1}–
            {Math.min(reportPage.page * reportPage.pageSize, reportPage.totalCount)}
          </span>{" "}
          {t("of {count} evaluations", { count: reportPage.totalCount })}
        </p>
      )}

      {/* Results Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Date")}</TableHead>
              <TableHead>{t("Campaign")}</TableHead>
              <TableHead>{t("Form")}</TableHead>
              <TableHead>{t("Agent")}</TableHead>
              <TableHead>{t("Evaluator")}</TableHead>
              <TableHead>{t("Disposition")}</TableHead>
              <TableHead>{t("Score")}</TableHead>
              <TableHead className="w-16">{t("Details")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {responses.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatOperationalTimestamp(
                    r.submittedAt,
                    operationalTimeZone,
                    { dateStyle: "short" },
                    displayLocale,
                  )}
                </TableCell>
                <TableCell className="max-w-[150px] truncate">{r.campaignName}</TableCell>
                <TableCell>{formDisplayName(r.formTitle)}</TableCell>
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
                          {t(
                            OUTCOME_LABELS_EN[
                              r.dispositionOutcome as keyof typeof OUTCOME_LABELS_EN
                            ] ?? r.dispositionOutcome,
                          )}
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
                      <Badge variant="destructive">
                        {r.hasFatalFail ? t("Critical Failure") : t("Fail")}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("View details for {name}", { name: r.agentName })}
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
                  {loading ? t("Loading...") : error ? t("Unable to load data") : t("No results")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {reportPage && reportPage.totalPages > 1 && (
        <nav
          aria-label={t("Report pagination")}
          className="flex items-center justify-between gap-3"
        >
          <p className="text-sm text-muted-foreground">
            {t("Page {page} of {total}", {
              page: reportPage.page,
              total: reportPage.totalPages,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || reportPage.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              {t("Previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || reportPage.page >= reportPage.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("Next")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
