import "server-only";

import { createHash } from "node:crypto";
import type { MediaAsset, TranscriptionStatus, TranscriptProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AudioPreparationError, prepareAudioForTranscription } from "./audio-preparation";
import type { CanonicalTranscript, TranscriptionAdapter } from "./providers/contracts";
import { DeepgramTranscriptionAdapter } from "./providers/deepgram-transcription-adapter";
import { GroqTranscriptionAdapter } from "./providers/groq-transcription-adapter";
import { NvidiaNimTranscriptionAdapter } from "./providers/nvidia-nim-transcription-adapter";
import { TranscriptionProviderError } from "./providers/transcription-http";
import { resolveRecordingStorageKey } from "./storage";
import { getTranscriptionConfig, type TranscriptionProviderConfig } from "./transcription-config";
import { isRetryableTranscriptionFailure } from "./transcription-failover";

const PROCESSING_LEASE_MS = 15 * 60 * 1000;
const ERROR_MESSAGE_LIMIT = 1000;

type TranscriptionMediaAsset = Pick<
  MediaAsset,
  "id" | "storageKey" | "sha256" | "durationMs" | "channelCount"
>;

export class TranscriptionServiceError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_PROVIDER_CONFIGURED"
      | "NO_DIARIZATION_PROVIDER_CONFIGURED"
      | "TRANSCRIPTION_IN_PROGRESS"
      | "AUDIO_PREPROCESSING_UNAVAILABLE"
      | "AUDIO_PREPROCESSING_FAILED"
      | "AUDIO_TOO_LARGE"
      | "PROVIDERS_FAILED",
  ) {
    super(message);
    this.name = "TranscriptionServiceError";
  }
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown transcription failure";
  return message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/(api[-_ ]?key|token|secret)(\s*[=:]\s*)[^\s,"'}]+/gi, "$1$2[REDACTED]")
    .slice(0, ERROR_MESSAGE_LIMIT);
}

function errorDetails(error: unknown) {
  if (error instanceof TranscriptionProviderError) {
    return { code: error.code, httpStatus: error.httpStatus, message: safeErrorMessage(error) };
  }
  const nodeError = error as NodeJS.ErrnoException;
  return {
    code: nodeError.code ?? "TRANSCRIPTION_FAILED",
    httpStatus: undefined,
    message: safeErrorMessage(error),
  };
}

function fingerprint(
  asset: TranscriptionMediaAsset,
  provider: TranscriptProvider,
  model: string,
  language: string,
) {
  return createHash("sha256")
    .update(["qore-transcription-v1", asset.sha256, provider, model, language].join(":"))
    .digest("hex");
}

function createAdapter(
  provider: TranscriptionProviderConfig,
  apiKey: string,
  timeoutMs: number,
): TranscriptionAdapter {
  const options = { apiKey, url: provider.url, timeoutMs };
  if (provider.provider === "DEEPGRAM") {
    return new DeepgramTranscriptionAdapter(provider.model, options);
  }
  if (provider.provider === "NVIDIA_NIM") {
    return new NvidiaNimTranscriptionAdapter(provider.model, options);
  }
  return new GroqTranscriptionAdapter(provider.model, options);
}

function normalizedSegments(transcript: CanonicalTranscript, fallbackDurationMs: number) {
  const segments = transcript.segments.flatMap((segment) => {
    const text = segment.text.trim();
    if (!text) return [];
    const startMs = Math.max(0, Math.round(segment.startMs));
    const endMs = Math.max(startMs, Math.round(segment.endMs));
    const confidence =
      segment.confidence === null || !Number.isFinite(segment.confidence)
        ? null
        : Math.min(1, Math.max(0, segment.confidence));
    return [{ ...segment, startMs, endMs, text, confidence }];
  });

  if (segments.length > 0) {
    return segments.map((segment, ordinal) => ({ ...segment, ordinal }));
  }
  return [
    {
      ordinal: 0,
      startMs: 0,
      endMs: Math.max(0, fallbackDurationMs),
      speakerKey: null,
      speakerRole: "UNKNOWN" as const,
      text: transcript.fullText.trim(),
      confidence: null,
    },
  ];
}

