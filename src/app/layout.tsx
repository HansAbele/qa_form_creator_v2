import type { Metadata } from "next";
import { NavigationGuardRuntime } from "@/components/navigation/navigation-guard-runtime";
import { getOperationalTimeZone } from "@/lib/operational-time";
import { getRequestLocale } from "@/lib/i18n-server";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Qore - The core of quality",
  description:
    "Qore — quality management and evaluation software for bilingual contact center operations. Powered by TNO.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const operationalTimeZone = getOperationalTimeZone();
  const locale = await getRequestLocale();

  return (
    <html lang={locale} data-operational-time-zone={operationalTimeZone} suppressHydrationWarning>
      <body className="min-h-dvh bg-background font-sans antialiased">
        <NavigationGuardRuntime />
        <Providers operationalTimeZone={operationalTimeZone} locale={locale}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
