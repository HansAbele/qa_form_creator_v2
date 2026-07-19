"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { OperationalTimeProvider } from "@/components/providers/operational-time-provider";
import { I18nProvider } from "@/components/providers/i18n-provider";
import type { Locale } from "@/lib/i18n";

export function Providers({
  children,
  operationalTimeZone,
  locale,
}: {
  children: React.ReactNode;
  operationalTimeZone: string;
  locale: Locale;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <SessionProvider>
      <I18nProvider initialLocale={locale}>
        <OperationalTimeProvider timeZone={operationalTimeZone}>
          <QueryClientProvider client={queryClient}>
            <MotionConfig reducedMotion="user">
              <ThemeProvider defaultTheme="system" enableSystem disableTransitionOnChange>
                {children}
                <Toaster position="top-right" richColors />
              </ThemeProvider>
            </MotionConfig>
          </QueryClientProvider>
        </OperationalTimeProvider>
      </I18nProvider>
    </SessionProvider>
  );
}
