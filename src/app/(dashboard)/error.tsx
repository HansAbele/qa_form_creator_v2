"use client";

import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface RouteErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}

export default function RouteError({ error, unstable_retry }: RouteErrorProps) {
  const router = useRouter();

  useEffect(() => {
    console.error("Application route error", error);
  }, [error]);

  return (
    <section
      aria-labelledby="dashboard-error-title"
      role="alert"
      className="flex min-h-[60vh] items-center justify-center py-8"
    >
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center text-center">
          <div
            aria-hidden="true"
            className="mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
          >
            <AlertTriangle className="size-6" />
          </div>
          <CardTitle>
            <h1 id="dashboard-error-title" className="text-xl font-semibold">
              No pudimos cargar esta sección
            </h1>
          </CardTitle>
          <CardDescription>
            Ocurrió un error inesperado. Puedes volver a intentarlo o regresar a la pantalla
            anterior.
          </CardDescription>
        </CardHeader>

        {error.digest && (
          <CardContent className="text-center">
            <p className="text-xs text-muted-foreground">
              Referencia del error: <code className="font-mono">{error.digest}</code>
            </p>
          </CardContent>
        )}

        <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            <ArrowLeft aria-hidden="true" />
            Volver
          </Button>
          <Button type="button" onClick={() => unstable_retry()}>
            <RotateCcw aria-hidden="true" />
            Reintentar
          </Button>
        </CardFooter>
      </Card>
    </section>
  );
}
