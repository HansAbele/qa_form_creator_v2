import { describe, expect, it } from "vitest";
import { resolveResponseScoringPolicy } from "./response-scoring-policy";

describe("resolveResponseScoringPolicy", () => {
  it("keeps the captured policy for submitted response corrections", () => {
    expect(
      resolveResponseScoringPolicy(
        {
          status: "SUBMITTED",
          settingsSnapshot: { passThreshold: 70, fatalZeroesScore: false },
        },
        { passThreshold: 95, fatalZeroesScore: true },
      ),
    ).toEqual({ passThreshold: 70, fatalZeroesScore: false });
  });

  it("uses the current policy for new evaluations and malformed captured thresholds", () => {
    const current = { passThreshold: 80, fatalZeroesScore: true };
    expect(
      resolveResponseScoringPolicy(
        {
          status: "SUBMITTED",
          settingsSnapshot: { passThreshold: 101, fatalZeroesScore: "yes" },
        },
        current,
      ),
    ).toEqual(current);
    expect(resolveResponseScoringPolicy(null, current)).toBe(current);
  });
});
