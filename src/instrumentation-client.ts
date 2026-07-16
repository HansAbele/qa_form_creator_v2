import { reportClientError } from "@/lib/client-observability";

declare global {
  interface Window {
    __qoreErrorInstrumentationInstalled?: boolean;
  }
}

if (!window.__qoreErrorInstrumentationInstalled) {
  window.__qoreErrorInstrumentationInstalled = true;

  window.addEventListener("error", (event) => {
    const error = event.error instanceof Error ? event.error : undefined;
    reportClientError({
      source: "client-runtime",
      name: error?.name ?? "WindowError",
      message: error?.message ?? event.message ?? "Error de navegador sin detalle.",
      stack: error?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const error = event.reason instanceof Error ? event.reason : undefined;
    reportClientError({
      source: "client-runtime",
      name: error?.name ?? "UnhandledRejection",
      message: error?.message ?? String(event.reason ?? "Promesa rechazada sin detalle."),
      stack: error?.stack,
    });
  });
}
