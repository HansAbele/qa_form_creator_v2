"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Application root error", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          boxSizing: "border-box",
          background: "#f3f4f7",
          color: "#0f1a2a",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <title>Error de Qore</title>
        <main
          role="alert"
          aria-labelledby="global-error-title"
          style={{
            width: "min(100%, 520px)",
            padding: "32px",
            border: "1px solid #d8dce5",
            borderRadius: "16px",
            background: "white",
            textAlign: "center",
            boxShadow: "0 12px 32px rgb(15 26 42 / 10%)",
          }}
        >
          <h1 id="global-error-title" style={{ margin: "0 0 12px", fontSize: "24px" }}>
            Qore no pudo iniciar
          </h1>
          <p style={{ margin: "0 0 20px", color: "#546072", lineHeight: 1.5 }}>
            Ocurrió un error inesperado al cargar la aplicación. Intenta nuevamente.
          </p>
          {error.digest && (
            <p style={{ margin: "0 0 20px", color: "#546072", fontSize: "12px" }}>
              Referencia: <code>{error.digest}</code>
            </p>
          )}
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              minHeight: "44px",
              border: 0,
              borderRadius: "8px",
              padding: "0 20px",
              background: "#f2621a",
              color: "white",
              fontSize: "15px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
