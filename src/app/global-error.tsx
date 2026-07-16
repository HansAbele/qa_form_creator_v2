"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-observability";
import "./globals.css";

export default function GlobalError({
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
    <html lang="es">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <section
            role="alert"
            aria-labelledby="global-error-title"
            className="w-full max-w-lg rounded-xl border bg-card p-8 text-center shadow-sm"
          >
            <title>Error de Qore</title>
            <h1 id="global-error-title" className="text-2xl font-semibold">
              Qore encontró un problema inesperado
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              El incidente fue registrado. Reintenta la operación para recuperar la aplicación.
            </p>
            {error.digest ? (
              <p className="mt-2 text-xs text-muted-foreground">Referencia: {error.digest}</p>
            ) : null}
            <button
              type="button"
              onClick={unstable_retry}
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Reintentar
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
