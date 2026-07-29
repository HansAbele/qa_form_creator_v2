"use client";

import { AlertTriangle, Check, ChevronDown, Headphones, Loader2, Search, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatOperationalTimestamp } from "@/lib/date-display";
import { cn } from "@/lib/utils";

export type EvaluationEvidenceItem = {
  id: string;
  formId: string;
  formTitle: string;
  score: number;
  result: string | null;
  hasFatalFail: boolean;
  submittedAt: string | null;
  interaction: {
    id: string;
    providerInteractionId: string;
    startedAt: string;
    phoneNumber: string | null;
    hasRecording: boolean;
  } | null;
};

type EvidenceResponse = {
  items: EvaluationEvidenceItem[];
  nextCursor: string | null;
};

export function EvaluationEvidencePicker({
  campaignId,
  agentId,
  scope,
  templateKey = "CUSTOM",
  selectionMode,
  selected,
  onSelectionChange,
}: {
  campaignId: string;
  agentId: string;
  scope: "coaching" | "pip";
  templateKey?: "PARKER_DAVIS" | "HAPUSA" | "CUSTOM";
  selectionMode: "single" | "multiple";
  selected: EvaluationEvidenceItem[];
  onSelectionChange: (items: EvaluationEvidenceItem[]) => void;
}) {
  const { locale, t } = useI18n();
  const timeZone = useOperationalTimeZone();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<EvaluationEvidenceItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const fetchEvidence = useCallback(
    async (cursor?: string, signal?: AbortSignal) => {
      const params = new URLSearchParams({
        campaignId,
        agentId,
        scope,
        templateKey,
      });
      if (deferredQuery.trim()) params.set("query", deferredQuery.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(`/api/performance/evidence/evaluations?${params}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error(t("Unable to search evaluation evidence"));
      return (await response.json()) as EvidenceResponse;
    },
    [agentId, campaignId, deferredQuery, from, scope, t, templateKey, to],
  );

  useEffect(() => {
    if (!campaignId || !agentId) {
      setItems([]);
      setNextCursor(null);
      setError("");
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetchEvidence(undefined, controller.signal)
      .then((result) => {
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((requestError) => {
        if ((requestError as Error).name !== "AbortError") {
          setError(
            requestError instanceof Error
              ? requestError.message
              : t("Unable to search evaluation evidence"),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [agentId, campaignId, fetchEvidence, t]);

  const toggle = (item: EvaluationEvidenceItem) => {
    if (selectionMode === "single") {
      onSelectionChange(selected.some((current) => current.id === item.id) ? [] : [item]);
      return;
    }
    onSelectionChange(
      selected.some((current) => current.id === item.id)
        ? selected.filter((current) => current.id !== item.id)
        : [...selected, item],
    );
  };

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    void fetchEvidence(nextCursor)
      .then((result) => {
        setItems((current) => [
          ...current,
          ...result.items.filter((item) => !current.some((existing) => existing.id === item.id)),
        ]);
        setNextCursor(result.nextCursor);
      })
      .catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : t("Unable to search evaluation evidence"),
        );
      })
      .finally(() => setLoadingMore(false));
  };

  if (!agentId) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
        {t("Select an agent to search their evaluations and calls.")}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/15 p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium text-foreground">{t("Search scorecard or call")}</p>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 pl-9"
              placeholder={t("Scorecard name, call ID, or phone number")}
              aria-label={t("Search scorecard or call")}
              maxLength={120}
            />
          </div>
        </div>
        <DateRangeFilter
          id={`${scope}-evidence-date-range`}
          from={from}
          to={to}
          onApply={(nextFrom, nextTo) => {
            setFrom(nextFrom);
            setTo(nextTo);
          }}
          label={t("Call or evaluation date")}
          align="end"
          className="lg:w-72"
        />
      </div>

      {templateKey !== "CUSTOM" ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Check className="size-3.5 text-primary" />
          <span>
            {templateKey === "HAPUSA"
              ? t("Only HAPUSA scorecards are shown.")
              : t("Only Parker Davis scorecards are shown.")}
          </span>
        </div>
      ) : null}

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((item) => (
            <Badge key={item.id} variant="outline" className="max-w-full gap-1.5 py-1">
              <span className="truncate">
                {item.formTitle} · {item.score.toFixed(1)}%
              </span>
              <button
                type="button"
                className="rounded-sm outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("Remove selected evidence")}
                onClick={() => toggle(item)}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="max-h-72 overflow-y-auto rounded-lg border bg-background">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("Searching evaluations…")}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t("No evaluations match the selected filters.")}
          </div>
        ) : (
          <div className="divide-y">
            {items.map((item) => {
              const checked = selected.some((current) => current.id === item.id);
              const evaluatedAt = item.submittedAt ?? item.interaction?.startedAt ?? null;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggle(item)}
                  className={cn(
                    "flex w-full items-start gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    checked && "bg-primary/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center border",
                      selectionMode === "single" ? "rounded-full" : "rounded",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background",
                    )}
                  >
                    {checked ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.formTitle}</span>
                      <Badge variant={item.hasFatalFail ? "destructive" : "secondary"}>
                        {item.score.toFixed(1)}%
                      </Badge>
                      {item.hasFatalFail ? (
                        <Badge variant="destructive">{t("Critical failure")}</Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {evaluatedAt
                          ? formatOperationalTimestamp(
                              evaluatedAt,
                              timeZone,
                              { dateStyle: "medium", timeStyle: "short" },
                              locale,
                            )
                          : t("Date unavailable")}
                      </span>
                      {item.interaction ? (
                        <span className="inline-flex items-center gap-1">
                          <Headphones className="size-3" />
                          {item.interaction.providerInteractionId}
                          {item.interaction.hasRecording
                            ? ` · ${t("Recording available")}`
                            : ` · ${t("No recording")}`}
                        </span>
                      ) : (
                        <span>{t("No linked call")}</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("Results are loaded from Qore in pages of 25.")}
        </p>
        {nextCursor ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {t("Load more")}
            {!loadingMore ? <ChevronDown data-icon="inline-end" /> : null}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
