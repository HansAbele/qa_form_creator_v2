"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { OperationalTimeProvider } from "@/components/providers/operational-time-provider";

export function Providers({
  children,
  operationalTimeZone,
}: {
  children: React.ReactNode;
  operationalTimeZone: string;
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
    <OperationalTimeProvider timeZone={operationalTimeZone}>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <MotionConfig reducedMotion="user">
            <ThemeProvider defaultTheme="system" enableSystem disableTransitionOnChange>
              {children}
              <Toaster position="top-right" richColors />
            </ThemeProvider>
          </MotionConfig>
        </QueryClientProvider>
      </SessionProvider>
    </OperationalTimeProvider>
  );
}
