import { InteractionDirection, InteractionProvider } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";
import type { CallSourceAdapter, NormalizedProviderCall } from "./providers/contracts";
import { syncCampaignCallSource } from "./sync-engine";

vi.mock("server-only", () => ({}));

const startedFrom = new Date("2026-07-20T00:00:00.000Z");
const startedTo = new Date("2026-07-21T00:00:00.000Z");
const completedAt = new Date("2026-07-21T01:00:00.000Z");

function providerCall(overrides: Partial<NormalizedProviderCall> = {}): NormalizedProviderCall {
  return {
    provider: InteractionProvider.NICE_CXONE,
    providerInstance: "hapusa",
    providerInteractionId: "contact-101",
    providerRecordingId: "master-100",
    providerCampaignId: "skill-10",
    providerAgentId: "agent-20",
    providerAgentName: "John Smith",
    dispositionCode: "SALE",
    direction: InteractionDirection.INBOUND,
    phoneNumber: "+15550101",
    queueName: "Customer Service",
    status: "completed",
    startedAt: new Date("2026-07-20T12:00:00.000Z"),
    endedAt: new Date("2026-07-20T12:03:00.000Z"),
    durationSeconds: 180,
    hasRecording: true,
    ...overrides,
  };
}

function adapter(call: NormalizedProviderCall): CallSourceAdapter {
  return {
    provider: InteractionProvider.NICE_CXONE,
    searchCalls: vi.fn().mockResolvedValue({ calls: [call], nextCursor: null }),
    fetchRecording: vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } }),
      ),
  };
}

beforeEach(() => {
  resetPrismaMock();
  prismaMock.campaignCallSource.findUnique.mockResolvedValue({
    id: "source-1",
    campaignId: "campaign-1",
    provider: InteractionProvider.NICE_CXONE,
    instanceKey: "hapusa",
    externalCampaignIds: ["skill-10"],
    enabled: true,
  });
  prismaMock.agent.findMany.mockResolvedValue([
    { id: "agent-local", agentCode: "agent-20", name: "John Michael Smith" },
  ]);
  prismaMock.disposition.findMany.mockResolvedValue([{ id: "disp-local", code: "SALE" }]);
  prismaMock.interaction.findUnique.mockResolvedValue(null);
  prismaMock.interaction.create.mockResolvedValue({ id: "interaction-1" });
  prismaMock.mediaAsset.findFirst.mockResolvedValue(null);
  prismaMock.mediaAsset.create.mockResolvedValue({ id: "asset-1" });
  prismaMock.campaignCallSource.update.mockResolvedValue({ id: "source-1" });
});

describe("syncCampaignCallSource", () => {
  it("should ingest a scoped call, map local entities, and persist its recording", async () => {
    const sourceAdapter = adapter(providerCall());
    const persistRecording = vi.fn().mockResolvedValue({
      storageKey: "nice/hapusa/2026/07/interaction-1.wav",
      originalFileName: "call.wav",
      mimeType: "audio/wav",
      byteSize: BigInt(3),
      sha256: "a".repeat(64),
    });

    const result = await syncCampaignCallSource(
      { sourceId: "source-1", adapter: sourceAdapter, startedFrom, startedTo },
      { database: prismaMock as never, persistRecording, now: () => completedAt },
    );

    expect(result).toEqual(
      expect.objectContaining({ discovered: 1, created: 1, updated: 0, recordingsStored: 1 }),
    );
    expect(prismaMock.interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: "campaign-1",
          agentId: "agent-local",
          dispositionId: "disp-local",
        }),
      }),
    );
    expect(prismaMock.mediaAsset.create).toHaveBeenCalledOnce();
    expect(sourceAdapter.fetchRecording).toHaveBeenCalledWith({
      providerInteractionId: "contact-101",
      providerRecordingId: "master-100",
    });
  });

  it("should reject a provider call outside the configured external campaigns", async () => {
    const result = await syncCampaignCallSource(
      {
        sourceId: "source-1",
        adapter: adapter(providerCall({ providerCampaignId: "skill-other" })),
        startedFrom,
        startedTo,
      },
      { database: prismaMock as never, now: () => completedAt },
    );

    expect(result.errors).toEqual([
      expect.objectContaining({
        providerInteractionId: "contact-101",
        message: "Provider call is outside the configured external campaigns",
      }),
    ]);
    expect(prismaMock.interaction.create).not.toHaveBeenCalled();
  });

  it("should map an abbreviated provider name only when it identifies one local agent", async () => {
    prismaMock.agent.findMany.mockResolvedValue([
      { id: "agent-name-match", agentCode: "local-1", name: "Audrey Luz Peralta Gonzalez" },
      { id: "agent-other", agentCode: "local-2", name: "Antonia Eugene" },
    ]);

    await syncCampaignCallSource(
      {
        sourceId: "source-1",
        adapter: adapter(
          providerCall({ providerAgentId: "nice-20", providerAgentName: "Audrey Gonzalez" }),
        ),
        startedFrom,
        startedTo,
        downloadRecordings: false,
      },
      { database: prismaMock as never, now: () => completedAt },
    );

    expect(prismaMock.interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ agentId: "agent-name-match" }) }),
    );
    expect(prismaMock.mediaAsset.create).not.toHaveBeenCalled();
  });

  it("should leave ambiguous provider names unmapped", async () => {
    prismaMock.agent.findMany.mockResolvedValue([
      { id: "agent-1", agentCode: "local-1", name: "Jean Rony Alysiee" },
      { id: "agent-2", agentCode: "local-2", name: "Jean Pierre Alysiee" },
    ]);

    await syncCampaignCallSource(
      {
        sourceId: "source-1",
        adapter: adapter(
          providerCall({ providerAgentId: "nice-20", providerAgentName: "Jean Alysiee" }),
        ),
        startedFrom,
        startedTo,
        downloadRecordings: false,
      },
      { database: prismaMock as never, now: () => completedAt },
    );

    expect(prismaMock.interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ agentId: expect.anything() }),
      }),
    );
  });

  it("should never move an existing interaction into another local campaign", async () => {
    prismaMock.interaction.findUnique.mockResolvedValue({
      id: "interaction-existing",
      campaignId: "campaign-other",
    });

    const result = await syncCampaignCallSource(
      { sourceId: "source-1", adapter: adapter(providerCall()), startedFrom, startedTo },
      { database: prismaMock as never, now: () => completedAt },
    );

    expect(result.errors[0]?.message).toBe(
      "Provider interaction is already assigned to another campaign",
    );
    expect(prismaMock.interaction.update).not.toHaveBeenCalled();
  });

  it("should complete normally when the final provider page equals the page limit", async () => {
    const sourceAdapter = adapter(providerCall({ hasRecording: false }));
    vi.mocked(sourceAdapter.searchCalls)
      .mockResolvedValueOnce({ calls: [], nextCursor: "page-2" })
      .mockResolvedValueOnce({ calls: [], nextCursor: null });

    const result = await syncCampaignCallSource(
      {
        sourceId: "source-1",
        adapter: sourceAdapter,
        startedFrom,
        startedTo,
        maxPages: 2,
      },
      { database: prismaMock as never, now: () => completedAt },
    );

    expect(result.pages).toBe(2);
    expect(result.errors).toEqual([]);
  });
});
