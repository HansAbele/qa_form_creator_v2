import "server-only";

import type { CanonicalTranscript, TranscriptionAdapter } from "./contracts";
import { postAudioTranscription, TranscriptionProviderError } from "./transcription-http";

type GroqSegment = {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  avg_logprob?: unknown;
};

type GroqResponse = {
  text?: unknown;
  language?: unknown;
  segments?: unknown;
};

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseGroqTranscript(
  value: GroqResponse,
  input: { model: string; language: string | null; durationMs?: number },
): CanonicalTranscript {
  const fullText = typeof value.text === "string" ? value.text.trim() : "";
  if (!fullText) {
    throw new TranscriptionProviderError(
      "Groq returned an empty transcript",
      "GROQ",
      "EMPTY_TRANSCRIPT",
    );
  }

  const sourceSegments = Array.isArray(value.segments) ? (value.segments as GroqSegment[]) : [];
  const segments = sourceSegments.flatMap((segment, ordinal) => {
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (!text) return [];
    const startMs = Math.max(0, Math.round(finiteNumber(segment.start, 0) * 1000));
    const endMs = Math.max(startMs, Math.round(finiteNumber(segment.end, startMs / 1000) * 1000));
    const averageLogProbability = finiteNumber(segment.avg_logprob, Number.NaN);
    const confidence = Number.isFinite(averageLogProbability)
      ? Math.min(1, Math.max(0, Math.exp(averageLogProbability)))
      : null;
    return [
      {
        ordinal,
        startMs,
        endMs,
        speakerKey: null,
        speakerRole: "UNKNOWN" as const,
        text,
        confidence,
      },
    ];
  });

  return {
    provider: "GROQ",
    model: input.model,
    language: typeof value.language === "string" ? value.language : input.language,
    isDiarized: false,
    speakerCount: null,
    fullText,
    segments:
      segments.length > 0
        ? segments
        : [
            {
              ordinal: 0,
              startMs: 0,
              endMs: Math.max(0, input.durationMs ?? 0),
              speakerKey: null,
              speakerRole: "UNKNOWN",
              text: fullText,
              confidence: null,
            },
          ],
  };
}

export class GroqTranscriptionAdapter implements TranscriptionAdapter {
  readonly provider = "GROQ" as const;
  readonly capabilities = {
    nativeDiarization: false,
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
    const response = await postAudioTranscription({
      provider: this.provider,
      url: this.options.url,
      apiKey: this.options.apiKey,
      audioPath: input.audioPath,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
      fields: {
        model: this.model,
        response_format: "verbose_json",
        "timestamp_granularities[]": "segment",
        temperature: "0",
        ...(input.language ? { language: input.language.split("-", 1)[0] } : {}),
      },
    });
    const value = (await response.json()) as GroqResponse;
    return parseGroqTranscript(value, {
      model: this.model,
      language: input.language ?? null,
      durationMs: input.durationMs,
    });
  }
}
