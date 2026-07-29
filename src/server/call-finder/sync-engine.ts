import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CallSourceAdapter,
  NormalizedProviderCall,
} from "@/server/call-finder/providers/contracts";
import {
  persistRecordingResponse,
  type StoredRecording,
} from "@/server/call-finder/recording-ingest";

const DEFAULT_MAX_PAGES = 100;

type SyncDatabase = Pick<
  typeof prisma,
  "agent" | "campaignCallSource" | "disposition" | "interaction" | "mediaAsset"
>;

export type CallSourceSyncResult = {
  sourceId: string;
  pages: number;
  discovered: number;
  created: number;
  updated: number;
  recordingsStored: number;
  errors: { providerInteractionId: string | null; code: string; message: string }[];
  completedAt: Date;
};

type SyncDependencies = {
  database?: SyncDatabase;
  persistRecording?: typeof persistRecordingResponse;
  now?: () => Date;
};

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : "SYNC_ERROR";
    return { code, message: error.message.slice(0, 500) };
  }
  return { code: "SYNC_ERROR", message: "Unknown synchronization error" };
}

function validateProviderCall(
  call: NormalizedProviderCall,
  source: {
    provider: NormalizedProviderCall["provider"];
    instanceKey: string;
    externalCampaignIds: string[];
  },
  startedFrom: Date,
  startedTo: Date,
) {
  if (call.provider !== source.provider || call.providerInstance !== source.instanceKey) {
    throw new Error("Provider call does not match the configured source");
  }
  if (!call.providerCampaignId || !source.externalCampaignIds.includes(call.providerCampaignId)) {
    throw new Error("Provider call is outside the configured external campaigns");
  }
  if (call.startedAt < startedFrom || call.startedAt > startedTo) {
    throw new Error("Provider call is outside the requested synchronization window");
  }
  if (!call.providerInteractionId.trim()) {
    throw new Error("Provider call has no interaction identifier");
  }
  if (!Number.isSafeInteger(call.durationSeconds) || call.durationSeconds < 0) {
    throw new Error("Provider call has an invalid duration");
  }
}

