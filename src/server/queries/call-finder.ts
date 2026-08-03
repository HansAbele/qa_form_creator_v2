import "server-only";

import {
  InteractionDirection,
  InteractionProvider,
  type Prisma,
  TranscriptionStatus,
} from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { inferCallEndParty } from "@/lib/call-end-party";
import { summarizeCallMetadata } from "@/lib/call-metadata";
import { getOperationalDateBounds } from "@/lib/operational-time";
import { prisma } from "@/lib/prisma";
import { providerAgentDisplayName } from "@/lib/provider-agent";
import { getCampaignFilter } from "@/server/queries/campaign-filter";

const PAGE_SIZE = 25;
const MAX_PAGE = 10_000;

export type CallFinderAccessMode = "evaluate" | "review";

export type CallFinderSearchParams = Record<string, string | string[] | undefined>;

const filterSchema = z
  .object({
    campaignId: z.string().trim().max(100).optional(),
    agentId: z.string().trim().max(200).optional(),
    provider: z.nativeEnum(InteractionProvider).optional(),
    direction: z.nativeEnum(InteractionDirection).optional(),
    phoneNumber: z.string().trim().max(50).optional(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    minDuration: z.coerce.number().int().min(0).max(86_400).optional(),
    maxDuration: z.coerce.number().int().min(0).max(86_400).optional(),
    page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  })
  .transform((value) => ({
    ...value,
    campaignId: value.campaignId || undefined,
    agentId: value.agentId || undefined,
    phoneNumber: value.phoneNumber || undefined,
    dateFrom: value.dateFrom || undefined,
    dateTo: value.dateTo || undefined,
  }));

export type CallFinderFilters = z.infer<typeof filterSchema>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCallFinderFilters(searchParams: CallFinderSearchParams): CallFinderFilters {
  const parsed = filterSchema.safeParse({
    campaignId: firstValue(searchParams.campaignId) || undefined,
    agentId: firstValue(searchParams.agentId) || undefined,
    provider: firstValue(searchParams.provider) || undefined,
    direction: firstValue(searchParams.direction) || undefined,
    phoneNumber: firstValue(searchParams.phoneNumber) || undefined,
    dateFrom: firstValue(searchParams.dateFrom) || undefined,
    dateTo: firstValue(searchParams.dateTo) || undefined,
    minDuration: firstValue(searchParams.minDuration) || undefined,
    maxDuration: firstValue(searchParams.maxDuration) || undefined,
    page: firstValue(searchParams.page) || undefined,
  });

  if (!parsed.success) return filterSchema.parse({ page: 1 });
  if (
    parsed.data.minDuration !== undefined &&
    parsed.data.maxDuration !== undefined &&
    parsed.data.minDuration > parsed.data.maxDuration
  ) {
    return { ...parsed.data, minDuration: undefined, maxDuration: undefined };
  }
  return parsed.data;
}

/**
 * Campaign membership always comes from getCampaignFilter(). Call Finder then
 * narrows that scope to evaluation/review capabilities on the same campaign.
 */
export async function getCallFinderCampaignFilter(
  mode: CallFinderAccessMode,
  campaignId?: string,
): Promise<{ campaignId?: string | { in: string[] } }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const membershipFilter = await getCampaignFilter(campaignId);
  if (session.user.role === "ADMIN") return membershipFilter;

  const assignments = await prisma.userCampaign.findMany({
    where: {
      userId: session.user.id,
      ...(typeof membershipFilter.campaignId === "string"
        ? { campaignId: membershipFilter.campaignId }
        : membershipFilter.campaignId
          ? { campaignId: membershipFilter.campaignId }
          : {}),
      ...(mode === "evaluate"
        ? { canEvaluate: true }
        : {
            OR: [{ canEvaluate: true }, { canEditEvaluations: true }, { canViewEvaluations: true }],
          }),
    },
    select: { campaignId: true },
  });

  return { campaignId: { in: assignments.map((assignment) => assignment.campaignId) } };
}

