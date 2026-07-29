import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { cleanupMock, configMock, groqTranscribeMock, nimTranscribeMock, prepareAudioMock } =
  vi.hoisted(() => ({
    cleanupMock: vi.fn(),
    configMock: vi.fn(),
    groqTranscribeMock: vi.fn(),
    nimTranscribeMock: vi.fn(),
    prepareAudioMock: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./storage", () => ({ resolveRecordingStorageKey: () => "C:/recording.wav" }));
vi.mock("./audio-preparation", () => ({
  AudioPreparationError: class AudioPreparationError extends Error {},
  prepareAudioForTranscription: prepareAudioMock,
}));
vi.mock("./transcription-config", () => ({ getTranscriptionConfig: configMock }));
vi.mock("./providers/nvidia-nim-transcription-adapter", () => ({
  NvidiaNimTranscriptionAdapter: class NvidiaNimTranscriptionAdapter {
    transcribe = nimTranscribeMock;
  },
}));
vi.mock("./providers/groq-transcription-adapter", () => ({
  GroqTranscriptionAdapter: class GroqTranscriptionAdapter {
    transcribe = groqTranscribeMock;
  },
}));

import { TranscriptionProviderError } from "./providers/transcription-http";
import { transcribeInteractionRecording } from "./transcription-service";

const mediaAsset = {
  id: "asset-1",
  storageKey: "nice/recording.wav",
  sha256: "a".repeat(64),
  durationMs: 30_000,
  channelCount: 1,
};

function provider(provider: "NVIDIA_NIM" | "GROQ", credentials = ["primary", "backup"]) {
  return {
    provider,
    model: provider === "GROQ" ? "whisper-large-v3" : "parakeet-ctc-1.1b-asr",
    url: `https://${provider.toLowerCase()}.example/transcriptions`,
    credentials: credentials.map((apiKey, index) => ({ apiKey, keySlot: index + 1 })),
  };
}

function canonical(providerName: "NVIDIA_NIM" | "GROQ") {
  return {
    provider: providerName,
    model: providerName === "GROQ" ? "whisper-large-v3" : "parakeet-ctc-1.1b-asr",
    language: "en",
    isDiarized: false,
    speakerCount: null,
    fullText: "A test transcript.",
    segments: [
      {
        ordinal: 0,
        startMs: 0,
        endMs: 1_000,
        speakerKey: null,
        speakerRole: "UNKNOWN" as const,
        text: "A test transcript.",
        confidence: null,
      },
    ],
  };
}

beforeEach(() => {
  resetPrismaMock();
  cleanupMock.mockReset();
  configMock.mockReset();
  groqTranscribeMock.mockReset();
  nimTranscribeMock.mockReset();
  prepareAudioMock.mockReset();
  prepareAudioMock.mockResolvedValue({
    audioPath: "C:/normalized.flac",
    byteSize: 1024,
    channelCount: 1,
    cleanup: cleanupMock,
  });
  prismaMock.transcript.findFirst.mockResolvedValue(null);
  prismaMock.transcript.findUnique.mockResolvedValue(null);
  prismaMock.transcript.create.mockImplementation(async ({ data }) => ({
    id: `transcript-${data.provider}`,
    ...data,
  }));
  let attempt = 0;
  prismaMock.transcriptionAttempt.create.mockImplementation(async ({ data }) => ({
    id: `attempt-${++attempt}`,
    ...data,
  }));
});

describe("transcribeInteractionRecording", () => {
  it("should move to the backup key after a retryable primary-key failure", async () => {
    configMock.mockReturnValue({
      providers: [provider("NVIDIA_NIM")],
      language: "en",
      timeoutMs: 30_000,
      maxAudioBytes: 1024 * 1024,
      ffmpegPath: "ffmpeg",
    });
    nimTranscribeMock
      .mockRejectedValueOnce(
        new TranscriptionProviderError("Rate limited", "NVIDIA_NIM", "HTTP_429", 429),
      )
      .mockResolvedValueOnce(canonical("NVIDIA_NIM"));

    await expect(
      transcribeInteractionRecording({ interactionId: "interaction-1", mediaAsset }),
    ).resolves.toEqual({
      transcriptId: "transcript-NVIDIA_NIM",
      provider: "NVIDIA_NIM",
      status: "SPEAKERS_UNVERIFIED",
    });
    expect(nimTranscribeMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.transcriptionAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "attempt-1" },
        data: expect.objectContaining({ status: "FAILED", errorCode: "HTTP_429" }),
      }),
    );
    expect(cleanupMock).toHaveBeenCalledOnce();
  });

  it("should move to Groq when NVIDIA rejects the audio request", async () => {
    configMock.mockReturnValue({
      providers: [provider("NVIDIA_NIM"), provider("GROQ", ["primary"])],
      language: "en",
      timeoutMs: 30_000,
      maxAudioBytes: 1024 * 1024,
      ffmpegPath: "ffmpeg",
    });
    nimTranscribeMock.mockRejectedValue(
      new TranscriptionProviderError("Invalid audio", "NVIDIA_NIM", "HTTP_400", 400),
    );
    groqTranscribeMock.mockResolvedValue(canonical("GROQ"));

    await expect(
      transcribeInteractionRecording({ interactionId: "interaction-1", mediaAsset }),
    ).resolves.toEqual({
      transcriptId: "transcript-GROQ",
      provider: "GROQ",
      status: "SPEAKERS_UNVERIFIED",
    });
    expect(nimTranscribeMock).toHaveBeenCalledOnce();
    expect(groqTranscribeMock).toHaveBeenCalledOnce();
    expect(prismaMock.transcript.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "transcript-NVIDIA_NIM" },
        data: expect.objectContaining({ status: "FAILED", errorCode: "HTTP_400" }),
      }),
    );
  });
});
