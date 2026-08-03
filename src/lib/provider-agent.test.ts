import { describe, expect, it } from "vitest";
import { providerAgentDisplayName } from "./provider-agent";

describe("providerAgentDisplayName", () => {
  it("should preserve a provider display name", () => {
    expect(providerAgentDisplayName("NICE_CXONE", "20", " John Smith ")).toBe("John Smith");
  });

  it("should identify a FreePBX call by extension when no name is available", () => {
    expect(providerAgentDisplayName("FREEPBX", "4141", null)).toBe("Extension 4141");
  });

  it("should not create a label without a provider identity", () => {
    expect(providerAgentDisplayName("FREEPBX", null, null)).toBeNull();
  });
});