export function buildInteractionWhere(
  filters: CallFinderFilters,
  campaignFilter: { campaignId?: string | { in: string[] } },
): Prisma.InteractionWhereInput {
  const startedAt = getOperationalDateBounds(filters.dateFrom, filters.dateTo);
  const hasDurationFilter = filters.minDuration !== undefined || filters.maxDuration !== undefined;
  const durationSeconds = {
    ...(filters.minDuration !== undefined ? { gte: filters.minDuration } : {}),
    ...(filters.maxDuration !== undefined ? { lte: filters.maxDuration } : {}),
  };
  const durationMs = {
    ...(filters.minDuration !== undefined ? { gte: filters.minDuration * 1_000 } : {}),
    ...(filters.maxDuration !== undefined ? { lte: filters.maxDuration * 1_000 } : {}),
  };
  return {
    ...campaignFilter,
    AND: [
      {
        OR: [
          { agentId: { not: null } },
          { providerAgentId: { not: null } },
          { providerAgentName: { not: null } },
        ],
      },
      ...(hasDurationFilter
        ? [
            {
              OR: [
                { mediaAssets: { some: { durationMs } } },
                {
                  AND: [
                    { mediaAssets: { none: { durationMs: { not: null } } } },
                    { durationSeconds },
                  ],
                },
              ],
            } satisfies Prisma.InteractionWhereInput,
          ]
        : []),
    ],
    ...(filters.agentId
      ? filters.agentId.startsWith("provider:")
        ? { providerAgentId: filters.agentId.slice("provider:".length) }
        : { agentId: filters.agentId }
      : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.phoneNumber
      ? { phoneNumber: { contains: filters.phoneNumber, mode: "insensitive" } }
      : {}),
    ...(Object.keys(startedAt).length > 0 ? { startedAt } : {}),
  };
}

/**
 * Interaction and Agent rows reference campaigns through `campaignId`, while
 * the Campaign model itself is filtered by its primary key (`id`). Keep that
 * translation explicit so a scoped user never sends an invalid Prisma filter.
 */
export function toCampaignWhere(campaignFilter: {
  campaignId?: string | { in: string[] };
}): Prisma.CampaignWhereInput {
  const campaignId = campaignFilter.campaignId;

  return {
    active: true,
    ...(typeof campaignId === "string" ? { id: campaignId } : campaignId ? { id: campaignId } : {}),
  };
}

