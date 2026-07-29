import { describe, expect, it } from "vitest";
import {
  availablePipReviewFrequencies,
  canTransitionCoaching,
  canTransitionPip,
  defaultPipTemplateVersion,
  elapsedSeconds,
  formatTrackedDuration,
  pipPlanDurationDays,
} from "./performance-management";

describe("performance management business rules", () => {
  it("should allow the expected coaching lifecycle and reject terminal changes", () => {
    expect(canTransitionCoaching("DRAFT", "IN_PROGRESS")).toBe(true);
    expect(canTransitionCoaching("IN_PROGRESS", "AWAITING_ACKNOWLEDGEMENT")).toBe(true);
    expect(canTransitionCoaching("AWAITING_ACKNOWLEDGEMENT", "COMPLETED")).toBe(true);
    expect(canTransitionCoaching("COMPLETED", "IN_PROGRESS")).toBe(false);
  });

  it("should require approval before activating a PIP", () => {
    expect(canTransitionPip("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionPip("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionPip("PENDING_APPROVAL", "ACTIVE")).toBe(true);
  });

  it("should calculate only nonnegative whole active seconds", () => {
    const start = new Date("2026-07-28T10:00:00.250Z");
    expect(elapsedSeconds(start, new Date("2026-07-28T10:01:30.999Z"))).toBe(90);
    expect(elapsedSeconds(start, new Date("2026-07-28T09:59:00.000Z"))).toBe(0);
  });

  it("should format tracked duration for timers and reports", () => {
    expect(formatTrackedDuration(65)).toBe("1:05");
    expect(formatTrackedDuration(3_661)).toBe("1:01:01");
  });

  it("should version campaign PIP templates explicitly", () => {
    expect(defaultPipTemplateVersion("PARKER_DAVIS")).toBe("PD-HR-FRM-PIP-001-v1");
    expect(defaultPipTemplateVersion("HAPUSA")).toBe("HAPUSA-INDUSTRY-v1");
  });

  it("should offer only review cadences that fit inside the PIP period", () => {
    expect(pipPlanDurationDays("2026-07-29", "2026-07-29")).toBe(1);
    expect(availablePipReviewFrequencies("2026-07-29", "2026-07-29")).toEqual(["Daily"]);
    expect(availablePipReviewFrequencies("2026-07-29", "2026-08-28")).toEqual([
      "Daily",
      "Every other day",
      "Twice weekly",
      "Weekly",
      "Every two weeks",
      "Monthly",
    ]);
  });
});
