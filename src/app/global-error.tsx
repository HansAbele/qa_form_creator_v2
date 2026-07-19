"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { reportClientError } from "@/lib/client-observability";
import { isLocale, LOCALE_COOKIE, translate, type Locale } from "@/lib/i18n";
import "./globals.css";

function getDocumentLocale(fallback: Locale) {
  const cookieLocale = document.cookie
    .split(";")
    .map((cookie) => cookie.trim().split("="))
    .find(([name]) => name === LOCALE_COOKIE)?.[1];
  if (isLocale(cookieLocale)) return cookieLocale;

  const documentLocale = document.documentElement.lang.split("-")[0];
  return isLocale(documentLocale) ? documentLocale : fallback;
}

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const { locale: contextLocale } = useI18n();
  const [locale, setLocale] = useState<Locale>(contextLocale);
  const t = (message: string, values?: Record<string, string | number>) =>
    translate(locale, message, values);

  useEffect(() => {
    setLocale(getDocumentLocale(contextLocale));
  }, [contextLocale]);

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
    <html lang={locale}>
      <body>
        <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <section
            role="alert"
            aria-labelledby="global-error-title"
            className="w-full max-w-lg rounded-xl border bg-card p-8 text-center shadow-sm"
          >
            <title>{t("Unexpected Qore error")}</title>
            <h1 id="global-error-title" className="text-2xl font-semibold">
              {t("Qore encountered an unexpected problem")}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("The incident was logged. Try again to recover the application.")}
            </p>
            {error.digest ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("Reference: {reference}", { reference: error.digest })}
              </p>
            ) : null}
            <button
              type="button"
              onClick={unstable_retry}
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t("Retry")}
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
