"use client";

import { AlertTriangle, RotateCcw, SearchX } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-observability";

export type DataLoadStatus = "loading" | "success" | "empty" | "error";

export function reportDataLoadError(error: unknown, feature: string) {
  const reason = error instanceof Error ? error : new Error("Unknown client data-loading error");
  reportClientError({
    source: "client-runtime",
    name: reason.name,
    message: `${feature}: ${reason.message}`,
    stack: reason.stack,
  });
}

export function DataLoadError({
  onRetry,
  title,
  description,
  compact = false,
}: {
  onRetry: () => void;
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const resolvedTitle = title ?? t("Unable to load data");
  const resolvedDescription =
    description ?? t("The incident was logged. Try again in a few seconds.");

  return (
    <section
      role="alert"
      aria-live="assertive"
      className={`w-full rounded-xl border border-destructive/30 bg-destructive/5 text-center ${
        compact ? "p-4" : "mx-auto max-w-2xl p-8"
      }`}
    >
      <AlertTriangle
        aria-hidden="true"
        className={`mx-auto text-destructive ${compact ? "mb-2 h-6 w-6" : "mb-4 h-10 w-10"}`}
      />
      <h2 className={compact ? "font-semibold" : "text-xl font-semibold"}>{resolvedTitle}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{resolvedDescription}</p>
      <Button
        className={compact ? "mt-3" : "mt-6"}
        size={compact ? "sm" : "default"}
        onClick={onRetry}
      >
        <RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" />
        {t("Retry")}
      </Button>
    </section>
  );
}

export function RestrictedResourceState({ resourceLabel }: { resourceLabel?: string }) {
  const { t } = useI18n();
  const resolvedResourceLabel = resourceLabel ?? t("This content");

  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[280px] max-w-2xl flex-col items-center justify-center rounded-xl border bg-card p-8 text-center"
    >
      <SearchX aria-hidden="true" className="mb-4 h-10 w-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">
        {t("{resource} is unavailable", { resource: resolvedResourceLabel })}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("Check the link or ask your project administrator for access.")}
      </p>
    </section>
  );
}

export function DataEmptyState({ title, description }: { title?: string; description?: string }) {
  const { t } = useI18n();
  const resolvedTitle = title ?? t("No data available");
  const resolvedDescription =
    description ?? t("Adjust the filters or check back when new records are available.");

  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[280px] max-w-2xl flex-col items-center justify-center rounded-xl border bg-card p-8 text-center"
    >
      <SearchX aria-hidden="true" className="mb-4 h-10 w-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">{resolvedTitle}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{resolvedDescription}</p>
    </section>
  );
}
