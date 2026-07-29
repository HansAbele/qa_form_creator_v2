import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAudioMetadata } from "./audio-metadata";

describe("parseAudioMetadata", () => {
  it("should read duration and channel count from ffprobe output", () => {
    expect(
      parseAudioMetadata({
        streams: [{ channels: 2, duration: "256.413000" }],
        format: { duration: "999.000" },
      }),
    ).toEqual({ durationMs: 256_413, channelCount: 2 });
  });

  it("should fall back to the container duration when the stream omits it", () => {
    expect(
      parseAudioMetadata({ streams: [{ channels: 1 }], format: { duration: "3.250" } }),
    ).toEqual({ durationMs: 3_250, channelCount: 1 });
  });

  it("should reject invalid metadata values without guessing", () => {
    expect(parseAudioMetadata({ streams: [{ channels: 0 }], format: { duration: "N/A" } })).toEqual(
      { durationMs: null, channelCount: null },
    );
  });
});
