"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import {
  attachProviderRecording,
  CallRecordingProviderError,
  syncEnabledCallSources,
} from "@/server/call-finder/call-source-service";
import { hasDiarizationProviderConfigured } from "@/server/call-finder/transcription-config";
import { enqueueTranscriptionJob } from "@/server/call-finder/transcription-queue";
import { getCallFinderCampaignFilter } from "@/server/queries/call-finder";

const interactionIdSchema = z.string().trim().min(1).max(100);
const syncScopeSchema = z
  .object({ campaignId: z.string().trim().min(1).max(100).optional() })
  .default({});
const transcriptionOptionsSchema = z
  .object({ requireDiarization: z.boolean().default(false) })
  .default({ requireDiarization: false });
const speakerAssignmentsSchema = z
  .object({
    interactionId: interactionIdSchema,
    transcriptId: z.string().trim().min(1).max(100),
    assignments: z
      .array(
        z.object({
          speakerKey: z.string().trim().min(1).max(40),
          role: z.enum(["AGENT", "CUSTOMER"]),
        }),
      )
      .min(1)
      .max(10),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.assignments.map((assignment) => assignment.speakerKey)).size !==
      value.assignments.length
    ) {
      context.addIssue({ code: "custom", message: "Speaker assignments must be unique" });
    }
  });

export async function syncCallSources(input?: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const scope = syncScopeSchema.parse(input);
  if (session.user.role !== "ADMIN") {
    await writeAuditLog({
      userId: session.user.id,
      module: "call_finder",
      action: "call_sync_denied",
      entityType: "campaign_call_source",
      impact: "A non-admin user attempted to synchronize an external call source.",
    });
    throw new Error("Only administrators can synchronize call sources");
  }

  if (scope.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: scope.campaignId, active: true },
      select: { id: true },
    });
    if (!campaign) throw new Error("Campaign not found");
  }

  const results = await syncEnabledCallSources(scope);
  for (const result of results) {
    await writeAuditLog({
      userId: session.user.id,
      campaignId: result.campaignId,
      module: "call_finder",
      action: "calls_synchronized",
      entityType: "campaign_call_source",
      entityId: result.sourceId,
      afterValue: {
        provider: result.provider,
        pages: result.pages,
        discovered: result.discovered,
        created: result.created,
        updated: result.updated,
        errors: result.errors.length,
        startedFrom: result.startedFrom,
        startedTo: result.startedTo,
      },
      impact: "Call metadata was synchronized into Call Finder; recordings remain on demand.",
    });
  }

  revalidatePath("/call-finder");
  return {
    sources: results.length,
    discovered: results.reduce((total, result) => total + result.discovered, 0),
    created: results.reduce((total, result) => total + result.created, 0),
    updated: results.reduce((total, result) => total + result.updated, 0),
    errors: results.reduce((total, result) => total + result.errors.length, 0),
  };
}

/** @deprecated Use syncCallSources. Kept for in-flight clients during deployment. */
export async function syncNiceCxoneCalls(input?: unknown) {
  return syncCallSources(input);
}

export async function attachCallRecording(interactionIdInput: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const interactionId = interactionIdSchema.parse(interactionIdInput);
  const campaignFilter = await getCallFinderCampaignFilter("evaluate");
  const interaction = await prisma.interaction.findFirst({
    where: { id: interactionId, ...campaignFilter },
    select: {
      id: true,
      campaignId: true,
      provider: true,
      providerInstance: true,
      providerInteractionId: true,
      hasRecording: true,
      metadata: true,
      startedAt: true,
      durationSeconds: true,
    },
  });
  if (!interaction) throw new Error("Call not found or access denied");

  try {
    const result = await attachProviderRecording({ interaction, userId: session.user.id });
    revalidatePath(`/call-finder/${interaction.id}`);
    revalidatePath("/call-finder");
    return { ...result, error: null, errorCode: null };
  } catch (error) {
    if (error instanceof CallRecordingProviderError) {
      return { assetId: null, attached: false, error: error.message, errorCode: error.code };
    }
    throw error;
  }
}

