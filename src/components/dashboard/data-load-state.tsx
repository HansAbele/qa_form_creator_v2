"use client";

import { AlertTriangle, RotateCcw, SearchX } from "lucide-react";
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
  title = "No pudimos cargar los datos",
  description = "El incidente fue registrado. Intenta nuevamente en unos segundos.",
  compact = false,
}: {
  onRetry: () => void;
  title?: string;
  description?: string;
  compact?: boolean;
}) {
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
      <h2 className={compact ? "font-semibold" : "text-xl font-semibold"}>{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <Button
        className={compact ? "mt-3" : "mt-6"}
        size={compact ? "sm" : "default"}
        onClick={onRetry}
      >
        <RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" />
        Reintentar
      </Button>
    </section>
  );
}

export function RestrictedResourceState({
  resourceLabel = "Este contenido",
}: {
  resourceLabel?: string;
}) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[280px] max-w-2xl flex-col items-center justify-center rounded-xl border bg-card p-8 text-center"
    >
      <SearchX aria-hidden="true" className="mb-4 h-10 w-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">{resourceLabel} no está disponible</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Verifica el enlace o solicita acceso al responsable del proyecto.
      </p>
    </section>
  );
}

export function DataEmptyState({
  title = "No hay datos disponibles",
  description = "Ajusta los filtros o vuelve a consultar cuando existan nuevos registros.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[280px] max-w-2xl flex-col items-center justify-center rounded-xl border bg-card p-8 text-center"
    >
      <SearchX aria-hidden="true" className="mb-4 h-10 w-10 text-muted-foreground" />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </section>
  );
}