export async function getCallFinderCampaignOptions() {
  const campaignFilter = await getCallFinderCampaignFilter("evaluate");
  return prisma.campaign.findMany({
    where: toCampaignWhere(campaignFilter),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getCallFinderPageData(filters: CallFinderFilters) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const [campaignFilter, availableCampaignFilter] = await Promise.all([
    getCallFinderCampaignFilter("evaluate", filters.campaignId),
    getCallFinderCampaignFilter("evaluate"),
  ]);
  const where = buildInteractionWhere(filters, campaignFilter);

  const [totalCount, interactions, campaigns, agents, externalAgents, callSources] =
    await Promise.all([
      prisma.interaction.count({ where }),
      prisma.interaction.findMany({
        where,
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          provider: true,
          providerInteractionId: true,
          providerAgentId: true,
          providerAgentName: true,
          direction: true,
          phoneNumber: true,
          queueName: true,
          status: true,
          startedAt: true,
          durationSeconds: true,
          hasRecording: true,
          metadata: true,
          campaign: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true, agentCode: true } },
          disposition: { select: { id: true, name: true, code: true } },
          response: { select: { id: true, formId: true, status: true } },
          mediaAssets: {
            orderBy: { createdAt: "desc" },
            select: { id: true, durationMs: true },
            take: 1,
          },
          transcripts: {
            where: {
              status: {
                in: [TranscriptionStatus.COMPLETED, TranscriptionStatus.SPEAKERS_UNVERIFIED],
              },
            },
            orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
            select: { id: true, status: true, isDiarized: true },
            take: 1,
          },
        },
      }),
      prisma.campaign.findMany({
        where: toCampaignWhere(availableCampaignFilter),
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.agent.findMany({
        where: {
          ...campaignFilter,
          active: true,
        },
        select: { id: true, name: true, agentCode: true, campaignId: true },
        orderBy: { name: "asc" },
      }),
      prisma.interaction.findMany({
        where: {
          ...campaignFilter,
          agentId: null,
          providerAgentId: { not: null },
        },
        distinct: ["campaignId", "providerAgentId"],
        select: {
          campaignId: true,
          provider: true,
          providerAgentId: true,
          providerAgentName: true,
        },
        orderBy: { providerAgentId: "asc" },
      }),
      prisma.campaignCallSource.findMany({
        where: {
          ...campaignFilter,
          enabled: true,
        },
        select: {
          id: true,
          campaignId: true,
          provider: true,
          lastSyncedAt: true,
        },
        orderBy: [{ campaignId: "asc" }, { provider: "asc" }],
      }),
    ]);

  return {
    filters,
    pagination: {
      page: filters.page,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    },
    campaigns,
    callSources: callSources.map((source) => ({
      ...source,
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    })),
    agents: [
      ...agents,
      ...externalAgents.flatMap((agent) => {
        const displayName = providerAgentDisplayName(
          agent.provider,
          agent.providerAgentId,
          agent.providerAgentName,
        );
        return agent.providerAgentId && displayName
          ? [
              {
                id: `provider:${agent.providerAgentId}`,
                name: displayName,
                agentCode: agent.providerAgentId,
                campaignId: agent.campaignId,
                external: true as const,
              },
            ]
          : [];
      }),
    ],
    interactions: interactions.map((interaction) => ({
      ...interaction,
      endedBy: inferCallEndParty(interaction.status),
      providerAgentName: providerAgentDisplayName(
        interaction.provider,
        interaction.providerAgentId,
        interaction.providerAgentName,
      ),
      callMetadata: summarizeCallMetadata(interaction.metadata),
      metadata: undefined,
      startedAt: interaction.startedAt.toISOString(),
      durationSeconds:
        interaction.mediaAssets[0]?.durationMs != null
          ? Math.round(interaction.mediaAssets[0].durationMs / 1_000)
          : interaction.durationSeconds,
      recordingAvailable: interaction.mediaAssets.length > 0,
      transcript: interaction.transcripts[0] ?? null,
      mediaAssets: undefined,
      transcripts: undefined,
    })),
  };
}

export type CallFinderPageData = Awaited<ReturnType<typeof getCallFinderPageData>>;

const visibleTranscriptStatuses = [
  TranscriptionStatus.COMPLETED,
  TranscriptionStatus.SPEAKERS_UNVERIFIED,
];

export async function getCallFinderInteractionDetail(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const campaignFilter = await getCallFinderCampaignFilter("evaluate");

  const interaction = await prisma.interaction.findFirst({
    where: { id, ...campaignFilter },
    select: {
      id: true,
      provider: true,
      providerInstance: true,
      providerInteractionId: true,
      providerAgentId: true,
      providerAgentName: true,
      direction: true,
      phoneNumber: true,
      queueName: true,
      status: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      hasRecording: true,
      metadata: true,
      campaign: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, agentCode: true, active: true } },
      disposition: { select: { id: true, name: true, code: true, active: true } },
      response: { select: { id: true, formId: true, status: true } },
      mediaAssets: {
        orderBy: [{ kind: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          kind: true,
          mimeType: true,
          byteSize: true,
          durationMs: true,
          channelCount: true,
        },
      },
      transcripts: {
        where: { status: { in: visibleTranscriptStatuses } },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          provider: true,
          model: true,
          language: true,
          status: true,
          isDiarized: true,
          speakerCount: true,
          fullText: true,
          segments: {
            orderBy: { ordinal: "asc" },
            select: {
              id: true,
              ordinal: true,
              startMs: true,
              endMs: true,
              speakerKey: true,
              speakerRole: true,
              text: true,
              confidence: true,
            },
          },
        },
      },
      transcriptionJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          lastErrorCode: true,
        },
      },
    },
  });

  if (!interaction) return null;

  const forms = await prisma.form.findMany({
    where: { campaignId: interaction.campaign.id, status: "PUBLISHED" },
    select: { id: true, title: true, version: true },
    orderBy: { title: "asc" },
  });
  const mediaAsset = interaction.mediaAssets[0] ?? null;

  return {
    ...interaction,
    endedBy: inferCallEndParty(interaction.status),
    providerAgentName: providerAgentDisplayName(
      interaction.provider,
      interaction.providerAgentId,
      interaction.providerAgentName,
    ),
    callMetadata: summarizeCallMetadata(interaction.metadata),
    metadata: undefined,
    startedAt: interaction.startedAt.toISOString(),
    endedAt: interaction.endedAt?.toISOString() ?? null,
    mediaAsset: mediaAsset ? { ...mediaAsset, byteSize: mediaAsset.byteSize.toString() } : null,
    durationSeconds:
      mediaAsset?.durationMs != null
        ? Math.round(mediaAsset.durationMs / 1_000)
        : interaction.durationSeconds,
    audioUrl: mediaAsset ? `/api/call-finder/interactions/${interaction.id}/audio` : null,
    transcript: interaction.transcripts[0] ?? null,
    transcriptionJob: interaction.transcriptionJobs[0] ?? null,
    mediaAssets: undefined,
    transcripts: undefined,
    transcriptionJobs: undefined,
    forms,
  };
}

