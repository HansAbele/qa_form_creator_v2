import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getTranscriptionConfig } from "./transcription-config";

afterEach(() => vi.unstubAllEnvs());

describe("getTranscriptionConfig", () => {
  it("should preserve provider and key failover order", () => {
    vi.stubEnv("TRANSCRIPTION_PROVIDER_ORDER", "DEEPGRAM,GROQ,NVIDIA_NIM");
    vi.stubEnv("DEEPGRAM_API_KEY", "deepgram-primary");
    vi.stubEnv("DEEPGRAM_API_KEY_II", "deepgram-backup");
    vi.stubEnv("GROQ_API_KEY", "groq-primary");
    vi.stubEnv("GROQ_API_KEY_II", "groq-backup");
    vi.stubEnv("NVIDIA_NIM_API_KEY", "nim-primary");
    vi.stubEnv("NVIDIA_NIM_API_KEY_II", "nim-backup");

    const config = getTranscriptionConfig();

    expect(config.providers.map((provider) => provider.provider)).toEqual([
      "DEEPGRAM",
      "GROQ",
      "NVIDIA_NIM",
    ]);
    expect(
      config.providers.map((provider) => provider.credentials.map((key) => key.keySlot)),
    ).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
  });

  it("should omit providers without a configured key", () => {
    vi.stubEnv("TRANSCRIPTION_PROVIDER_ORDER", "NVIDIA_NIM,GROQ");
    vi.stubEnv("NVIDIA_NIM_API_KEY", "");
    vi.stubEnv("NVIDIA_NIM_API_KEY_II", "");
    vi.stubEnv("GROQ_API_KEY", "groq-primary");
    vi.stubEnv("GROQ_API_KEY_II", "");

    expect(getTranscriptionConfig().providers.map((provider) => provider.provider)).toEqual([
      "GROQ",
    ]);
  });
});
