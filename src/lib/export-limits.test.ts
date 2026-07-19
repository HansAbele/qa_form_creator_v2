import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_LIMITS, getExportLimits, HARD_MAX_EXPORT_LIMITS } from "./export-limits";

const EXPORT_ENV_KEYS = [
  "EXPORT_MAX_EVALUATIONS",
  "EXPORT_MAX_ANSWER_ROWS",
  "EXPORT_MAX_QUESTION_COLUMNS",
  "EXPORT_MAX_CELLS",
  "EXPORT_MAX_TEXT_BYTES",
  "EXPORT_MAX_REQUESTS_PER_MINUTE",
  "EXPORT_MAX_CONCURRENT_PER_USER",
  "EXPORT_MAX_CONCURRENT_GLOBAL",
  "EXPORT_LEASE_TIMEOUT_SECONDS",
] as const;

describe("export limits", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses conservative defaults when no override is configured", () => {
    for (const key of EXPORT_ENV_KEYS) vi.stubEnv(key, undefined);
    expect(getExportLimits()).toEqual(DEFAULT_EXPORT_LIMITS);
    expect(DEFAULT_EXPORT_LIMITS).toMatchObject({
      maxEvaluations: 1_000,
      maxAnswerRows: 10_000,
      maxCells: 100_000,
      maxTextBytes: 8_000_000,
      maxConcurrentPerUser: 1,
      maxConcurrentGlobal: 2,
    });
  });

  it("rejects overrides above the memory and global-concurrency hard caps", () => {
    vi.stubEnv("EXPORT_MAX_TEXT_BYTES", "16000001");
    expect(() => getExportLimits()).toThrow("EXPORT_MAX_TEXT_BYTES");

    vi.stubEnv("EXPORT_MAX_TEXT_BYTES", "8000000");
    vi.stubEnv("EXPORT_MAX_CONCURRENT_GLOBAL", "5");
    expect(() => getExportLimits()).toThrow("EXPORT_MAX_CONCURRENT_GLOBAL");

    vi.stubEnv("EXPORT_MAX_CONCURRENT_GLOBAL", "2");
    vi.stubEnv("EXPORT_LEASE_TIMEOUT_SECONDS", "59");
    expect(() => getExportLimits()).toThrow("between 60 and 3600");
    expect(HARD_MAX_EXPORT_LIMITS).toMatchObject({
      maxEvaluations: 2_500,
      maxAnswerRows: 25_000,
      maxCells: 250_000,
      maxTextBytes: 16_000_000,
      maxConcurrentPerUser: 2,
      maxConcurrentGlobal: 4,
    });
  });
});
