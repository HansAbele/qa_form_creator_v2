import { translate } from "@/lib/i18n";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DEFAULT_DATE_DISPLAY_LOCALE = "en-US";
export const UNAVAILABLE_DATE_LABEL = "Date unavailable";

type DateTimeInput = Date | string | number;
type DisplayFormatOptions = Omit<Intl.DateTimeFormatOptions, "timeZone">;

const DEFAULT_DATE_OPTIONS: DisplayFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

const DEFAULT_TIMESTAMP_OPTIONS: DisplayFormatOptions = {
  dateStyle: "short",
  timeStyle: "short",
};

function localeStrings(locale: Intl.LocalesArgument): string[] {
  if (locale === undefined) return [DEFAULT_DATE_DISPLAY_LOCALE];
  if (typeof locale === "string") return [locale];
  if (locale instanceof Intl.Locale) return [locale.toString()];
  return Array.from(locale, (item) => (item instanceof Intl.Locale ? item.toString() : item));
}

export function getUnavailableDateLabel(
  locale: Intl.LocalesArgument = DEFAULT_DATE_DISPLAY_LOCALE,
) {
  try {
    const canonicalLocale = Intl.getCanonicalLocales(localeStrings(locale))[0];
    return translate(
      canonicalLocale?.toLowerCase().startsWith("es") ? "es" : "en",
      "Date unavailable",
    );
  } catch {
    return UNAVAILABLE_DATE_LABEL;
  }
}

function parseDateOnly(value: string) {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Formats a calendar-only value without interpreting it as a UTC timestamp.
 * `new Date("YYYY-MM-DD")` can render the previous day west of UTC; pinning
 * this synthetic date to UTC preserves the operational calendar day.
 */
export function formatDateOnlyForDisplay(
  value: string,
  options: DisplayFormatOptions = DEFAULT_DATE_OPTIONS,
  locale: Intl.LocalesArgument = DEFAULT_DATE_DISPLAY_LOCALE,
) {
  const date = parseDateOnly(value);
  if (!date) return getUnavailableDateLabel(locale);

  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: "UTC",
    }).format(date);
  } catch {
    return getUnavailableDateLabel(locale);
  }
}

/** Formats a real instant in the install-wide operational IANA time zone. */
export function formatOperationalTimestamp(
  value: DateTimeInput,
  timeZone: string,
  options: DisplayFormatOptions = DEFAULT_TIMESTAMP_OPTIONS,
  locale: Intl.LocalesArgument = DEFAULT_DATE_DISPLAY_LOCALE,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return getUnavailableDateLabel(locale);

  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone,
    }).format(date);
  } catch {
    return getUnavailableDateLabel(locale);
  }
}
