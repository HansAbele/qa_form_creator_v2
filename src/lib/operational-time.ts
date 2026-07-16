const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_OPERATIONAL_TIME_ZONE = "UTC";

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type OperationalRangeDaysInput = {
  dateFrom?: string;
  dateTo?: string;
  minDate?: Date | null;
  maxDate?: Date | null;
  now?: Date;
  timeZone?: string;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const dayStartCache = new Map<string, Date>();

function getDateFormatter(timeZone: string) {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function datePartsToKey({ year, month, day }: DateParts) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateOnly(value: string, fieldName = "fecha"): DateParts {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error(`${fieldName} debe usar el formato YYYY-MM-DD.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} no es una fecha valida.`);
  }

  return { year, month, day };
}

function normalizeOptionalDate(value: string | undefined, fieldName: string) {
  if (!value) return undefined;
  const normalized = value.trim();
  return datePartsToKey(parseDateOnly(normalized, fieldName));
}

function dateOnlyOrdinal(value: string) {
  const { year, month, day } = parseDateOnly(value);
  return Date.UTC(year, month - 1, day);
}

export function assertValidOperationalTimeZone(timeZone: string) {
  const normalized = timeZone.trim();
  if (!normalized) throw new Error("OPERATIONAL_TIME_ZONE no puede estar vacia.");

  try {
    getDateFormatter(normalized).format(new Date(0));
  } catch {
    formatterCache.delete(normalized);
    throw new Error(`OPERATIONAL_TIME_ZONE no es una zona IANA valida: ${normalized}`);
  }

  return normalized;
}

export function getOperationalTimeZone() {
  return assertValidOperationalTimeZone(
    process.env.OPERATIONAL_TIME_ZONE ?? DEFAULT_OPERATIONAL_TIME_ZONE,
  );
}

export function addDateOnlyDays(value: string, days: number) {
  if (!Number.isInteger(days)) throw new Error("days debe ser un entero.");
  const { year, month, day } = parseDateOnly(value);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return datePartsToKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

export function toOperationalDateKey(
  date: Date,
  timeZone = getOperationalTimeZone(),
) {
  const normalizedTimeZone = assertValidOperationalTimeZone(timeZone);
  const parts = getDateFormatter(normalizedTimeZone).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return datePartsToKey({
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  });
}

/**
 * Returns the first real instant that belongs to a local calendar date.
 * Binary search avoids hard-coded offsets and remains correct across DST.
 */
export function getOperationalDayStart(
  dateOnly: string,
  timeZone = getOperationalTimeZone(),
) {
  const normalizedDate = datePartsToKey(parseDateOnly(dateOnly));
  const normalizedTimeZone = assertValidOperationalTimeZone(timeZone);
  const cacheKey = `${normalizedTimeZone}:${normalizedDate}`;
  const cached = dayStartCache.get(cacheKey);
  if (cached) return new Date(cached);

  const target = dateOnlyOrdinal(normalizedDate);
  let low = target - 2 * DAY_MS;
  let high = target + 2 * DAY_MS;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (toOperationalDateKey(new Date(middle), normalizedTimeZone) < normalizedDate) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const result = new Date(low);
  if (toOperationalDateKey(result, normalizedTimeZone) !== normalizedDate) {
    throw new Error(`La fecha ${normalizedDate} no existe en ${normalizedTimeZone}.`);
  }

  if (dayStartCache.size >= 2_048) dayStartCache.clear();
  dayStartCache.set(cacheKey, result);
  return new Date(result);
}

export function getOperationalDateBounds(
  dateFrom?: string,
  dateTo?: string,
  timeZone = getOperationalTimeZone(),
) {
  const from = normalizeOptionalDate(dateFrom, "dateFrom");
  const to = normalizeOptionalDate(dateTo, "dateTo");
  if (from && to && from > to) {
    throw new Error("dateFrom no puede ser posterior a dateTo.");
  }

  return {
    ...(from ? { gte: getOperationalDayStart(from, timeZone) } : {}),
    ...(to ? { lt: getOperationalDayStart(addDateOnlyDays(to, 1), timeZone) } : {}),
  };
}

export function getOperationalRangeDays({
  dateFrom,
  dateTo,
  minDate,
  maxDate,
  now = new Date(),
  timeZone = getOperationalTimeZone(),
}: OperationalRangeDaysInput) {
  const from = normalizeOptionalDate(dateFrom, "dateFrom");
  const to = normalizeOptionalDate(dateTo, "dateTo");
  if (from && to && from > to) {
    throw new Error("dateFrom no puede ser posterior a dateTo.");
  }

  const today = toOperationalDateKey(now, timeZone);
  const firstDataDay = minDate ? toOperationalDateKey(minDate, timeZone) : undefined;
  const lastDataDay = maxDate ? toOperationalDateKey(maxDate, timeZone) : undefined;
  const start = from ?? firstDataDay ?? to ?? today;
  const end = to ?? (from ? today : lastDataDay ?? today);

  if (start > end) return 1;
  return Math.max(1, Math.floor((dateOnlyOrdinal(end) - dateOnlyOrdinal(start)) / DAY_MS) + 1);
}
