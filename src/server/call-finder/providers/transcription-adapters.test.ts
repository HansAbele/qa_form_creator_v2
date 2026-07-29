import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseDeepgramTranscript } from "./deepgram-transcription-adapter";
import { parseGroqTranscript } from "./groq-transcription-adapter";
import { parseNvidiaTranscript } from "./nvidia-nim-transcription-adapter";

describe("transcription adapter normalization", () => {
  it("should normalize Deepgram utterances with speaker labels", () => {
    const transcript = parseDeepgramTranscript(
      {
        results: {
          channels: [{ alternatives: [{ transcript: "Hello. Hi there." }] }],
          utterances: [
            { start: 0.2, end: 1.1, transcript: "Hello.", speaker: 0, confidence: 0.94 },
            { start: 1.4, end: 2.3, transcript: "Hi there.", speaker: 1, confidence: 0.91 },
          ],
        },
      },
      { model: "nova-3", language: "en", durationMs: 3_000 },
    );

    expect(transcript).toMatchObject({
      provider: "DEEPGRAM",
      isDiarized: true,
      speakerCount: 2,
    });
    expect(transcript.segments.map((segment) => segment.speakerKey)).toEqual(["1", "2"]);
    expect(transcript.segments.every((segment) => segment.speakerRole === "UNKNOWN")).toBe(true);
  });

  it("should retain Groq segment timestamps and confidence", () => {
    const transcript = parseGroqTranscript(
      {
        text: "Hello there.",
        language: "en",
        segments: [{ start: 1.25, end: 2.75, text: " Hello there. ", avg_logprob: -0.1 }],
      },
      { model: "whisper-large-v3", language: "en", durationMs: 4_000 },
    );

    expect(transcript.segments[0]).toMatchObject({
      startMs: 1250,
      endMs: 2750,
      speakerRole: "UNKNOWN",
      text: "Hello there.",
    });
    expect(transcript.segments[0].confidence).toBeCloseTo(Math.exp(-0.1));
  });

  it("should normalize NVIDIA word offsets into readable segments", () => {
    const transcript = parseNvidiaTranscript(
      {
        text: "Thank you. How can I help?",
        words: [
          { word: "Thank", start_time: 0, end_time: 200 },
          { word: "you.", start_time: 200, end_time: 500 },
          { word: "How", start_time: 800, end_time: 1000 },
          { word: "can", start_time: 1000, end_time: 1200 },
          { word: "I", start_time: 1200, end_time: 1300 },
          { word: "help?", start_time: 1300, end_time: 1700 },
        ],
      },
      { model: "parakeet-ctc-1.1b-asr", language: "en-US", durationMs: 2_000 },
    );

    expect(transcript.segments).toHaveLength(2);
    expect(transcript.segments.map((segment) => segment.text)).toEqual([
      "Thank you.",
      "How can I help?",
    ]);
    expect(transcript.isDiarized).toBe(false);
  });
});