export async function transcribeCallRecording(interactionIdInput: string, optionsInput?: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const interactionId = interactionIdSchema.parse(interactionIdInput);
  const options = transcriptionOptionsSchema.parse(optionsInput);
  const campaignFilter = await getCallFinderCampaignFilter("evaluate");
  const interaction = await prisma.interaction.findFirst({
    where: { id: interactionId, ...campaignFilter },
    select: {
      id: true,
      campaignId: true,
      mediaAssets: {
        orderBy: [{ kind: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          storageKey: true,
          sha256: true,
          durationMs: true,
          channelCount: true,
        },
      },
    },
  });
  if (!interaction) throw new Error("Call not found or access denied");
  if (options.requireDiarization && !hasDiarizationProviderConfigured()) {
    return {
      jobId: null,
      transcriptId: null,
      provider: null,
      status: null,
      alreadyCompleted: false,
      error: "Configure a diarization provider before identifying speakers.",
      errorCode: "DIARIZATION_PROVIDER_REQUIRED",
    };
  }
  const mediaAsset = interaction.mediaAssets[0];
  if (!mediaAsset) {
    return {
      transcriptId: null,
      provider: null,
      status: null,
      error: "Attach the recording before generating a transcript.",
      errorCode: "RECORDING_REQUIRED",
    };
  }

  const result = await enqueueTranscriptionJob({
    interactionId,
    mediaAssetId: mediaAsset.id,
    requestedById: session.user.id,
    requireDiarization: options.requireDiarization,
  });
  await writeAuditLog({
    userId: session.user.id,
    campaignId: interaction.campaignId,
    module: "call_finder",
    action: result.alreadyCompleted
      ? "recording_transcription_reused"
      : "recording_transcription_queued",
    entityType: "interaction",
    entityId: interaction.id,
    afterValue: { jobId: result.jobId, status: result.status },
    impact: result.alreadyCompleted
      ? "An existing transcript was reused for the call."
      : "The call recording was queued for background transcription.",
  });
  revalidatePath(`/call-finder/${interaction.id}`);
  revalidatePath("/call-finder");
  return { ...result, error: null, errorCode: null };
}

export async function confirmTranscriptSpeakerRoles(input: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const parsed = speakerAssignmentsSchema.parse(input);
  const campaignFilter = await getCallFinderCampaignFilter("evaluate");
  const interaction = await prisma.interaction.findFirst({
    where: {
      id: parsed.interactionId,
      ...campaignFilter,
      transcripts: { some: { id: parsed.transcriptId } },
    },
    select: {
      id: true,
      campaignId: true,
      transcripts: {
        where: { id: parsed.transcriptId },
        take: 1,
        select: {
          id: true,
          isDiarized: true,
          segments: { select: { speakerKey: true, speakerRole: true } },
        },
      },
    },
  });
  const transcript = interaction?.transcripts[0];
  if (!interaction || !transcript) throw new Error("Transcript not found or access denied");
  if (!transcript.isDiarized) throw new Error("This transcript does not contain speaker labels");

  const speakerKeys = new Set(
    transcript.segments.flatMap((segment) =>
      segment.speakerKey === null ? [] : [segment.speakerKey],
    ),
  );
  const assignmentKeys = new Set(parsed.assignments.map((assignment) => assignment.speakerKey));
  if (
    speakerKeys.size === 0 ||
    assignmentKeys.size !== speakerKeys.size ||
    [...assignmentKeys].some((speakerKey) => !speakerKeys.has(speakerKey))
  ) {
    throw new Error("Assign a role to every detected speaker");
  }

  await prisma.$transaction(async (transaction) => {
    for (const assignment of parsed.assignments) {
      await transaction.transcriptSegment.updateMany({
        where: { transcriptId: transcript.id, speakerKey: assignment.speakerKey },
        data: { speakerRole: assignment.role },
      });
    }
    await transaction.transcript.update({
      where: { id: transcript.id },
      data: { status: "COMPLETED", speakerCount: speakerKeys.size },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: interaction.campaignId,
        module: "call_finder",
        action: "transcript_speaker_roles_confirmed",
        entityType: "transcript",
        entityId: transcript.id,
        beforeValue: {
          roles: transcript.segments.map((segment) => ({
            speakerKey: segment.speakerKey,
            role: segment.speakerRole,
          })),
        },
        afterValue: { roles: parsed.assignments },
        impact: "A QA user confirmed which diarized speakers are the agent and customer.",
      },
      transaction,
    );
  });

  revalidatePath(`/call-finder/${interaction.id}`);
  revalidatePath("/forms");
  return { success: true as const, transcriptId: transcript.id };
}
