import "server-only";

import { InteractionProvider, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import { createNiceCxoneCallSourceAdapter } from "@/server/call-finder/providers/factory";
import { persistRecordingResponse } from "@/server/call-finder/recording-ingest";
import { syncCampaignCallSource } from "@/server/call-finder/sync-engine";

const sourceSettingsSchema = z
  .object({
    initialLookbackHours: z.coerce.number().int().min(1).max(72).default(24),
    overlapMinutes: z.coerce.number().int().min(1).max(60).default(15),
    completionLagMinutes: z.coerce.number().int().min(0).max(60).default(5),
    maxPages: z.coerce.number().int().min(1).max(100).default(10),
  })
  .passthrough();

type ServiceDatabase = typeof prisma;

type ServiceDependencies = {
  database?: ServiceDatabase;
  now?: () => Date;
  adapterFactory?: typeof createNiceCxoneCallSourceAdapter;
  persistRecording?: typeof persistRecordingResponse;
};

type NiceCxoneSyncScope = {
  campaignId?: string;
};

export class CallRecordingProviderError extends Error {
  constructor(
    message: string,
    readonly code: "RECORDING_NOT_FOUND" | "RECORDING_FORBIDDEN" | "RECORDING_UNAVAILABLE",
  ) {
    super(message);
    this.name = "CallRecordingProviderError";
  }
}

function settingsFromJson(value: Prisma.JsonValue | null) {
  const parsed = sourceSettingsSchema.safeParse(value ?? {});
  if (!parsed.success) throw new Error("NICE CXone source settings are invalid");
  return parsed.data;
}

export async function syncEnabledNiceCxoneSources(
  scope: NiceCxoneSyncScope = {},
  dependencies: ServiceDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const now = dependencies.now?.() ?? new Date();
  const adapterFactory = dependencies.adapterFactory ?? createNiceCxoneCallSourceAdapter;
  const sources = await database.campaignCallSource.findMany({
    where: {
      provider: InteractionProvider.NICE_CXONE,
      enabled: true,
      ...(scope.campaignId ? { campaignId: scope.campaignId } : {}),
    },
    select: {
      id: true,
      campaignId: true,
      instanceKey: true,
      settings: true,
      lastSyncedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const results = [];
  for (const source of sources) {
    const settings = settingsFromJson(source.settings);
    const startedTo = new Date(now.getTime() - settings.completionLagMinutes * 60_000);
    const candidateFrom = source.lastSyncedAt
      ? new Date(source.lastSyncedAt.getTime() - settings.overlapMinutes * 60_000)
      : new Date(startedTo.getTime() - settings.initialLookbackHours * 3_600_000);
    const startedFrom =
      candidateFrom < startedTo ? candidateFrom : new Date(startedTo.getTime() - 60_000);

    const result = await syncCampaignCallSource(
      {
        sourceId: source.id,
        adapter: adapterFactory(source.instanceKey),
        startedFrom,
        startedTo,
        maxPages: settings.maxPages,
        downloadRecordings: false,
      },
      { database, now: () => now },
    );
    results.push({ ...result, campaignId: source.campaignId, startedFrom, startedTo });
  }
  return results;
}

type RecordingInteraction = {
  id: string;
  campaignId: string;
  provider: InteractionProvider;
  providerInstance: string;
  providerInteractionId: string;
  hasRecording: boolean;
  metadata: Prisma.JsonValue | null;
  startedAt: Date;
  durationSeconds: number;
};

function providerRecordingId(interaction: RecordingInteraction) {
  const metadata = interaction.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = metadata.masterContactId;
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return interaction.providerInteractionId;
}

export async function attachNiceCxoneRecording(
  input: { interaction: RecordingInteraction; userId: string },
  dependencies: ServiceDependencies = {},
) {
  const database = dependencies.database ?? prisma;
  const persistRecording = dependencies.persistRecording ?? persistRecordingResponse;
  const adapterFactory = dependencies.adapterFactory ?? createNiceCxoneCallSourceAdapter;
  if (input.interaction.provider !== InteractionProvider.NICE_CXONE) {
    throw new Error("This recording provider is not configured yet");
  }
  if (!input.interaction.hasRecording) {
    throw new Error("NICE CXone does not report a recording for this call");
  }

  const existing = await database.mediaAsset.findFirst({
    where: { interactionId: input.interaction.id, kind: "ORIGINAL" },
    select: { id: true },
  });
  if (existing) return { assetId: existing.id, attached: false };

  const source = await database.campaignCallSource.findFirst({
    where: {
      campaignId: input.interaction.campaignId,
      provider: input.interaction.provider,
      instanceKey: input.interaction.providerInstance,
      enabled: true,
    },
    select: { id: true },
  });
  if (!source) throw new Error("The call source is not available");

  const response = await adapterFactory(input.interaction.providerInstance).fetchRecording({
    providerInteractionId: input.interaction.providerInteractionId,
    providerRecordingId: providerRecordingId(input.interaction),
  });
  if (response.status === 404) {
    throw new CallRecordingProviderError(
      "NICE CXone could not find an ACD recording for this contact. Verify CallLog retention or archived storage.",
      "RECORDING_NOT_FOUND",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new CallRecordingProviderError(
      "NICE CXone denied access to this ACD recording. Verify contact-file access for the access key user.",
      "RECORDING_FORBIDDEN",
    );
  }
  if (!response.ok) {
    throw new CallRecordingProviderError(
      "NICE CXone ACD recording retrieval is temporarily unavailable.",
      "RECORDING_UNAVAILABLE",
    );
  }
  const stored = await persistRecording({
    response,
    provider: input.interaction.provider,
    providerInstance: input.interaction.providerInstance,
    interactionId: input.interaction.id,
    startedAt: input.interaction.startedAt,
  });

  return database.$transaction(async (tx) => {
    const existingInsideTransaction = await tx.mediaAsset.findFirst({
      where: { interactionId: input.interaction.id, kind: "ORIGINAL" },
      select: { id: true },
    });
    if (existingInsideTransaction) {
      return { assetId: existingInsideTransaction.id, attached: false };
    }

    const asset = await tx.mediaAsset.create({
      data: {
        interactionId: input.interaction.id,
        kind: "ORIGINAL",
        storageKey: stored.storageKey,
        originalFileName: stored.originalFileName,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        durationMs: stored.durationMs ?? input.interaction.durationSeconds * 1_000,
        channelCount: stored.channelCount,
      },
      select: { id: true },
    });
    await writeAuditLog(
      {
        userId: input.userId,
        campaignId: input.interaction.campaignId,
        module: "call_finder",
        action: "recording_attached",
        entityType: "interaction",
        entityId: input.interaction.id,
        afterValue: { provider: input.interaction.provider, mediaAssetId: asset.id },
        impact: "The provider recording is now stored with the call and its evaluation.",
      },
      tx,
    );
    return { assetId: asset.id, attached: true };
  });
}
