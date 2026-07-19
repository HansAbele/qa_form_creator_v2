import "server-only";

import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  translate,
  type TranslationValues,
} from "@/lib/i18n";

export async function getRequestLocale() {
  const session = await auth();
  if (isLocale(session?.user.locale)) return session.user.locale;

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  return isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
}

export async function getServerI18n() {
  const locale = await getRequestLocale();

  return {
    locale,
    t: (message: string, values?: TranslationValues) => translate(locale, message, values),
  };
}
