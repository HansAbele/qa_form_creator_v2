import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { transcribeMock, writeAuditLogMock } = vi.hoisted(() => ({
  transcribeMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("./transcription-service", () => ({
  TranscriptionServiceError: class TranscriptionServiceError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
  transcribeInteractionRecording: transcribeMock,
}));

import { enqueueTranscriptionJob, processTranscriptionJob } from "./transcription-queue";

const claimedJob = {
  id: "job-1",
  interactionId: "interaction-1",
  requestedById: "qa-1",
  requireDiarization: false,
  attemptCount: 1,
  maxAttempts: 3,
  interaction: { campaignId: "campaign-1" },
  mediaAsset: {
    id: "asset-1",
    storageKey: "nice/recording.wav",
    sha256: "a".repeat(64),
    durationMs: 30_000,
    channelCount: 1,
  },
};

beforeEach(() => {
  resetPrismaMock();
  transcribeMock.mockReset();
  writeAuditLogMock.mockReset();
  prismaMock.transcript.findFirst.mockResolvedValue(null);
  prismaMock.transcriptionJob.findFirst.mockResolvedValue(null);
  prismaMock.transcriptionJob.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.transcriptionJob.findUnique.mockResolvedValue(claimedJob);
});

describe("transcription queue", () => {
  it("should reuse an active job for the same recording", async () => {
    prismaMock.transcriptionJob.findFirst.mockResolvedValue({
      id: "job-existing",
      status: "PROCESSING",
      attemptCount: 1,
      maxAttempts: 3,
    });

    await expect(
      enqueueTranscriptionJob({
        interactionId: "interaction-1",
        mediaAssetId: "asset-1",
        requestedById: "qa-1",
      }),
    ).resolves.toMatchObject({
      jobId: "job-existing",
      status: "PROCESSING",
      alreadyCompleted: false,
    });
    expect(prismaMock.transcriptionJob.create).not.toHaveBeenCalled();
  });

  it("should not reuse a plain transcript when diarization is required", async () => {
    prismaMock.transcriptionJob.create.mockResolvedValue({ id: "job-new", status: "PENDING" });

    await expect(
      enqueueTranscriptionJob({
        interactionId: "interaction-1",
        mediaAssetId: "asset-1",
        requestedById: "qa-1",
        requireDiarization: true,
      }),
    ).resolves.toMatchObject({ jobId: "job-new", alreadyCompleted: false });
    expect(prismaMock.transcript.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([expect.objectContaining({ isDiarized: true })]),
        }),
      }),
    );
    expect(prismaMock.transcriptionJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requireDiarization: true }) }),
    );
  });

  it("should complete a claimed job and link its transcript", async () => {
    transcribeMock.mockResolvedValue({
      transcriptId: "transcript-1",
      provider: "NVIDIA_NIM",
      status: "SPEAKERS_UNVERIFIED",
    });

    await expect(processTranscriptionJob("job-1")).resolves.toBe(true);
    expect(prismaMock.transcriptionJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        transcriptId: "transcript-1",
      }),
    });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recording_transcribed", userId: "qa-1" }),
    );
  });

  it("should requeue a retryable provider failure", async () => {
    const { TranscriptionServiceError } = await import("./transcription-service");
    transcribeMock.mockRejectedValue(
      new TranscriptionServiceError("Providers unavailable", "PROVIDERS_FAILED" as never),
    );

    await expect(processTranscriptionJob("job-1")).resolves.toBe(true);
    expect(prismaMock.transcriptionJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "PENDING",
        lastErrorCode: "PROVIDERS_FAILED",
        lockedAt: null,
      }),
    });
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });
});
