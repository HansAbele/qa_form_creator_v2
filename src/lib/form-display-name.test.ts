import { describe, expect, it } from "vitest";
import { formDisplayName } from "./form-display-name";

describe("formDisplayName", () => {
  it.each([
    ["Parker Davis scorecard V1", "Parker Davis scorecard"],
    ["HAPUSA Scorecard v2.00", "HAPUSA Scorecard"],
    ["Customer QA - Version 3.1", "Customer QA"],
  ])("removes a trailing display version from %s", (input, expected) => {
    expect(formDisplayName(input)).toBe(expected);
  });

  it("does not remove a year or a number that is part of the real name", () => {
    expect(formDisplayName("Parker Davis 2026")).toBe("Parker Davis 2026");
    expect(formDisplayName("Tier 2 Quality")).toBe("Tier 2 Quality");
  });
});
