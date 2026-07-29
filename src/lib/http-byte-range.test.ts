import { describe, expect, it } from "vitest";
import { resolveByteRange } from "./http-byte-range";

describe("resolveByteRange", () => {
  it("should return the full representation without a range header", () => {
    expect(resolveByteRange(null, 100)).toEqual({ kind: "full" });
  });

  it("should resolve a bounded range", () => {
    expect(resolveByteRange("bytes=10-19", 100)).toEqual({
      kind: "partial",
      start: 10,
      end: 19,
    });
  });

  it("should clamp an open-ended range", () => {
    expect(resolveByteRange("bytes=90-", 100)).toEqual({
      kind: "partial",
      start: 90,
      end: 99,
    });
  });

  it("should resolve a suffix range", () => {
    expect(resolveByteRange("bytes=-25", 100)).toEqual({
      kind: "partial",
      start: 75,
      end: 99,
    });
  });

  it("should reject multipart and out-of-bounds ranges", () => {
    expect(resolveByteRange("bytes=0-1,4-5", 100)).toEqual({ kind: "unsatisfiable" });
    expect(resolveByteRange("bytes=100-120", 100)).toEqual({ kind: "unsatisfiable" });
  });
});
