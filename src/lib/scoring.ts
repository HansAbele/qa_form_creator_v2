/**
 * Shared, dependency-free QA scoring engine.
 *
 * Used by BOTH the client (live preview in the evaluation form) and the server
 * (authoritative scoring in `responses.ts`) so the estimate the evaluator sees
 * matches the stored verdict exactly.
 *
 * Model (owner-approved 2026-07-01, grounded in COPC + industry):
 *  - Weighted score: Σ(fraction · weight) / Σ(weight) · 100 over applicable
 *    SCORED questions. N/A answers are excluded from numerator AND denominator.
 *  - Criticality is ORTHOGONAL to weight: a `fatal` question that "fails"
 *    forces result = FAIL regardless of score (COPC 3.5.1.e).
 *  - PASS iff (no fatal fail) AND (score ≥ passThreshold).
 *  - A RATING "fails" when its value < ratingFailThreshold (default 3 ⇒ ≤2 on
 *    a 1-5 scale). A SELECT/RADIO/BOOLEAN "fails" when the chosen value is a
 *    fatal option. This subsumes the older "< passThreshold" idea as config.
 *
 * Backward compatibility: legacy SELECT/RADIO with plain string options and
 * weight 0 stay NON-scored (fatal-only), so historical rating-only forms keep
 * the exact same score.
 */

export const DEFAULT_RATING_MAX = 5;
export const DEFAULT_RATING_FAIL_THRESHOLD = 3;

export type ScoringQuestionType = "TEXT" | "RATING" | "SELECT" | "RADIO" | "BOOLEAN";

/** Weighted option: choosing `value` awards `points` (0..maxPoints). */
export interface WeightedOption {
  value: string;
  points: number;
}

export interface ScoringQuestion {
  id: string;
  type: ScoringQuestionType;
  weight: number;
  fatal: boolean;
  fatalOptions: string[];
  requiresCommentOnFail: boolean;
  categoryId: string | null;
  /** For a fatal/graded RATING: fails when value < threshold. Null → default (3). */
  ratingFailThreshold: number | null;
  /** Configurable rating scale max. Null → default (5). */
  ratingMax: number | null;
  /** Weighted options for SELECT/RADIO/BOOLEAN. Null/empty → non-scored (fatal-only). */
  weightedOptions: WeightedOption[] | null;
}

export interface ScoringAnswer {
  value: string;
  notApplicable: boolean;
  comment?: string | null;
}

export interface QuestionScore {
  questionId: string;
  applicable: boolean;
  /** true when this question type contributes to the weighted score. */
  scored: boolean;
  /** 0..1 achievement; null when non-scored or N/A. */
  fraction: number | null;
  /** fraction · 100, for storing per-answer score; null when non-scored/N-A. */
  itemScore: number | null;
  failed: boolean;
  isFatalFail: boolean;
  needsComment: boolean;
  categoryId: string | null;
  weight: number;
}

export interface CategoryScore {
  categoryId: string | null;
  /** Sum of weights of scored+applicable questions in this category. */
  weight: number;
  /** Sum of (fraction · weight) earned in this category. */
  earned: number;
}

export interface ScoreResult {
  score: number;
  hasFatalFail: boolean;
  passThreshold: number;
  result: "PASS" | "FAIL";
  blockers: number;
  questions: QuestionScore[];
  perCategory: CategoryScore[];
}

export function ratingMaxOf(q: Pick<ScoringQuestion, "ratingMax">): number {
  return q.ratingMax && q.ratingMax > 0 ? q.ratingMax : DEFAULT_RATING_MAX;
}

export function ratingFailThresholdOf(q: Pick<ScoringQuestion, "ratingFailThreshold">): number {
  return q.ratingFailThreshold && q.ratingFailThreshold > 0
    ? q.ratingFailThreshold
    : DEFAULT_RATING_FAIL_THRESHOLD;
}

/** Numeric rating value if valid within [1, max], else null. */
export function parseRating(value: string, max: number): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

