import type { TranscriptProvider } from "@prisma/client";

export type TranscriptionCandidate = {
  provider: TranscriptProvider;
  model: string;
  priority: number;
  enabled: boolean;
  nativeDiarization: boolean;
  separatedChannelTranscription: boolean;
};

export function buildTranscriptionFailoverPlan(
  candidates: readonly TranscriptionCandidate[],
  input: { channelCount: number; requireSpeakerRoles: boolean },
) {
  return candidates
    .filter((candidate) => {
      if (!candidate.enabled) return false;
      if (!input.requireSpeakerRoles) return true;
      if (candidate.nativeDiarization) return true;
      return input.channelCount >= 2 && candidate.separatedChannelTranscription;
    })
    .sort((left, right) => left.priority - right.priority)
    .map((candidate) => ({
      ...candidate,
      strategy: candidate.nativeDiarization ? "DIARIZE" : "SPLIT_CHANNELS",
    }));
}

export function isRetryableTranscriptionFailure(input: { httpStatus?: number; code?: string }) {
  // A second key can still be valid when the primary key was revoked, expired,
  // or belongs to a project without model access.
  if (
    input.httpStatus === 401 ||
    input.httpStatus === 403 ||
    input.httpStatus === 408 ||
    input.httpStatus === 409 ||
    input.httpStatus === 429
  )
    return true;
  if (input.httpStatus !== undefined && input.httpStatus >= 500) return true;
  return ["ECONNRESET", "ETIMEDOUT", "NETWORK_ERROR", "PROVIDER_UNAVAILABLE"].includes(
    input.code ?? "",
  );
}
