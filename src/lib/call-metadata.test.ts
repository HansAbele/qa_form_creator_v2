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
      providerSystem: null,
      agentExtension: null,
      application: null,
      did: null,
      outboundCallerId: null,
      talkSeconds: null,
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
      providerSystem: null,
      agentExtension: null,
      application: null,
      did: null,
      outboundCallerId: null,
      talkSeconds: null,
    });
  });

  it("normalizes useful FreePBX metadata without exposing recording locators", () => {
    expect(
      summarizeCallMetadata({
        providerSystem: "FreePBX",
        agentExtension: 4141,
        application: "DIAL",
        did: "18005550100",
        outboundCallerId: "18005550101",
        talkSeconds: "300",
        recordingId: "private-recording-locator",
      }),
    ).toEqual(
      expect.objectContaining({
        providerSystem: "FreePBX",
        agentExtension: "4141",
        application: "DIAL",
        did: "18005550100",
        outboundCallerId: "18005550101",
        talkSeconds: 300,
      }),
    );
    expect(summarizeCallMetadata({ recordingId: "private" })).not.toHaveProperty("recordingId");
  });
});
