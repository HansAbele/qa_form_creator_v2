import { InteractionProvider } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";
import {
  attachNiceCxoneRecording,
  type CallRecordingProviderError,
  syncEnabledNiceCxoneSources,
} from "./nice-cxone-service";
import type { CallSourceAdapter } from "./providers/contracts";

vi.mock("server-only", () => ({}));

const interaction = {
  id: "interaction-1",
  campaignId: "campaign-1",
  provider: InteractionProvider.NICE_CXONE,
  providerInstance: "hapusa",
  providerInteractionId: "contact-101",
  hasRecording: true,
  metadata: { masterContactId: "master-100" },
  startedAt: new Date("2026-07-21T12:00:00.000Z"),
  durationSeconds: 180,
};

function adapter(response: Response): CallSourceAdapter {
  return {
    provider: InteractionProvider.NICE_CXONE,
    searchCalls: vi.fn(),
    fetchRecording: vi.fn().mockResolvedValue(response),
  };
}

beforeEach(() => {
  resetPrismaMock();
  prismaMock.mediaAsset.findFirst.mockResolvedValue(null);
  prismaMock.campaignCallSource.findFirst.mockResolvedValue({ id: "source-1" });
  prismaMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
});

describe("attachNiceCxoneRecording", () => {
  it("should convert a provider 404 into a safe actionable error", async () => {
    const sourceAdapter = adapter(Response.json({ error: "not found" }, { status: 404 }));

    const promise = attachNiceCxoneRecording(
      { interaction, userId: "admin-1" },
      {
        database: prismaMock as never,
        adapterFactory: vi.fn().mockReturnValue(sourceAdapter),
      },
    );

    await expect(promise).rejects.toMatchObject({
      code: "RECORDING_NOT_FOUND",
    } satisfies Partial<CallRecordingProviderError>);
    expect(prismaMock.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("should store and audit a recording once", async () => {
    const sourceAdapter = adapter(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/wav" },
      }),
    );
    const persistRecording = vi.fn().mockResolvedValue({
      storageKey: "nice/hapusa/2026/07/interaction-1.wav",
      originalFileName: "call.wav",
      mimeType: "audio/wav",
      byteSize: BigInt(3),
      sha256: "a".repeat(64),
      durationMs: 175_000,
      channelCount: 2,
    });
    prismaMock.mediaAsset.create.mockResolvedValue({ id: "asset-1" });

    await expect(
      attachNiceCxoneRecording(
        { interaction, userId: "admin-1" },
        {
          database: prismaMock as never,
          adapterFactory: vi.fn().mockReturnValue(sourceAdapter),
          persistRecording,
        },
      ),
    ).resolves.toEqual({ assetId: "asset-1", attached: true });

    expect(sourceAdapter.fetchRecording).toHaveBeenCalledWith({
      providerInteractionId: "contact-101",
      providerRecordingId: "master-100",
    });
    expect(prismaMock.mediaAsset.create).toHaveBeenCalledOnce();
    expect(prismaMock.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationMs: 175_000, channelCount: 2 }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "recording_attached" }),
      }),
    );
  });
});

describe("syncEnabledNiceCxoneSources", () => {
  it("should scope source discovery to the selected campaign", async () => {
    prismaMock.campaignCallSource.findMany.mockResolvedValue([]);

    await expect(
      syncEnabledNiceCxoneSources(
        { campaignId: "campaign-hapusa" },
        { database: prismaMock as never },
      ),
    ).resolves.toEqual([]);

    expect(prismaMock.campaignCallSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: "campaign-hapusa" }),
      }),
    );
  });
});