function interactionData(
  call: NormalizedProviderCall,
  source: { campaignId: string; instanceKey: string },
) {
  return {
    campaignId: source.campaignId,
    provider: call.provider,
    providerInstance: source.instanceKey,
    providerInteractionId: call.providerInteractionId,
    providerAgentId: call.providerAgentId,
    providerAgentName: call.providerAgentName,
    providerCampaignId: call.providerCampaignId,
    direction: call.direction,
    phoneNumber: call.phoneNumber,
    queueName: call.queueName,
    status: call.status,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    durationSeconds: call.durationSeconds,
    hasRecording: call.hasRecording,
    metadata: (call.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    lastSyncedAt: new Date(),
  };
}

type AgentMatchCandidate = { id: string; agentCode: string | null; name: string };

function normalizedNameTokens(value: string) {
  return [
    ...new Set(
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    ),
  ];
}

function buildAgentsByProviderName(agents: AgentMatchCandidate[]) {
  return agents.map((agent) => ({ ...agent, tokens: normalizedNameTokens(agent.name) }));
}

function findAgentByProviderName(
  providerName: string | null,
  candidates: ReturnType<typeof buildAgentsByProviderName>,
) {
  if (!providerName) return undefined;
  const providerTokens = normalizedNameTokens(providerName);
  if (providerTokens.length < 2) return undefined;

  const matches = candidates.filter((candidate) => {
    const providerIsSubset = providerTokens.every((token) => candidate.tokens.includes(token));
    const localIsSubset = candidate.tokens.every((token) => providerTokens.includes(token));
    return providerIsSubset || localIsSubset;
  });
  return matches.length === 1 ? matches[0]?.id : undefined;
}

async function storeRecording(
  input: {
    call: NormalizedProviderCall;
    interactionId: string;
    sourceInstance: string;
    adapter: CallSourceAdapter;
  },
  database: SyncDatabase,
  persistRecording: typeof persistRecordingResponse,
) {
  const existing = await database.mediaAsset.findFirst({
    where: { interactionId: input.interactionId, kind: "ORIGINAL" },
    select: { id: true },
  });
  if (existing || !input.call.hasRecording) return false;

  const response = await input.adapter.fetchRecording({
    providerInteractionId: input.call.providerInteractionId,
    providerRecordingId: input.call.providerRecordingId,
  });
  const stored: StoredRecording = await persistRecording({
    response,
    provider: input.call.provider,
    providerInstance: input.sourceInstance,
    interactionId: input.interactionId,
    startedAt: input.call.startedAt,
  });
  await database.mediaAsset.create({
    data: {
      interactionId: input.interactionId,
      kind: "ORIGINAL",
      storageKey: stored.storageKey,
      originalFileName: stored.originalFileName,
      mimeType: stored.mimeType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      durationMs: input.call.durationSeconds * 1000,
    },
  });
  return true;
}

/**
 * Provider-neutral, idempotent ingestion. Adapters may return only calls from
 * the requested external campaigns, but this boundary validates them again
 * before any tenant-scoped row is written.
 */
export async function syncCampaignCallSource(
  input: {
    sourceId: string;
    adapter: CallSourceAdapter;
    startedFrom: Date;
    startedTo: Date;
    maxPages?: number;
    downloadRecordings?: boolean;
  },
  dependencies: SyncDependencies = {},
): Promise<CallSourceSyncResult> {
  const database = dependencies.database ?? prisma;
  const persistRecording = dependencies.persistRecording ?? persistRecordingResponse;
  const now = dependencies.now ?? (() => new Date());
  const maximumPages = input.maxPages ?? DEFAULT_MAX_PAGES;

  if (input.startedFrom >= input.startedTo) throw new Error("Invalid synchronization window");
  if (!Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > 1_000) {
    throw new Error("Invalid synchronization page limit");
  }

  const source = await database.campaignCallSource.findUnique({
    where: { id: input.sourceId },
    select: {
      id: true,
      campaignId: true,
      provider: true,
      instanceKey: true,
      externalCampaignIds: true,
      enabled: true,
    },
  });
  if (!source?.enabled) throw new Error("Call source is unavailable");
  if (source.provider !== input.adapter.provider) throw new Error("Call source adapter mismatch");
  if (source.externalCampaignIds.length === 0) {
    throw new Error("Call source has no external campaigns configured");
  }

  const result: CallSourceSyncResult = {
    sourceId: source.id,
    pages: 0,
    discovered: 0,
    created: 0,
    updated: 0,
    recordingsStored: 0,
    errors: [],
    completedAt: now(),
  };
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (result.pages < maximumPages) {
    const page = await input.adapter.searchCalls({
      externalCampaignIds: source.externalCampaignIds,
      startedFrom: input.startedFrom,
      startedTo: input.startedTo,
      cursor,
    });
    result.pages += 1;
    result.discovered += page.calls.length;

    const dispositionCodes = page.calls.flatMap((call) =>
      call.dispositionCode ? [call.dispositionCode] : [],
    );
    const [agents, dispositions] = await Promise.all([
      page.calls.some((call) => call.providerAgentId || call.providerAgentName)
        ? database.agent.findMany({
            where: { campaignId: source.campaignId, active: true },
            select: { id: true, agentCode: true, name: true },
          })
        : [],
      dispositionCodes.length > 0
        ? database.disposition.findMany({
            where: {
              campaignId: source.campaignId,
              active: true,
              code: { in: dispositionCodes },
            },
            select: { id: true, code: true },
          })
        : [],
    ]);
    const agentsByCode = new Map(
      agents.flatMap((agent) => (agent.agentCode ? [[agent.agentCode, agent.id]] : [])),
    );
    const agentsByName = buildAgentsByProviderName(agents);
    const dispositionsByCode = new Map(
      dispositions.flatMap((disposition) =>
        disposition.code ? [[disposition.code, disposition.id]] : [],
      ),
    );

    for (const call of page.calls) {
      try {
        validateProviderCall(call, source, input.startedFrom, input.startedTo);
        const uniqueKey = {
          provider: call.provider,
          providerInstance: source.instanceKey,
          providerInteractionId: call.providerInteractionId,
        };
        const existing = await database.interaction.findUnique({
          where: { provider_providerInstance_providerInteractionId: uniqueKey },
          select: { id: true, campaignId: true },
        });
        if (existing && existing.campaignId !== source.campaignId) {
          throw new Error("Provider interaction is already assigned to another campaign");
        }

        const mappedAgentId = call.providerAgentId
          ? (agentsByCode.get(call.providerAgentId) ??
            findAgentByProviderName(call.providerAgentName, agentsByName))
          : findAgentByProviderName(call.providerAgentName, agentsByName);
        const mappedDispositionId = call.dispositionCode
          ? dispositionsByCode.get(call.dispositionCode)
          : undefined;
        const baseData = interactionData(call, source);
        const mappingData = {
          ...(mappedAgentId ? { agentId: mappedAgentId } : {}),
          ...(mappedDispositionId ? { dispositionId: mappedDispositionId } : {}),
        };
        const interaction = existing
          ? await database.interaction.update({
              where: { id: existing.id },
              data: { ...baseData, campaignId: undefined, ...mappingData },
              select: { id: true },
            })
          : await database.interaction.create({
              data: { ...baseData, ...mappingData },
              select: { id: true },
            });
        if (existing) result.updated += 1;
        else result.created += 1;

        if (
          input.downloadRecordings !== false &&
          (await storeRecording(
            {
              call,
              interactionId: interaction.id,
              sourceInstance: source.instanceKey,
              adapter: input.adapter,
            },
            database,
            persistRecording,
          ))
        ) {
          result.recordingsStored += 1;
        }
      } catch (error) {
        result.errors.push({
          providerInteractionId: call.providerInteractionId || null,
          ...errorDetails(error),
        });
      }
    }

    if (!page.nextCursor) {
      cursor = undefined;
      break;
    }
    if (seenCursors.has(page.nextCursor)) throw new Error("Provider returned a repeated cursor");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  if (cursor && result.pages >= maximumPages) {
    throw new Error("Synchronization page limit reached");
  }

  result.completedAt = now();
  await database.campaignCallSource.update({
    where: { id: source.id },
    data: { lastSyncedAt: result.completedAt },
  });
  return result;
}
