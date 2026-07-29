import "server-only";

import type { TranscriptProvider } from "@prisma/client";

const DEFAULT_NVIDIA_URL =
  "https://1598d209-5e27-4d3c-8079-4751568b1081.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions";
const DEFAULT_GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export type TranscriptionCredential = {
  keySlot: number;
  apiKey: string;
};

export type TranscriptionProviderConfig = {
  provider: Extract<TranscriptProvider, "NVIDIA_NIM" | "GROQ" | "DEEPGRAM">;
  model: string;
  url: string;
  credentials: TranscriptionCredential[];
};

export type TranscriptionConfig = {
  providers: TranscriptionProviderConfig[];
  language: string;
  timeoutMs: number;
  maxAudioBytes: number;
  ffmpegPath: string;
  ffprobePath: string;
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function credentials(...values: Array<string | undefined>) {
  return values.flatMap((value, index) => {
    const apiKey = value?.trim();
    return apiKey ? [{ keySlot: index + 1, apiKey }] : [];
  });
}

function providerOrder(value: string | undefined) {
  const supported = new Set<TranscriptionProviderConfig["provider"]>([
    "DEEPGRAM",
    "NVIDIA_NIM",
    "GROQ",
  ]);
  const requested = (value ?? "DEEPGRAM,NVIDIA_NIM,GROQ")
    .split(",")
    .map((provider) => provider.trim().toUpperCase())
    .filter((provider): provider is TranscriptionProviderConfig["provider"] =>
      supported.has(provider as TranscriptionProviderConfig["provider"]),
    );

  return [
    ...new Set(requested.length > 0 ? requested : ["DEEPGRAM", "NVIDIA_NIM", "GROQ"]),
  ] as Array<TranscriptionProviderConfig["provider"]>;
}

export function getTranscriptionConfig(): TranscriptionConfig {
  const available: Record<TranscriptionProviderConfig["provider"], TranscriptionProviderConfig> = {
    DEEPGRAM: {
      provider: "DEEPGRAM",
      model: process.env.DEEPGRAM_TRANSCRIPTION_MODEL?.trim() || "nova-3",
      url: process.env.DEEPGRAM_TRANSCRIPTION_URL?.trim() || DEFAULT_DEEPGRAM_URL,
      credentials: credentials(process.env.DEEPGRAM_API_KEY, process.env.DEEPGRAM_API_KEY_II),
    },
    NVIDIA_NIM: {
      provider: "NVIDIA_NIM",
      model: process.env.NVIDIA_NIM_TRANSCRIPTION_MODEL?.trim() || "parakeet-ctc-1.1b-asr",
      url: process.env.NVIDIA_NIM_TRANSCRIPTION_URL?.trim() || DEFAULT_NVIDIA_URL,
      credentials: credentials(process.env.NVIDIA_NIM_API_KEY, process.env.NVIDIA_NIM_API_KEY_II),
    },
    GROQ: {
      provider: "GROQ",
      model: process.env.GROQ_TRANSCRIPTION_MODEL?.trim() || "whisper-large-v3",
      url: process.env.GROQ_TRANSCRIPTION_URL?.trim() || DEFAULT_GROQ_URL,
      credentials: credentials(process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_II),
    },
  };

  return {
    providers: providerOrder(process.env.TRANSCRIPTION_PROVIDER_ORDER)
      .map((provider) => available[provider])
      .filter((provider) => provider.credentials.length > 0),
    language: process.env.TRANSCRIPTION_LANGUAGE?.trim() || "en",
    timeoutMs: boundedInteger(
      process.env.TRANSCRIPTION_REQUEST_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      10_000,
      15 * 60 * 1000,
    ),
    maxAudioBytes: boundedInteger(
      process.env.TRANSCRIPTION_MAX_AUDIO_BYTES,
      DEFAULT_MAX_AUDIO_BYTES,
      1024,
      100 * 1024 * 1024,
    ),
    ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
  };
}

export function hasDiarizationProviderConfigured() {
  return getTranscriptionConfig().providers.some((provider) => provider.provider === "DEEPGRAM");
}