function transcriptStatus(transcript: CanonicalTranscript): TranscriptionStatus {
  return transcript.isDiarized &&
    transcript.segments.every((segment) => segment.speakerRole !== "UNKNOWN")
    ? "COMPLETED"
    : "SPEAKERS_UNVERIFIED";
}

async function claimTranscript(input: {
  interactionId: string;
  mediaAssetId: string;
  provider: TranscriptProvider;
  model: string;
  jobFingerprint: string;
}) {
  const uniqueWhere = {
    mediaAssetId_provider_model_jobFingerprint: {
      mediaAssetId: input.mediaAssetId,
      provider: input.provider,
      model: input.model,
      jobFingerprint: input.jobFingerprint,
    },
  } as const;
  const existing = await prisma.transcript.findUnique({ where: uniqueWhere });
  if (existing) {
    if (existing.status === "COMPLETED" || existing.status === "SPEAKERS_UNVERIFIED") {
      return { transcript: existing, alreadyCompleted: true };
    }
    return {
      transcript: await prisma.transcript.update({
        where: { id: existing.id },
        data: {
          status: "PROCESSING",
          errorCode: null,
          errorMessage: null,
          startedAt: new Date(),
          completedAt: null,
        },
      }),
      alreadyCompleted: false,
    };
  }

  try {
    return {
      transcript: await prisma.transcript.create({
        data: {
          interactionId: input.interactionId,
          mediaAssetId: input.mediaAssetId,
          provider: input.provider,
          model: input.model,
          jobFingerprint: input.jobFingerprint,
          status: "PROCESSING",
          startedAt: new Date(),
        },
      }),
      alreadyCompleted: false,
    };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const concurrent = await prisma.transcript.findUnique({ where: uniqueWhere });
    if (!concurrent) throw error;
    if (concurrent.status === "COMPLETED" || concurrent.status === "SPEAKERS_UNVERIFIED") {
      return { transcript: concurrent, alreadyCompleted: true };
    }
    throw new TranscriptionServiceError(
      "This recording is already being transcribed",
      "TRANSCRIPTION_IN_PROGRESS",
    );
  }
}