/** Achievement fraction in [0,1] for a scored question, or null if non-scored. */
function questionFraction(q: ScoringQuestion, value: string): number | null {
  if (q.type === "RATING") {
    const max = ratingMaxOf(q);
    const n = parseRating(value, max);
    return n === null ? 0 : n / max;
  }
  if (q.type === "SELECT" || q.type === "RADIO" || q.type === "BOOLEAN") {
    const opts = q.weightedOptions;
    if (!opts || opts.length === 0) return null; // legacy plain options → non-scored
    const maxPoints = Math.max(...opts.map((o) => o.points), 0);
    if (maxPoints <= 0) return 0;
    const chosen = opts.find((o) => o.value === value);
    return chosen ? Math.max(0, Math.min(1, chosen.points / maxPoints)) : 0;
  }
  return null; // TEXT
}

/** Does this answer "fail" (drives comment-required and fatal auto-fail)? */
export function isFailed(q: ScoringQuestion, value: string): boolean {
  if (!value) return false;
  if (q.type === "RATING") {
    const n = parseRating(value, ratingMaxOf(q));
    return n !== null && n < ratingFailThresholdOf(q);
  }
  if (q.type === "SELECT" || q.type === "RADIO" || q.type === "BOOLEAN") {
    return q.fatalOptions.includes(value);
  }
  return false;
}

export function computeScore(
  questions: ScoringQuestion[],
  answers: Map<string, ScoringAnswer>,
  opts: { passThreshold: number; fatalZeroesScore?: boolean },
): ScoreResult {
  const results: QuestionScore[] = [];
  const categories = new Map<string, CategoryScore>();

  for (const q of questions) {
    const answer = answers.get(q.id);
    const notApplicable = Boolean(answer?.notApplicable);
    const value = notApplicable ? "" : (answer?.value ?? "");
    const applicable = !notApplicable;

    const fraction = applicable ? questionFraction(q, value) : null;
    const scored = fraction !== null;
    const failed = applicable && isFailed(q, value);
    const isFatalFail = applicable && q.fatal && failed;
    const needsComment =
      applicable && q.requiresCommentOnFail && failed && !answer?.comment?.trim();

    results.push({
      questionId: q.id,
      applicable,
      scored,
      fraction,
      itemScore: fraction === null ? null : fraction * 100,
      failed,
      isFatalFail,
      needsComment,
      categoryId: q.categoryId,
      weight: q.weight,
    });

    if (scored && fraction !== null) {
      const key = q.categoryId ?? "__none__";
      const cat = categories.get(key) ?? { categoryId: q.categoryId, weight: 0, earned: 0 };
      cat.weight += q.weight;
      cat.earned += fraction * q.weight;
      categories.set(key, cat);
    }
  }

  const scoredResults = results.filter((r) => r.scored && r.fraction !== null);
  const totalWeight = scoredResults.reduce((sum, r) => sum + r.weight, 0);

  let score = 0;
  if (scoredResults.length > 0) {
    if (totalWeight > 0) {
      score = scoredResults.reduce((sum, r) => sum + (r.fraction ?? 0) * r.weight, 0) / totalWeight;
      score *= 100;
    } else {
      // All weights zero → equal-weight average (matches legacy fallback).
      score =
        (scoredResults.reduce((sum, r) => sum + (r.fraction ?? 0), 0) / scoredResults.length) * 100;
    }
  }

  const hasFatalFail = results.some((r) => r.isFatalFail);
  if (hasFatalFail && opts.fatalZeroesScore) score = 0;

  const blockers = results.filter((r) => r.needsComment).length;
  const result: "PASS" | "FAIL" =
    hasFatalFail || score < opts.passThreshold ? "FAIL" : "PASS";

  return {
    score,
    hasFatalFail,
    passThreshold: opts.passThreshold,
    result,
    blockers,
    questions: results,
    perCategory: Array.from(categories.values()),
  };
}
