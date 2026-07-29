import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const {
  authMock,
  attachRecordingMock,
  campaignFilterMock,
  revalidatePathMock,
  syncSourcesMock,
  enqueueTranscriptionMock,
  hasDiarizationMock,
  writeAuditLogMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  attachRecordingMock: vi.fn(),
  campaignFilterMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  syncSourcesMock: vi.fn(),
  enqueueTranscriptionMock: vi.fn(),
  hasDiarizationMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/server/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/server/queries/call-finder", () => ({
  getCallFinderCampaignFilter: campaignFilterMock,
}));
vi.mock("@/server/call-finder/nice-cxone-service", () => ({
  CallRecordingProviderError: class CallRecordingProviderError extends Error {
    code = "RECORDING_NOT_FOUND";
  },
  attachNiceCxoneRecording: attachRecordingMock,
  syncEnabledNiceCxoneSources: syncSourcesMock,
}));
vi.mock("@/server/call-finder/transcription-queue", () => ({
  enqueueTranscriptionJob: enqueueTranscriptionMock,
}));
vi.mock("@/server/call-finder/transcription-config", () => ({
  hasDiarizationProviderConfigured: hasDiarizationMock,
}));

import {
  attachCallRecording,
  confirmTranscriptSpeakerRoles,
  syncNiceCxoneCalls,
  transcribeCallRecording,
} from "./call-finder";

beforeEach(() => {
  resetPrismaMock();
  authMock.mockReset();
  attachRecordingMock.mockReset();
  campaignFilterMock.mockReset();
  revalidatePathMock.mockReset();
  syncSourcesMock.mockReset();
  enqueueTranscriptionMock.mockReset();
  hasDiarizationMock.mockReset();
  hasDiarizationMock.mockReturnValue(false);
  writeAuditLogMock.mockReset();
});