export async function transcribeInteractionRecording(input: {
  interactionId: string;
  mediaAsset: TranscriptionMediaAsset;
  requireDiarization?: boolean;
}) {
  const config = getTranscriptionConfig();
  if (config.providers.length === 0) {
    throw new TranscriptionServiceError(
      "No transcription provider is configured",
      "NO_PROVIDER_CONFIGURED",
    );
  }
  const providers = input.requireDiarization
    ? config.providers.filter((provider) => provider.provider === "DEEPGRAM")
    : config.providers;
  if (input.requireDiarization && providers.length === 0) {
    throw new TranscriptionServiceError(
      "No diarization provider is configured",
      "NO_DIARIZATION_PROVIDER_CONFIGURED",
    );
  }

  const completed = await prisma.transcript.findFirst({
    where: {
      mediaAssetId: input.mediaAsset.id,
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
  });
  if (completed) {
    return { transcriptId: completed.id, provider: completed.provider, status: completed.status };
  }

  const processing = await prisma.transcript.findFirst({
    where: {
      mediaAssetId: input.mediaAsset.id,
      status: "PROCESSING",
      updatedAt: { gte: new Date(Date.now() - PROCESSING_LEASE_MS) },
    },
    select: { id: true },
  });
  if (processing) {
    throw new TranscriptionServiceError(
      "This recording is already being transcribed",
      "TRANSCRIPTION_IN_PROGRESS",
    );
  }

  let prepared: Awaited<ReturnType<typeof prepareAudioForTranscription>>;
  try {
    prepared = await prepareAudioForTranscription({
      sourcePath: resolveRecordingStorageKey(input.mediaAsset.storageKey),
      ffmpegPath: config.ffmpegPath,
      ffprobePath: config.ffprobePath,
      maxAudioBytes: config.maxAudioBytes,
    });
  } catch (error) {
    if (error instanceof AudioPreparationError) {
      throw new TranscriptionServiceError(error.message, error.code);
    }
    throw error;
  }

  const effectiveDurationMs = prepared.sourceDurationMs ?? input.mediaAsset.durationMs ?? 0;
  const measuredMetadata = {
    ...(prepared.sourceDurationMs != null &&
    prepared.sourceDurationMs !== input.mediaAsset.durationMs
      ? { durationMs: prepared.sourceDurationMs }
      : {}),
    ...(prepared.sourceChannelCount != null &&
    prepared.sourceChannelCount !== input.mediaAsset.channelCount
      ? { channelCount: prepared.sourceChannelCount }
      : {}),
  };
  if (Object.keys(measuredMetadata).length > 0) {
    await prisma.mediaAsset.update({
      where: { id: input.mediaAsset.id },
      data: measuredMetadata,
    });
  }

  let attemptNumber = 0;
  try {
    for (const provider of providers) {
      const jobFingerprint = fingerprint(
        input.mediaAsset,
        provider.provider,
        provider.model,
        config.language,
      );
      const claimed = await claimTranscript({
        interactionId: input.interactionId,
        mediaAssetId: input.mediaAsset.id,
        provider: provider.provider,
        model: provider.model,
        jobFingerprint,
      });
      if (claimed.alreadyCompleted) {
        return {
          transcriptId: claimed.transcript.id,
          provider: claimed.transcript.provider,
          status: claimed.transcript.status,
        };
      }

      let providerFailure: ReturnType<typeof errorDetails> | null = null;
      for (const credential of provider.credentials) {
        attemptNumber += 1;
        const attempt = await prisma.transcriptionAttempt.create({
          data: {
            interactionId: input.interactionId,
            mediaAssetId: input.mediaAsset.id,
            transcriptId: claimed.transcript.id,
            provider: provider.provider,
            model: provider.model,
            status: "PROCESSING",
            attemptNumber,
          },
        });

        try {
          const adapter = createAdapter(provider, credential.apiKey, config.timeoutMs);
          const canonical = await adapter.transcribe({
            audioPath: prepared.audioPath,
            language: config.language,
            channelCount: prepared.channelCount,
            durationMs: effectiveDurationMs || undefined,
            requireSpeakerRoles: input.requireDiarization ?? false,
          });
          const segments = normalizedSegments(canonical, effectiveDurationMs);
          const status = transcriptStatus(canonical);
          await prisma.$transaction(async (transaction) => {
            await transaction.transcriptSegment.deleteMany({
              where: { transcriptId: claimed.transcript.id },
            });
            await transaction.transcriptSegment.createMany({
              data: segments.map((segment) => ({
                transcriptId: claimed.transcript.id,
                ordinal: segment.ordinal,
                startMs: segment.startMs,
                endMs: segment.endMs,
                speakerKey: segment.speakerKey,
                speakerRole: segment.speakerRole,
                text: segment.text,
                confidence: segment.confidence,
              })),
            });
            await transaction.transcript.update({
              where: { id: claimed.transcript.id },
              data: {
                provider: canonical.provider,
                model: canonical.model,
                language: canonical.language,
                status,
                fullText: canonical.fullText.trim(),
                isDiarized: canonical.isDiarized,
                speakerCount: canonical.speakerCount,
                errorCode: null,
                errorMessage: null,
                completedAt: new Date(),
              },
            });
            await transaction.transcriptionAttempt.update({
              where: { id: attempt.id },
              data: { status, completedAt: new Date() },
            });
          });
          return { transcriptId: claimed.transcript.id, provider: canonical.provider, status };
        } catch (error) {
          providerFailure = errorDetails(error);
          await prisma.transcriptionAttempt.update({
            where: { id: attempt.id },
            data: {
              status: "FAILED",
              errorCode: providerFailure.code,
              errorMessage: providerFailure.message,
              completedAt: new Date(),
            },
          });
          if (!isRetryableTranscriptionFailure(providerFailure)) break;
        }
      }

      await prisma.transcript.update({
        where: { id: claimed.transcript.id },
        data: {
          status: "FAILED",
          errorCode: providerFailure?.code ?? "PROVIDER_UNAVAILABLE",
          errorMessage: providerFailure?.message ?? "No usable credential was available",
          completedAt: new Date(),
        },
      });
    }
  } finally {
    await prepared.cleanup();
  }

  throw new TranscriptionServiceError(
    "All configured transcription providers failed",
    "PROVIDERS_FAILED",
  );
}
