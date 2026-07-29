import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRecordingStorageKey, safeAudioMimeType } from "./storage";

describe("resolveRecordingStorageKey", () => {
  const root = path.resolve("recordings-test-root");

  it("should resolve a nested opaque key under the configured root", () => {
    expect(resolveRecordingStorageKey("campaign/2026/call.wav", root)).toBe(
      path.join(root, "campaign", "2026", "call.wav"),
    );
  });

  it("should reject traversal and absolute keys", () => {
    expect(() => resolveRecordingStorageKey("../outside.wav", root)).toThrow();
    expect(() => resolveRecordingStorageKey(path.resolve("outside.wav"), root)).toThrow();
  });
});

describe("safeAudioMimeType", () => {
  it("should preserve supported audio types", () => {
    expect(safeAudioMimeType("audio/mpeg")).toBe("audio/mpeg");
  });

  it("should neutralize unknown content types", () => {
    expect(safeAudioMimeType("text/html")).toBe("application/octet-stream");
  });
});
