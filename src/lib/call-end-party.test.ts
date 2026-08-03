import { describe, expect, it } from "vitest";
import { callEndPartyLabel, inferCallEndParty } from "./call-end-party";

describe("inferCallEndParty", () => {
  it("should classify NICE agent termination reasons", () => {
    expect(inferCallEndParty("Agent Hung Up")).toBe("AGENT");
    expect(inferCallEndParty("Agent Phone Disconnected")).toBe("AGENT");
  });

  it("should classify NICE contact termination reasons", () => {
    expect(inferCallEndParty("Contact Hung Up")).toBe("CONTACT");
    expect(inferCallEndParty("Outbound Call Peer Hung Up")).toBe("CONTACT");
  });

  it("should distinguish transfers and provider/system outcomes", () => {
    expect(inferCallEndParty("Call Blind Transferred")).toBe("TRANSFERRED");
    expect(inferCallEndParty("Outbound Call No Answer Time Out")).toBe("SYSTEM");
  });

  it("should not guess when FreePBX does not provide the terminating party", () => {
    expect(inferCallEndParty("ANSWERED")).toBe("UNKNOWN");
  });
});

describe("callEndPartyLabel", () => {
  it("should identify a HAPUSA contact as the patient", () => {
    expect(callEndPartyLabel("CONTACT", "HAPUSA")).toBe("Patient");
  });
});
