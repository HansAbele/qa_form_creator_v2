import type { Metadata } from "next";
import { NavigationGuardRuntime } from "@/components/navigation/navigation-guard-runtime";
import { getOperationalTimeZone } from "@/lib/operational-time";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Qore - The core of quality",
  description:
    "Qore - Plataforma de evaluacion de calidad para campanas de call center. Powered by TNO.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const operationalTimeZone = getOperationalTimeZone();

  return (
    <html
      lang="es"
      data-operational-time-zone={operationalTimeZone}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <NavigationGuardRuntime />
        <Providers operationalTimeZone={operationalTimeZone}>{children}</Providers>
      </body>
    </html>
  );
}
