import "server-only";

import type {
  CanonicalTranscript,
  CanonicalTranscriptSegment,
  TranscriptionAdapter,
} from "./contracts";
import { postAudioTranscription, TranscriptionProviderError } from "./transcription-http";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function milliseconds(value: unknown) {
  // Riva WordInfo numeric offsets are milliseconds. Protobuf duration strings
  // and objects are accepted as well for self-hosted NIM variants.
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const hasSecondsSuffix = /s$/i.test(value);
    const parsed = Number(value.replace(/s$/i, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * (hasSecondsSuffix ? 1000 : 1)) : null;
  }
  const object = record(value);
  if (!object) return null;
  const whole = Number(object.seconds ?? 0);
  const nanos = Number(object.nanos ?? object.nanoseconds ?? 0);
  return Number.isFinite(whole) && Number.isFinite(nanos)
    ? Math.round(whole * 1000 + nanos / 1_000_000)
    : null;
}

function transcriptText(value: UnknownRecord) {
  if (typeof value.text === "string" && value.text.trim()) return value.text.trim();
  const results = Array.isArray(value.results) ? value.results : [];
  return results
    .flatMap((result) => {
      const alternatives = record(result)?.alternatives;
      const first = Array.isArray(alternatives) ? record(alternatives[0]) : null;
      return typeof first?.transcript === "string" ? [first.transcript.trim()] : [];
    })
    .filter(Boolean)
    .join(" ");
}

function transcriptWords(value: UnknownRecord) {
  const directWords = Array.isArray(value.words) ? value.words : [];
  const resultWords = (Array.isArray(value.results) ? value.results : []).flatMap((result) => {
    const alternatives = record(result)?.alternatives;
    const first = Array.isArray(alternatives) ? record(alternatives[0]) : null;
    return Array.isArray(first?.words) ? first.words : [];
  });
  return [...directWords, ...resultWords].flatMap((candidate) => {
    const word = record(candidate);
    const text =
      word && typeof (word.word ?? word.text) === "string"
        ? String(word.word ?? word.text).trim()
        : "";
    if (!word || !text) return [];
    const start = milliseconds(word.start_time ?? word.startTime ?? word.start);
    const end = milliseconds(word.end_time ?? word.endTime ?? word.end);
    if (start === null || end === null) return [];
    return [{ text, startMs: Math.max(0, start), endMs: Math.max(0, end) }];
  });
}

function groupWords(words: ReturnType<typeof transcriptWords>): CanonicalTranscriptSegment[] {
  const segments: CanonicalTranscriptSegment[] = [];
  let current: (typeof words)[number][] = [];

  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      ordinal: segments.length,
      startMs: current[0].startMs,
      endMs: Math.max(current[0].startMs, current.at(-1)?.endMs ?? current[0].endMs),
      speakerKey: null,
      speakerRole: "UNKNOWN",
      text: current.map((word) => word.text).join(" "),
      confidence: null,
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    const elapsed = word.endMs - current[0].startMs;
    if (elapsed >= 10_000 || /[.!?]$/.test(word.text)) flush();
  }
  flush();
  return segments;
}

export function parseNvidiaTranscript(
  value: unknown,
  input: { model: string; language: string | null; durationMs?: number },
): CanonicalTranscript {
  const object = record(value);
  const fullText = object ? transcriptText(object) : typeof value === "string" ? value.trim() : "";
  if (!fullText) {
    throw new TranscriptionProviderError(
      "NVIDIA NIM returned an empty transcript",
      "NVIDIA_NIM",
      "EMPTY_TRANSCRIPT",
    );
  }

  const segments = object ? groupWords(transcriptWords(object)) : [];
  return {
    provider: "NVIDIA_NIM",
    model: input.model,
    language: input.language,
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

function nvidiaLanguage(language: string | undefined) {
  if (!language) return "en-US";
  if (language.includes("-")) return language;
  if (language.toLowerCase() === "es") return "es-US";
  if (language.toLowerCase() === "en") return "en-US";
  return language;
}

export class NvidiaNimTranscriptionAdapter implements TranscriptionAdapter {
  readonly provider = "NVIDIA_NIM" as const;
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
    const language = nvidiaLanguage(input.language);
    const response = await postAudioTranscription({
      provider: this.provider,
      url: this.options.url,
      apiKey: this.options.apiKey,
      audioPath: input.audioPath,
      timeoutMs: this.options.timeoutMs,
      fetchImpl: this.options.fetchImpl,
      fields: {
        language,
        word_time_offsets: "True",
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const value = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    return parseNvidiaTranscript(value, {
      model: this.model,
      language,
      durationMs: input.durationMs,
    });
  }
}
