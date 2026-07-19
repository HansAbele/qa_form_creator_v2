export const DEFAULT_EXPORT_LIMITS = {
  maxEvaluations: 1_000,
  maxAnswerRows: 10_000,
  maxQuestionColumns: 100,
  maxCells: 100_000,
  maxTextBytes: 8_000_000,
  maxRequestsPerMinute: 4,
  maxConcurrentPerUser: 1,
  maxConcurrentGlobal: 2,
  leaseTimeoutSeconds: 900,
} as const;

export const HARD_MAX_EXPORT_LIMITS = {
  maxEvaluations: 2_500,
  maxAnswerRows: 25_000,
  maxQuestionColumns: 200,
  maxCells: 250_000,
  maxTextBytes: 16_000_000,
  maxRequestsPerMinute: 60,
  maxConcurrentPerUser: 2,
  maxConcurrentGlobal: 4,
  leaseTimeoutSeconds: 3_600,
} as const;

export class ExportLimitError extends Error {
  readonly code = "EXPORT_LIMIT_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "ExportLimitError";
  }
}

export class ExportNoDataError extends Error {
  readonly code = "NO_EXPORT_DATA";

  constructor() {
    super("No evaluations match the selected filters.");
    this.name = "ExportNoDataError";
  }
}

export class ExportRateLimitError extends Error {
  readonly code = "EXPORT_RATE_LIMITED";

  constructor(readonly retryAfterSeconds = 60) {
    super("The export rate limit was reached. Wait a moment and try again.");
    this.name = "ExportRateLimitError";
  }
}

export class ExportBusyError extends Error {
  readonly code = "EXPORT_BUSY";

  constructor(readonly retryAfterSeconds = 30) {
    super("An export is already in progress for this user.");
    this.name = "ExportBusyError";
  }
}

export class ExportGlobalBusyError extends Error {
  readonly code = "EXPORT_GLOBAL_BUSY";

  constructor(readonly retryAfterSeconds = 30) {
    super(
      "Global export capacity is busy. Wait a moment and try again.",
    );
    this.name = "ExportGlobalBusyError";
  }
}

function readExportLimit(name: string, fallback: number, hardMaximum: number, hardMinimum = 1) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < hardMinimum || parsed > hardMaximum) {
    throw new Error(`${name} must be an integer between ${hardMinimum} and ${hardMaximum}.`);
  }
  return parsed;
}

export function getExportLimits() {
  return {
    maxEvaluations: readExportLimit(
      "EXPORT_MAX_EVALUATIONS",
      DEFAULT_EXPORT_LIMITS.maxEvaluations,
      HARD_MAX_EXPORT_LIMITS.maxEvaluations,
    ),
    maxAnswerRows: readExportLimit(
      "EXPORT_MAX_ANSWER_ROWS",
      DEFAULT_EXPORT_LIMITS.maxAnswerRows,
      HARD_MAX_EXPORT_LIMITS.maxAnswerRows,
    ),
    maxQuestionColumns: readExportLimit(
      "EXPORT_MAX_QUESTION_COLUMNS",
      DEFAULT_EXPORT_LIMITS.maxQuestionColumns,
      HARD_MAX_EXPORT_LIMITS.maxQuestionColumns,
    ),
    maxCells: readExportLimit(
      "EXPORT_MAX_CELLS",
      DEFAULT_EXPORT_LIMITS.maxCells,
      HARD_MAX_EXPORT_LIMITS.maxCells,
    ),
    maxTextBytes: readExportLimit(
      "EXPORT_MAX_TEXT_BYTES",
      DEFAULT_EXPORT_LIMITS.maxTextBytes,
      HARD_MAX_EXPORT_LIMITS.maxTextBytes,
    ),
    maxRequestsPerMinute: readExportLimit(
      "EXPORT_MAX_REQUESTS_PER_MINUTE",
      DEFAULT_EXPORT_LIMITS.maxRequestsPerMinute,
      HARD_MAX_EXPORT_LIMITS.maxRequestsPerMinute,
    ),
    maxConcurrentPerUser: readExportLimit(
      "EXPORT_MAX_CONCURRENT_PER_USER",
      DEFAULT_EXPORT_LIMITS.maxConcurrentPerUser,
      HARD_MAX_EXPORT_LIMITS.maxConcurrentPerUser,
    ),
    maxConcurrentGlobal: readExportLimit(
      "EXPORT_MAX_CONCURRENT_GLOBAL",
      DEFAULT_EXPORT_LIMITS.maxConcurrentGlobal,
      HARD_MAX_EXPORT_LIMITS.maxConcurrentGlobal,
    ),
    leaseTimeoutSeconds: readExportLimit(
      "EXPORT_LEASE_TIMEOUT_SECONDS",
      DEFAULT_EXPORT_LIMITS.leaseTimeoutSeconds,
      HARD_MAX_EXPORT_LIMITS.leaseTimeoutSeconds,
      60,
    ),
  };
}
