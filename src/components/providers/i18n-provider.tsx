"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  type TranslationValues,
  translate,
} from "@/lib/i18n";
import { updateMyLocale } from "@/server/actions/profile";

type I18nContextValue = {
  locale: Locale;
  isChangingLocale: boolean;
  setLocale: (locale: Locale) => void;
  t: (message: string, values?: TranslationValues) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  isChangingLocale: false,
  setLocale: () => {},
  t: (message, values) => translate(DEFAULT_LOCALE, message, values),
});

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(
    isLocale(initialLocale) ? initialLocale : DEFAULT_LOCALE,
  );
  const [isChangingLocale, startTransition] = useTransition();

  const setLocale = useCallback(
    (nextLocale: Locale) => {
      if (!isLocale(nextLocale) || nextLocale === locale) return;

      const previousLocale = locale;
      setLocaleState(nextLocale);
      document.documentElement.lang = nextLocale;
      startTransition(async () => {
        try {
          await updateMyLocale(nextLocale);
          router.refresh();
        } catch {
          setLocaleState(previousLocale);
          document.documentElement.lang = previousLocale;
          toast.error(
            translate(previousLocale, "We couldn't save your language preference. Try again."),
          );
        }
      });
    },
    [locale, router],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      isChangingLocale,
      setLocale,
      t: (message, values) => translate(locale, message, values),
    }),
    [isChangingLocale, locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
