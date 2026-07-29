import type { TranscriptProvider } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildTranscriptionFailoverPlan,
  isRetryableTranscriptionFailure,
  type TranscriptionCandidate,
} from "./transcription-failover";

function candidate(
  provider: TranscriptProvider,
  priority: number,
  nativeDiarization: boolean,
  separatedChannelTranscription = true,
): TranscriptionCandidate {
  return {
    provider,
    model: `${provider.toLowerCase()}-model`,
    priority,
    enabled: true,
    nativeDiarization,
    separatedChannelTranscription,
  };
}

describe("buildTranscriptionFailoverPlan", () => {
  const candidates = [
    candidate("GROQ", 30, false),
    candidate("OPENAI", 20, true),
    candidate("NVIDIA_NIM", 10, true),
  ];

  it("should keep only diarization-capable providers for a mono call", () => {
    expect(
      buildTranscriptionFailoverPlan(candidates, {
        channelCount: 1,
        requireSpeakerRoles: true,
      }).map((item) => item.provider),
    ).toEqual(["NVIDIA_NIM", "OPENAI"]);
  });

  it("should admit Groq after channel separation for a stereo call", () => {
    const plan = buildTranscriptionFailoverPlan(candidates, {
      channelCount: 2,
      requireSpeakerRoles: true,
    });
    expect(plan.map((item) => item.provider)).toEqual(["NVIDIA_NIM", "OPENAI", "GROQ"]);
    expect(plan.at(-1)?.strategy).toBe("SPLIT_CHANNELS");
  });
});

describe("isRetryableTranscriptionFailure", () => {
  it("should retry throttling, timeouts, and provider failures", () => {
    expect(isRetryableTranscriptionFailure({ httpStatus: 401 })).toBe(true);
    expect(isRetryableTranscriptionFailure({ httpStatus: 403 })).toBe(true);
    expect(isRetryableTranscriptionFailure({ httpStatus: 429 })).toBe(true);
    expect(isRetryableTranscriptionFailure({ code: "ETIMEDOUT" })).toBe(true);
    expect(isRetryableTranscriptionFailure({ httpStatus: 503 })).toBe(true);
  });

  it("should not retry an invalid request", () => {
    expect(isRetryableTranscriptionFailure({ httpStatus: 400 })).toBe(false);
  });
});
