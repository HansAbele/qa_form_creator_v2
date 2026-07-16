"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-observability";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportClientError({
      source: "client-boundary",
      name: error.name,
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <section
        role="alert"
        aria-labelledby="dashboard-error-title"
        className="w-full max-w-lg rounded-xl border bg-card p-8 text-center shadow-sm"
      >
        <AlertTriangle aria-hidden="true" className="mx-auto mb-4 h-10 w-10 text-destructive" />
        <h1 id="dashboard-error-title" className="text-xl font-semibold">
          No pudimos cargar esta sección
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          El incidente fue registrado. Puedes volver a intentarlo sin perder tu sesión.
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-muted-foreground">Referencia: {error.digest}</p>
        ) : null}
        <Button className="mt-6" onClick={unstable_retry}>
          <RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      </section>
    </main>
  );
}
