import { describe, expect, it } from "vitest";
import { computeScore, type ScoringAnswer, type ScoringQuestion } from "./scoring";

function q(
  overrides: Partial<ScoringQuestion> & Pick<ScoringQuestion, "id" | "type">,
): ScoringQuestion {
  return {
    weight: 0,
    fatal: false,
    fatalOptions: [],
    requiresCommentOnFail: false,
    categoryId: null,
    ratingFailThreshold: null,
    ratingMax: null,
    weightedOptions: null,
    ...overrides,
  };
}

function answers(entries: Record<string, string | ScoringAnswer>): Map<string, ScoringAnswer> {
  const map = new Map<string, ScoringAnswer>();
  for (const [id, v] of Object.entries(entries)) {
    map.set(id, typeof v === "string" ? { value: v, notApplicable: false } : v);
  }
  return map;
}

const PASS = { passThreshold: 70 };

describe("computeScore", () => {
  it("computes a weighted rating average", () => {
    const r = computeScore(
      [q({ id: "a", type: "RATING", weight: 80 }), q({ id: "b", type: "RATING", weight: 20 })],
      answers({ a: "5", b: "1" }),
      PASS,
    );
    expect(r.score).toBe(84);
    expect(r.result).toBe("PASS");
  });

  it("derives PASS/FAIL from the canonical two-decimal persisted score", () => {
    const r = computeScore(
      [
        q({ id: "low", type: "RATING", weight: 50_025 }),
        q({ id: "high", type: "RATING", weight: 49_975 }),
      ],
      answers({ low: "3", high: "4" }),
      PASS,
    );

    // Raw weighted score is 69.995. Decimal(5,2) stores 70.00, therefore the
    // authoritative verdict must also be PASS.
    expect(r.score).toBe(70);
    expect(r.result).toBe("PASS");
  });

  it("excludes N/A answers from numerator and denominator", () => {
    const r = computeScore(
      [q({ id: "a", type: "RATING", weight: 80 }), q({ id: "b", type: "RATING", weight: 20 })],
      answers({ a: "5", b: { value: "", notApplicable: true } }),
      PASS,
    );
    expect(r.score).toBe(100);
  });

  it("does NOT fail a rating of 4/5 (above the default fail threshold)", () => {
    const r = computeScore(
      [q({ id: "a", type: "RATING", weight: 100, fatal: true, requiresCommentOnFail: true })],
      answers({ a: "4" }),
      PASS,
    );
    expect(r.questions[0].failed).toBe(false);
    expect(r.hasFatalFail).toBe(false);
    expect(r.blockers).toBe(0);
    expect(r.result).toBe("PASS");
  });

  it("fails a rating below the threshold and forces FAIL when fatal, even if score passes", () => {
    const r = computeScore(
      [
        q({ id: "crit", type: "RATING", weight: 20, fatal: true }),
        q({ id: "ok", type: "RATING", weight: 80 }),
      ],
      answers({ crit: "2", ok: "5" }),
      PASS,
    );
    expect(r.score).toBe(88); // weighted score passes...
    expect(r.hasFatalFail).toBe(true); // ...but the critical overlay fails it
    expect(r.result).toBe("FAIL");
  });

  it("scores a rating on a configurable 1-10 scale", () => {
    const r = computeScore(
      [q({ id: "a", type: "RATING", weight: 100, ratingMax: 10 })],
      answers({ a: "8" }),
      PASS,
    );
    expect(r.score).toBe(80); // 8 of 10 → 80%
  });

  it("honors a per-question ratingFailThreshold", () => {
    const r = computeScore(
      [q({ id: "a", type: "RATING", weight: 100, fatal: true, ratingFailThreshold: 5 })],
      answers({ a: "4" }), // 4 < 5 → fails under the stricter threshold
      PASS,
    );
    expect(r.hasFatalFail).toBe(true);
    expect(r.result).toBe("FAIL");
  });

  it("scores weighted options (partial credit) for a select", () => {
    const r = computeScore(
      [
        q({
          id: "s",
          type: "SELECT",
          weight: 100,
          weightedOptions: [
            { value: "full", points: 2 },
            { value: "partial", points: 1 },
            { value: "no", points: 0 },
          ],
        }),
      ],
      answers({ s: "partial" }),
      PASS,
    );
    expect(r.score).toBe(50); // 1 of 2 points → 50% of the weight
  });

  it("treats legacy plain-option selects as non-scored (fatal-only)", () => {
    const r = computeScore(
      [
        q({ id: "rate", type: "RATING", weight: 0 }),
        q({
          id: "sel",
          type: "SELECT",
          fatal: true,
          fatalOptions: ["No"],
          requiresCommentOnFail: true,
        }),
      ],
      answers({ rate: "4", sel: "No" }),
      PASS,
    );
    expect(r.questions.find((x) => x.questionId === "sel")?.scored).toBe(false);
    expect(r.hasFatalFail).toBe(true);
    expect(r.blockers).toBe(1); // fatal select failed with no comment
    expect(r.result).toBe("FAIL");
  });

  it("zeroes the score when fatalZeroesScore is enabled", () => {
    const r = computeScore(
      [q({ id: "a", type: "RATING", weight: 100, fatal: true })],
      answers({ a: "1" }),
      { passThreshold: 70, fatalZeroesScore: true },
    );
    expect(r.score).toBe(0);
    expect(r.result).toBe("FAIL");
  });
});
