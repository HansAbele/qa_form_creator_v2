import { describe, expect, it } from "vitest";
import { summarizeCallMetadata } from "./call-metadata";

describe("summarizeCallMetadata", () => {
  it("normalizes useful NICE metadata without exposing the raw provider payload", () => {
    expect(
      summarizeCallMetadata({
        masterContactId: 712876049780,
        skillName: "Imagine IB",
        teamName: "TCN",
        mediaTypeName: "Call",
        pointOfContactName: "Patient Pay",
        primaryDispositionId: "2896",
        secondaryDispositionId: 0,
        holdCount: "2",
        holdSeconds: 47.6,
        transferIndicatorName: "None",
      }),
    ).toEqual({
      masterContactId: "712876049780",
      skillName: "Imagine IB",
      teamName: "TCN",
      mediaTypeName: "Call",
      pointOfContactName: "Patient Pay",
      primaryDispositionId: "2896",
      secondaryDispositionId: "0",
      holdCount: 2,
      holdSeconds: 47.6,
      transferIndicatorName: "None",
    });
  });

  it("returns a stable empty summary for invalid metadata", () => {
    expect(summarizeCallMetadata(null)).toEqual({
      masterContactId: null,
      skillName: null,
      teamName: null,
      mediaTypeName: null,
      pointOfContactName: null,
      primaryDispositionId: null,
      secondaryDispositionId: null,
      holdCount: null,
      holdSeconds: null,
      transferIndicatorName: null,
    });
  });
});
