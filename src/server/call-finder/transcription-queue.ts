import "server-only";

import { TranscriptionJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import { TranscriptionServiceError, transcribeInteractionRecording } from "./transcription-service";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_LEASE_MS = 45 * 60 * 1_000;
const ERROR_MESSAGE_LIMIT = 1_000;

type ActiveJob = {
  id: string;
  status: TranscriptionJobStatus;
  attemptCount: number;
  maxAttempts: number;
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function maxAttempts() {
  return boundedInteger(process.env.TRANSCRIPTION_JOB_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 10);
}

function leaseMs() {
  return boundedInteger(
    process.env.TRANSCRIPTION_JOB_LEASE_MS,
    DEFAULT_LEASE_MS,
    60_000,
    4 * 60 * 60 * 1_000,
  );
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown transcription job failure";
  return message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/(api[-_ ]?key|token|secret)(\s*[=:]\s*)[^\s,"'}]+/gi, "$1$2[REDACTED]")
    .slice(0, ERROR_MESSAGE_LIMIT);
}

function errorCode(error: unknown) {
  if (error instanceof TranscriptionServiceError) return error.code;
  return (error as NodeJS.ErrnoException).code ?? "TRANSCRIPTION_JOB_FAILED";
}

function shouldRetry(error: unknown) {
  if (!(error instanceof TranscriptionServiceError)) return true;
  return [
    "TRANSCRIPTION_IN_PROGRESS",
    "AUDIO_PREPROCESSING_UNAVAILABLE",
    "PROVIDERS_FAILED",
  ].includes(error.code);
}

function retryDelayMs(attemptCount: number) {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

async function activeJobForMedia(mediaAssetId: string): Promise<ActiveJob | null> {
  return prisma.transcriptionJob.findFirst({
    where: {
      mediaAssetId,
      status: { in: [TranscriptionJobStatus.PENDING, TranscriptionJobStatus.PROCESSING] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, attemptCount: true, maxAttempts: true },
  });
}

export async function enqueueTranscriptionJob(input: {
  interactionId: string;
  mediaAssetId: string;
  requestedById: string;
  requireDiarization?: boolean;
}) {
  const completed = await prisma.transcript.findFirst({
    where: {
      mediaAssetId: input.mediaAssetId,
      ...(input.requireDiarization
        ? {
            OR: [
              { status: "COMPLETED" as const },
              { status: "SPEAKERS_UNVERIFIED" as const, isDiarized: true },
            ],
          }
        : { status: { in: ["COMPLETED" as const, "SPEAKERS_UNVERIFIED" as const] } }),
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, provider: true, status: true },
  });
  if (completed) {
    return {
      jobId: null,
      transcriptId: completed.id,
      provider: completed.provider,
      status: completed.status,
      alreadyCompleted: true,
    } as const;
  }

  const active = await activeJobForMedia(input.mediaAssetId);
  if (active) {
    return {
      jobId: active.id,
      transcriptId: null,
      provider: null,
      status: active.status,
      alreadyCompleted: false,
    } as const;
  }

  try {
    const job = await prisma.transcriptionJob.create({
      data: {
        interactionId: input.interactionId,
        mediaAssetId: input.mediaAssetId,
        requestedById: input.requestedById,
        requireDiarization: input.requireDiarization ?? false,
        maxAttempts: maxAttempts(),
      },
      select: { id: true, status: true },
    });
    return {
      jobId: job.id,
      transcriptId: null,
      provider: null,
      status: job.status,
      alreadyCompleted: false,
    } as const;
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const concurrent = await activeJobForMedia(input.mediaAssetId);
    if (!concurrent) throw error;
    return {
      jobId: concurrent.id,
      transcriptId: null,
      provider: null,
      status: concurrent.status,
      alreadyCompleted: false,
    } as const;
  }
}

async function claimJob(jobId: string) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - leaseMs());
  const claimed = await prisma.transcriptionJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: TranscriptionJobStatus.PENDING, runAfter: { lte: now } },
        { status: TranscriptionJobStatus.PROCESSING, lockedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: TranscriptionJobStatus.PROCESSING,
      lockedAt: now,
      completedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return null;

  return prisma.transcriptionJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      interactionId: true,
      requestedById: true,
      requireDiarization: true,
      attemptCount: true,
      maxAttempts: true,
      interaction: { select: { campaignId: true } },
      mediaAsset: {
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
}

export async function processTranscriptionJob(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) return false;

  try {
    const result = await transcribeInteractionRecording({
      interactionId: job.interactionId,
      mediaAsset: job.mediaAsset,
      requireDiarization: job.requireDiarization,
    });
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: {
        status: TranscriptionJobStatus.COMPLETED,
        transcriptId: result.transcriptId,
        lockedAt: null,
        completedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (job.requestedById) {
      await writeAuditLog({
        userId: job.requestedById,
        campaignId: job.interaction.campaignId,
        module: "call_finder",
        action: "recording_transcribed",
        entityType: "interaction",
        entityId: job.interactionId,
        afterValue: { provider: result.provider, status: result.status, jobId: job.id },
        impact:
          "A queued call recording was transcribed and linked to its interaction and evaluation.",
      });
    }
    return true;
  } catch (error) {
    const retry = shouldRetry(error) && job.attemptCount < job.maxAttempts;
    await prisma.transcriptionJob.update({
      where: { id: job.id },
      data: {
        status: retry ? TranscriptionJobStatus.PENDING : TranscriptionJobStatus.FAILED,
        runAfter: retry ? new Date(Date.now() + retryDelayMs(job.attemptCount)) : new Date(),
        lockedAt: null,
        completedAt: retry ? null : new Date(),
        lastErrorCode: errorCode(error),
        lastErrorMessage: safeErrorMessage(error),
      },
    });
    if (!retry && job.requestedById) {
      await writeAuditLog({
        userId: job.requestedById,
        campaignId: job.interaction.campaignId,
        module: "call_finder",
        action: "recording_transcription_failed",
        entityType: "interaction",
        entityId: job.interactionId,
        afterValue: { errorCode: errorCode(error), jobId: job.id },
        impact: "A queued call transcription exhausted its permitted processing attempts.",
      });
    }
    return true;
  }
}

export async function processNextTranscriptionJob() {
  const staleBefore = new Date(Date.now() - leaseMs());
  const candidates = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "TranscriptionJob"
    WHERE
      ("status" = 'PENDING' AND "runAfter" <= CURRENT_TIMESTAMP)
      OR ("status" = 'PROCESSING' AND "lockedAt" < ${staleBefore})
    ORDER BY "runAfter" ASC, "createdAt" ASC
    LIMIT 1
  `;
  const candidate = candidates[0];
  return candidate ? processTranscriptionJob(candidate.id) : false;
}

type WorkerState = { timer?: NodeJS.Timeout; processing: boolean };

const workerGlobal = globalThis as typeof globalThis & {
  __qoreTranscriptionWorker?: WorkerState;
};

export function startTranscriptionWorker() {
  if (process.env.TRANSCRIPTION_WORKER_ENABLED?.trim().toLowerCase() === "false") return;
  if (workerGlobal.__qoreTranscriptionWorker?.timer) return;

  const state: WorkerState = { processing: false };
  workerGlobal.__qoreTranscriptionWorker = state;
  const poll = async () => {
    if (state.processing) return;
    state.processing = true;
    try {
      await processNextTranscriptionJob();
    } catch (error) {
      console.error("Transcription worker poll failed", {
        code: errorCode(error),
        message: safeErrorMessage(error),
      });
    } finally {
      state.processing = false;
    }
  };
  const intervalMs = boundedInteger(
    process.env.TRANSCRIPTION_WORKER_POLL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    1_000,
    60_000,
  );
  state.timer = setInterval(() => void poll(), intervalMs);
  state.timer.unref();
  void poll();
}
