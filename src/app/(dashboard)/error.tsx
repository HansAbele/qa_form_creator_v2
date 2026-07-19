"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-observability";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const { t } = useI18n();

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
          {t("Unable to load this section")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("The incident was logged. You can try again without losing your session.")}
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Reference: {reference}", { reference: error.digest })}
          </p>
        ) : null}
        <Button className="mt-6" onClick={unstable_retry}>
          <RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" />
          {t("Retry")}
        </Button>
      </section>
    </main>
  );
}
