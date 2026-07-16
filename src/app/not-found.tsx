import { Home, SearchX } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main
      aria-labelledby="not-found-title"
      className="flex min-h-screen items-center justify-center bg-muted/30 p-6"
    >
      <Card className="w-full max-w-lg text-center">
        <CardHeader className="items-center">
          <div
            aria-hidden="true"
            className="mb-2 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <SearchX className="size-7" />
          </div>
          <p className="text-sm font-semibold text-primary">Error 404</p>
          <CardTitle>
            <h1 id="not-found-title" className="text-2xl font-semibold">
              Página no encontrada
            </h1>
          </CardTitle>
          <CardDescription>
            La dirección solicitada no existe, fue movida o ya no está disponible.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex justify-center">
          <Link href="/" className={buttonVariants({ size: "lg" })}>
            <Home aria-hidden="true" />
            Volver al inicio
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
