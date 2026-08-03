import { InteractionProvider } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";
import {
  attachProviderRecording,
  type CallRecordingProviderError,
  syncEnabledCallSources,
} from "./call-source-service";
import type { CallSourceAdapter } from "./providers/contracts";

vi.mock("server-only", () => ({}));

const freePbxInteraction = {
  id: "interaction-pbx-1",
  campaignId: "campaign-parker",
  provider: InteractionProvider.FREEPBX,
  providerInstance: "parker-davis",
  providerInteractionId: "1785500000.100",
  hasRecording: true,
  metadata: { recordingId: "1785500000.200" },
  startedAt: new Date("2026-07-31T14:00:00.000Z"),
  durationSeconds: 120,
};

function adapter(response: Response): CallSourceAdapter {
  return {
    provider: InteractionProvider.FREEPBX,
    searchCalls: vi.fn(),
    fetchRecording: vi.fn().mockResolvedValue(response),
  };
}

beforeEach(() => {
  resetPrismaMock();
  prismaMock.mediaAsset.findMany.mockResolvedValue([]);
  prismaMock.mediaAsset.findFirst.mockResolvedValue(null);
  prismaMock.campaignCallSource.findFirst.mockResolvedValue({ id: "source-freepbx" });
  prismaMock.auditLog.create.mockResolvedValue({ id: "audit-freepbx" });
});

describe("attachProviderRecording", () => {
  it("uses the private FreePBX recording locator without exposing it to the client", async () => {
    const sourceAdapter = adapter(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } }),
    );
    const persistRecording = vi.fn().mockResolvedValue({
      storageKey: "freepbx/parker-davis/2026/07/interaction.wav",
      originalFileName: "call.wav",
      mimeType: "audio/wav",
      byteSize: BigInt(3),
      sha256: "a".repeat(64),
      durationMs: 118_000,
      channelCount: 1,
    });
    const persistPlayback = vi.fn().mockResolvedValue({
      storageKey: "freepbx/parker-davis/2026/07/interaction-playback.wav",
      originalFileName: "playback-interaction-pbx-1.wav",
      mimeType: "audio/wav",
      byteSize: BigInt(384),
      sha256: "b".repeat(64),
      durationMs: 118_000,
      channelCount: 1,
    });
    prismaMock.mediaAsset.create.mockResolvedValue({ id: "asset-freepbx" });
    const adapterFactory = vi.fn().mockReturnValue(sourceAdapter);

    await expect(
      attachProviderRecording(
        { interaction: freePbxInteraction, userId: "qa-1" },
        {
          database: prismaMock as never,
          adapterFactory,
          persistRecording,
          persistPlayback,
        },
      ),
    ).resolves.toEqual({ assetId: "asset-freepbx", attached: true });

    expect(adapterFactory).toHaveBeenCalledWith(InteractionProvider.FREEPBX, "parker-davis");
    expect(sourceAdapter.fetchRecording).toHaveBeenCalledWith({
      providerInteractionId: "1785500000.100",
      providerRecordingId: "1785500000.200",
    });
    expect(persistPlayback).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceStorageKey: "freepbx/parker-davis/2026/07/interaction.wav",
      }),
    );
    expect(prismaMock.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "PLAYBACK" }) }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "recording_attached" }),
      }),
    );
  });

  it("converts FreePBX authorization failures into a safe error", async () => {
    const sourceAdapter = adapter(new Response(null, { status: 403 }));

    const promise = attachProviderRecording(
      { interaction: freePbxInteraction, userId: "qa-1" },
      {
        database: prismaMock as never,
        adapterFactory: vi.fn().mockReturnValue(sourceAdapter),
      },
    );

    await expect(promise).rejects.toMatchObject({
      code: "RECORDING_FORBIDDEN",
    } satisfies Partial<CallRecordingProviderError>);
  });
});

describe("syncEnabledCallSources", () => {
  it("discovers only supported enabled sources inside the selected campaign", async () => {
    prismaMock.campaignCallSource.findMany.mockResolvedValue([]);

    await expect(
      syncEnabledCallSources({ campaignId: "campaign-parker" }, { database: prismaMock as never }),
    ).resolves.toEqual([]);

    expect(prismaMock.campaignCallSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId: "campaign-parker",
          enabled: true,
          provider: {
            in: [InteractionProvider.NICE_CXONE, InteractionProvider.FREEPBX],
          },
        },
      }),
    );
  });

  it("limits synchronization to the provider agents configured on the source", async () => {
    const sourceAdapter = adapter(new Response(null, { status: 404 }));
    vi.mocked(sourceAdapter.searchCalls).mockResolvedValue({ calls: [], nextCursor: null });
    prismaMock.campaignCallSource.findMany.mockResolvedValue([
      {
        id: "source-freepbx",
        campaignId: "campaign-parker",
        provider: InteractionProvider.FREEPBX,
        instanceKey: "parker-davis",
        settings: {
          initialLookbackHours: 24,
          overlapMinutes: 15,
          completionLagMinutes: 2,
          maxPages: 4,
          providerAgentIds: ["4116", "4115", "4156"],
        },
        lastSyncedAt: null,
      },
    ]);
    prismaMock.campaignCallSource.findUnique.mockResolvedValue({
      id: "source-freepbx",
      campaignId: "campaign-parker",
      provider: InteractionProvider.FREEPBX,
      instanceKey: "parker-davis",
      externalCampaignIds: ["parker-davis"],
      enabled: true,
    });
    prismaMock.campaignCallSource.update.mockResolvedValue({ id: "source-freepbx" });

    await syncEnabledCallSources(
      { campaignId: "campaign-parker" },
      {
        database: prismaMock as never,
        adapterFactory: vi.fn().mockReturnValue(sourceAdapter),
        now: () => new Date("2026-07-31T20:00:00.000Z"),
      },
    );

    expect(sourceAdapter.searchCalls).toHaveBeenCalledWith(
      expect.objectContaining({ providerAgentIds: ["4116", "4115", "4156"] }),
    );
  });
});
