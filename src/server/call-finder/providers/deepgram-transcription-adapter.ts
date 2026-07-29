import "server-only";

import type {
  CanonicalTranscript,
  CanonicalTranscriptSegment,
  TranscriptionAdapter,
} from "./contracts";
import { postBinaryAudioTranscription, TranscriptionProviderError } from "./transcription-http";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function speakerKey(value: unknown) {
  const speaker = finiteNumber(value);
  return speaker !== null && Number.isInteger(speaker) && speaker >= 0 ? String(speaker + 1) : null;
}

function secondsToMilliseconds(value: unknown, fallback = 0) {
  return Math.max(0, Math.round((finiteNumber(value) ?? fallback) * 1_000));
}

function deepgramResults(value: unknown) {
  const root = record(value);
  const results = record(root?.results);
  const channel = Array.isArray(results?.channels) ? record(results.channels[0]) : null;
  const alternative = Array.isArray(channel?.alternatives) ? record(channel.alternatives[0]) : null;
  return { root, results, alternative };
}

function utteranceSegments(results: UnknownRecord | null): CanonicalTranscriptSegment[] {
  const utterances = Array.isArray(results?.utterances) ? results.utterances : [];
  return utterances.flatMap((candidate, ordinal) => {
    const utterance = record(candidate);
    const text = typeof utterance?.transcript === "string" ? utterance.transcript.trim() : "";
    if (!utterance || !text) return [];
    const startMs = secondsToMilliseconds(utterance.start);
    const endMs = Math.max(startMs, secondsToMilliseconds(utterance.end, startMs / 1_000));
    const confidence = finiteNumber(utterance.confidence);
    return [
      {
        ordinal,
        startMs,
        endMs,
        speakerKey: speakerKey(utterance.speaker),
        speakerRole: "UNKNOWN" as const,
        text,
        confidence: confidence === null ? null : Math.min(1, Math.max(0, confidence)),
      },
    ];
  });
}

type ParsedWord = {
  text: string;
  startMs: number;
  endMs: number;
  speakerKey: string | null;
  confidence: number | null;
};

function transcriptWords(alternative: UnknownRecord | null): ParsedWord[] {
  const words = Array.isArray(alternative?.words) ? alternative.words : [];
  return words.flatMap((candidate) => {
    const word = record(candidate);
    const textValue = word?.punctuated_word ?? word?.word;
    const text = typeof textValue === "string" ? textValue.trim() : "";
    if (!word || !text) return [];
    const startMs = secondsToMilliseconds(word.start);
    const endMs = Math.max(startMs, secondsToMilliseconds(word.end, startMs / 1_000));
    const confidence = finiteNumber(word.confidence);
    return [
      {
        text,
        startMs,
        endMs,
        speakerKey: speakerKey(word.speaker),
        confidence: confidence === null ? null : Math.min(1, Math.max(0, confidence)),
      },
    ];
  });
}

function groupedWordSegments(words: ParsedWord[]): CanonicalTranscriptSegment[] {
  const segments: CanonicalTranscriptSegment[] = [];
  let current: ParsedWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const confidences = current.flatMap((word) =>
      word.confidence === null ? [] : [word.confidence],
    );
    segments.push({
      ordinal: segments.length,
      startMs: current[0].startMs,
      endMs: current.at(-1)?.endMs ?? current[0].endMs,
      speakerKey: current[0].speakerKey,
      speakerRole: "UNKNOWN",
      text: current.map((word) => word.text).join(" "),
      confidence:
        confidences.length > 0
          ? confidences.reduce((total, confidence) => total + confidence, 0) / confidences.length
          : null,
    });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0 && word.speakerKey !== current[0].speakerKey) flush();
    current.push(word);
    if (word.endMs - current[0].startMs >= 10_000 || /[.!?]$/.test(word.text)) flush();
  }
  flush();
  return segments;
}

export function parseDeepgramTranscript(
  value: unknown,
  input: { model: string; language: string | null; durationMs?: number },
): CanonicalTranscript {
  const { results, alternative } = deepgramResults(value);
  const alternativeText =
    typeof alternative?.transcript === "string" ? alternative.transcript.trim() : "";
  const fromUtterances = utteranceSegments(results);
  const segments =
    fromUtterances.length > 0 ? fromUtterances : groupedWordSegments(transcriptWords(alternative));
  const fullText =
    alternativeText ||
    segments
      .map((segment) => segment.text)
      .join(" ")
      .trim();
  if (!fullText) {
    throw new TranscriptionProviderError(
      "Deepgram returned an empty transcript",
      "DEEPGRAM",
      "EMPTY_TRANSCRIPT",
    );
  }

  const normalizedSegments =
    segments.length > 0
      ? segments
      : [
          {
            ordinal: 0,
            startMs: 0,
            endMs: Math.max(0, input.durationMs ?? 0),
            speakerKey: null,
            speakerRole: "UNKNOWN" as const,
            text: fullText,
            confidence: null,
          },
        ];
  const speakers = new Set(
    normalizedSegments.flatMap((segment) =>
      segment.speakerKey === null ? [] : [segment.speakerKey],
    ),
  );
  const isDiarized = speakers.size > 0 && normalizedSegments.every((segment) => segment.speakerKey);

  return {
    provider: "DEEPGRAM",
    model: input.model,
    language: input.language,
    isDiarized,
    speakerCount: isDiarized ? speakers.size : null,
    fullText,
    segments: normalizedSegments,
  };
}

export class DeepgramTranscriptionAdapter implements TranscriptionAdapter {
  readonly provider = "DEEPGRAM" as const;
  readonly capabilities = {
    nativeDiarization: true,
    separatedChannelTranscription: false,
  } as const;

  constructor(
    readonly model: string,
    private readonly options: {
      apiKey: string;
      url: string;
      timeoutMs: number;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async transcribe(input: Parameters<TranscriptionAdapter["transcribe"]>[0]) {
    const language = input.language?.split("-", 1)[0] || "en";
    const response = await postBinaryAudioTranscription({
      provider: this.provider,
      url: this.options.url,
      apiKey: this.options.apiKey,
      audioPath: input.audioPath,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
      query: {
        model: this.model,
        language,
        smart_format: "true",
        punctuate: "true",
        utterances: "true",
        diarize_model: "latest",
      },
    });
    return parseDeepgramTranscript(await response.json(), {
      model: this.model,
      language,
      durationMs: input.durationMs,
    });
  }
}
