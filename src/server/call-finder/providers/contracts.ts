import type { InteractionDirection, InteractionProvider, TranscriptProvider } from "@prisma/client";

export type ProviderCallSearch = {
  externalCampaignIds: string[];
  providerAgentIds?: string[];
  startedFrom: Date;
  startedTo: Date;
  direction?: InteractionDirection;
  phoneNumber?: string;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  cursor?: string;
};

export type NormalizedProviderCall = {
  provider: InteractionProvider;
  providerInstance: string;
  providerInteractionId: string;
  providerRecordingId?: string | null;
  providerCampaignId: string | null;
  providerAgentId: string | null;
  providerAgentName: string | null;
  dispositionCode: string | null;
  direction: InteractionDirection;
  phoneNumber: string | null;
  queueName: string | null;
  status: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSeconds: number;
  hasRecording: boolean;
  metadata?: Record<string, unknown>;
};

export type ProviderCallPage = {
  calls: NormalizedProviderCall[];
  nextCursor: string | null;
};

export type ProviderRecordingLocator = {
  providerInteractionId: string;
  providerRecordingId?: string | null;
};

export interface CallSourceAdapter {
  readonly provider: InteractionProvider;
  searchCalls(input: ProviderCallSearch): Promise<ProviderCallPage>;
  fetchRecording(locator: ProviderRecordingLocator): Promise<Response>;
  fetchNativeTranscript?(providerInteractionId: string): Promise<CanonicalTranscript | null>;
}

export type CanonicalTranscriptSegment = {
  ordinal: number;
  startMs: number;
  endMs: number;
  speakerKey: string | null;
  speakerRole: "AGENT" | "CUSTOMER" | "UNKNOWN";
  text: string;
  confidence: number | null;
};

export type CanonicalTranscript = {
  provider: TranscriptProvider;
  model: string;
  language: string | null;
  isDiarized: boolean;
  speakerCount: number | null;
  fullText: string;
  segments: CanonicalTranscriptSegment[];
};

export type TranscriptionInput = {
  audioPath: string;
  language?: string;
  channelCount: number;
  durationMs?: number;
  requireSpeakerRoles: boolean;
};

export interface TranscriptionAdapter {
  readonly provider: TranscriptProvider;
  readonly model: string;
  readonly capabilities: {
    nativeDiarization: boolean;
    separatedChannelTranscription: boolean;
  };
  transcribe(input: TranscriptionInput): Promise<CanonicalTranscript>;
}