export type CallFinderInteractionDetail = NonNullable<
  Awaited<ReturnType<typeof getCallFinderInteractionDetail>>
>;

export type EvaluationInteractionContext = NonNullable<
  Awaited<ReturnType<typeof getInteractionForEvaluation>>
>;

const evaluationInteractionSelect = {
  id: true,
  provider: true,
  providerInteractionId: true,
  providerAgentId: true,
  providerAgentName: true,
  direction: true,
  phoneNumber: true,
  queueName: true,
  status: true,
  startedAt: true,
  durationSeconds: true,
  hasRecording: true,
  metadata: true,
  agent: { select: { id: true, name: true, agentCode: true, active: true } },
  disposition: { select: { id: true, name: true, code: true, active: true } },
  response: { select: { id: true, formId: true, status: true } },
  mediaAssets: {
    orderBy: { createdAt: "desc" },
    select: { id: true, durationMs: true },
    take: 1,
  },
  transcripts: {
    where: { status: { in: visibleTranscriptStatuses } },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: 1,
    select: {
      id: true,
      provider: true,
      status: true,
      isDiarized: true,
      segments: {
        orderBy: { ordinal: "asc" },
        select: {
          id: true,
          ordinal: true,
          startMs: true,
          endMs: true,
          speakerKey: true,
          speakerRole: true,
          text: true,
          confidence: true,
        },
      },
    },
  },
  transcriptionJobs: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      lastErrorCode: true,
    },
  },
} satisfies Prisma.InteractionSelect;

async function loadInteractionForForm(
  interactionId: string,
  formId: string,
  mode: CallFinderAccessMode,
  responseId?: string,
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const campaignFilter = await getCallFinderCampaignFilter(mode);

  const interaction = await prisma.interaction.findFirst({
    where: {
      id: interactionId,
      ...campaignFilter,
      campaign: { forms: { some: { id: formId } } },
      ...(responseId ? { response: { id: responseId } } : {}),
    },
    select: evaluationInteractionSelect,
  });

  if (!interaction) return null;

  return {
    ...interaction,
    endedBy: inferCallEndParty(interaction.status),
    providerAgentName: providerAgentDisplayName(
      interaction.provider,
      interaction.providerAgentId,
      interaction.providerAgentName,
    ),
    callMetadata: summarizeCallMetadata(interaction.metadata),
    metadata: undefined,
    startedAt: interaction.startedAt.toISOString(),
    durationSeconds:
      interaction.mediaAssets[0]?.durationMs != null
        ? Math.round(interaction.mediaAssets[0].durationMs / 1_000)
        : interaction.durationSeconds,
    agent: interaction.agent?.active ? interaction.agent : null,
    disposition: interaction.disposition?.active ? interaction.disposition : null,
    audioUrl:
      interaction.mediaAssets.length > 0
        ? `/api/call-finder/interactions/${interaction.id}/audio`
        : null,
    transcript: interaction.transcripts[0] ?? null,
    transcriptionJob: interaction.transcriptionJobs[0] ?? null,
    mediaAssets: undefined,
    transcripts: undefined,
    transcriptionJobs: undefined,
  };
}

export async function getInteractionForEvaluation(interactionId: string, formId: string) {
  return loadInteractionForForm(interactionId, formId, "evaluate");
}

export async function getInteractionForResponse(
  interactionId: string,
  formId: string,
  responseId: string,
) {
  return loadInteractionForForm(interactionId, formId, "review", responseId);
}
