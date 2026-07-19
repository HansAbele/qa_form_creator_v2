import { Home, SearchX } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerI18n } from "@/lib/i18n-server";

export default async function NotFound() {
  const { t } = await getServerI18n();

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
              {t("Page not found")}
            </h1>
          </CardTitle>
          <CardDescription>
            {t("The requested address does not exist, was moved, or is no longer available.")}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex justify-center">
          <Link href="/" className={buttonVariants({ size: "lg" })}>
            <Home aria-hidden="true" />
            {t("Return home")}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