describe("Call Finder actions", () => {
  it("should reject and audit a non-admin synchronization attempt", async () => {
    authMock.mockResolvedValue({ user: { id: "qa-1", role: "QA" } });

    await expect(syncNiceCxoneCalls()).rejects.toThrow(
      "Only administrators can synchronize call sources",
    );
    expect(syncSourcesMock).not.toHaveBeenCalled();
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "call_sync_denied", userId: "qa-1" }),
    );
  });

  it("should return a bounded summary for an administrator", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    syncSourcesMock.mockResolvedValue([
      {
        campaignId: "campaign-1",
        sourceId: "source-1",
        pages: 1,
        discovered: 3,
        created: 2,
        updated: 1,
        errors: [],
        startedFrom: new Date("2026-07-21T10:00:00.000Z"),
        startedTo: new Date("2026-07-21T12:00:00.000Z"),
      },
    ]);

    await expect(syncNiceCxoneCalls()).resolves.toEqual({
      sources: 1,
      discovered: 3,
      created: 2,
      updated: 1,
      errors: 0,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/call-finder");
    expect(syncSourcesMock).toHaveBeenCalledWith({});
  });

  it("should synchronize only the selected active campaign", async () => {
    authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    prismaMock.campaign.findFirst.mockResolvedValue({ id: "campaign-1" });
    syncSourcesMock.mockResolvedValue([]);

    await expect(syncNiceCxoneCalls({ campaignId: "campaign-1" })).resolves.toMatchObject({
      sources: 0,
    });

    expect(prismaMock.campaign.findFirst).toHaveBeenCalledWith({
      where: { id: "campaign-1", active: true },
      select: { id: true },
    });
    expect(syncSourcesMock).toHaveBeenCalledWith({ campaignId: "campaign-1" });
  });

  it("should never attach a recording outside the caller campaign scope", async () => {
    authMock.mockResolvedValue({ user: { id: "qa-1", role: "QA" } });
    campaignFilterMock.mockResolvedValue({ campaignId: { in: ["campaign-1"] } });
    prismaMock.interaction.findFirst.mockResolvedValue(null);

    await expect(attachCallRecording("interaction-other")).rejects.toThrow(
      "Call not found or access denied",
    );
    expect(attachRecordingMock).not.toHaveBeenCalled();
  });

  it("should never transcribe a recording outside the caller campaign scope", async () => {
    authMock.mockResolvedValue({ user: { id: "qa-1", role: "QA" } });
    campaignFilterMock.mockResolvedValue({ campaignId: { in: ["campaign-1"] } });
    prismaMock.interaction.findFirst.mockResolvedValue(null);

    await expect(transcribeCallRecording("interaction-other")).rejects.toThrow(
      "Call not found or access denied",
    );
    expect(enqueueTranscriptionMock).not.toHaveBeenCalled();
  });

  it("should queue a scoped recording and audit the request", async () => {
    authMock.mockResolvedValue({ user: { id: "qa-1", role: "QA" } });
    campaignFilterMock.mockResolvedValue({ campaignId: { in: ["campaign-1"] } });
    const mediaAsset = {
      id: "asset-1",
      storageKey: "nice/recording.wav",
      sha256: "a".repeat(64),
      durationMs: 30_000,
      channelCount: 1,
    };
    prismaMock.interaction.findFirst.mockResolvedValue({
      id: "interaction-1",
      campaignId: "campaign-1",
      mediaAssets: [mediaAsset],
    });
    enqueueTranscriptionMock.mockResolvedValue({
      jobId: "job-1",
      transcriptId: null,
      provider: null,
      status: "PENDING",
      alreadyCompleted: false,
    });

    await expect(transcribeCallRecording("interaction-1")).resolves.toEqual({
      jobId: "job-1",
      transcriptId: null,
      provider: null,
      status: "PENDING",
      alreadyCompleted: false,
      error: null,
      errorCode: null,
    });
    expect(enqueueTranscriptionMock).toHaveBeenCalledWith({
      interactionId: "interaction-1",
      mediaAssetId: "asset-1",
      requestedById: "qa-1",
      requireDiarization: false,
    });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "recording_transcription_queued",
        entityId: "interaction-1",
      }),
    );
  });

  it("should require a managed diarization provider for speaker identification", async () => {
    authMock.mockResolvedValue({ user: { id: "qa-1", role: "QA" } });
    campaignFilterMock.mockResolvedValue({ campaignId: { in: ["campaign-1"] } });
    prismaMock.interaction.findFirst.mockResolvedValue({
      id: "interaction-1",
      campaignId: "campaign-1",
      mediaAssets: [],
    });

    await expect(
      transcribeCallRecording("interaction-1", { requireDiarization: true }),
    ).resolves.toMatchObject({
      errorCode: "DIARIZATION_PROVIDER_REQUIRED",
      jobId: null,
    });
    expect(enqueueTranscriptionMock).not.toHaveBeenCalled();
  });

  it("should confirm every detected speaker inside the caller campaign scope", async () => {
    authMock.mockResolvedValue({ user: { id: "qa-1", role: "QA" } });
    campaignFilterMock.mockResolvedValue({ campaignId: { in: ["campaign-1"] } });
    prismaMock.interaction.findFirst.mockResolvedValue({
      id: "interaction-1",
      campaignId: "campaign-1",
      transcripts: [
        {
          id: "transcript-1",
          isDiarized: true,
          segments: [
            { speakerKey: "1", speakerRole: "UNKNOWN" },
            { speakerKey: "2", speakerRole: "UNKNOWN" },
          ],
        },
      ],
    });

    await expect(
      confirmTranscriptSpeakerRoles({
        interactionId: "interaction-1",
        transcriptId: "transcript-1",
        assignments: [
          { speakerKey: "1", role: "AGENT" },
          { speakerKey: "2", role: "CUSTOMER" },
        ],
      }),
    ).resolves.toEqual({ success: true, transcriptId: "transcript-1" });
    expect(prismaMock.transcriptSegment.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.transcript.update).toHaveBeenCalledWith({
      where: { id: "transcript-1" },
      data: { status: "COMPLETED", speakerCount: 2 },
    });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "transcript_speaker_roles_confirmed" }),
      prismaMock,
    );
  });
});
