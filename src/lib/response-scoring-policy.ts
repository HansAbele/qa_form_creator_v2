export type ResponseScoringPolicy = {
  passThreshold: number;
  fatalZeroesScore: boolean;
};

type StoredResponsePolicy = {
  status: string;
  settingsSnapshot?: unknown;
  scoringSnapshot?: unknown;
} | null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Corrections to a submitted evaluation keep the scoring contract captured when it was
 * submitted. New evaluations use the campaign's current policy.
 */
export function resolveResponseScoringPolicy(
  response: StoredResponsePolicy,
  current: ResponseScoringPolicy,
): ResponseScoringPolicy {
  if (response?.status !== "SUBMITTED") return current;

  const settings = asRecord(response.settingsSnapshot);
  const scoring = asRecord(response.scoringSnapshot);
  const capturedThreshold = settings?.passThreshold ?? scoring?.passThreshold;
  const passThreshold =
    typeof capturedThreshold === "number" &&
    Number.isFinite(capturedThreshold) &&
    capturedThreshold >= 0 &&
    capturedThreshold <= 100
      ? capturedThreshold
      : current.passThreshold;
  const fatalZeroesScore =
    typeof settings?.fatalZeroesScore === "boolean"
      ? settings.fatalZeroesScore
      : current.fatalZeroesScore;

  return { passThreshold, fatalZeroesScore };
}
