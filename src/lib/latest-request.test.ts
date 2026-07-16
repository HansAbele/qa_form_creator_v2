import { describe, expect, it } from "vitest";
import { LatestRequestGuard } from "@/lib/latest-request";

describe("LatestRequestGuard", () => {
  it("should reject an older request after a newer one starts", () => {
    const guard = new LatestRequestGuard();
    const olderRequest = guard.begin();
    const latestRequest = guard.begin();

    expect(guard.isCurrent(olderRequest)).toBe(false);
    expect(guard.isCurrent(latestRequest)).toBe(true);
  });

  it("should invalidate an in-flight request during cleanup", () => {
    const guard = new LatestRequestGuard();
    const inFlightRequest = guard.begin();

    guard.invalidate();

    expect(guard.isCurrent(inFlightRequest)).toBe(false);
  });
});
