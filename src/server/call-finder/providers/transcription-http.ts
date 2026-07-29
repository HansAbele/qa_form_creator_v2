import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TranscriptProvider } from "@prisma/client";

const MAX_ERROR_BODY_LENGTH = 800;

export class TranscriptionProviderError extends Error {
  constructor(
    message: string,
    readonly provider: TranscriptProvider,
    readonly code: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "TranscriptionProviderError";
  }
}

function safeProviderMessage(value: string) {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/(api[-_ ]?key|token|secret)(\s*[=:]\s*)[^\s,"'}]+/gi, "$1$2[REDACTED]")
    .slice(0, MAX_ERROR_BODY_LENGTH);
}

async function errorMessage(response: Response) {
  const body = safeProviderMessage(await response.text());
  if (!body) return `Provider returned HTTP ${response.status}`;

  try {
    const parsed = JSON.parse(body) as {
      detail?: unknown;
      message?: unknown;
      error?: { message?: unknown } | string;
    };
    const candidate =
      typeof parsed.detail === "string"
        ? parsed.detail
        : typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
            ? parsed.error
            : typeof parsed.error?.message === "string"
              ? parsed.error.message
              : body;
    return safeProviderMessage(candidate);
  } catch {
    return body;
  }
}

export async function postAudioTranscription(input: {
  provider: TranscriptProvider;
  url: string;
  apiKey: string;
  audioPath: string;
  fields: Record<string, string>;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}) {
  const audio = await readFile(input.audioPath);
  const body = new FormData();
  body.append("file", new Blob([audio], { type: "audio/flac" }), path.basename(input.audioPath));
  for (const [name, value] of Object.entries(input.fields)) body.append(name, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new TranscriptionProviderError(
        await errorMessage(response),
        input.provider,
        `HTTP_${response.status}`,
        response.status,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof TranscriptionProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new TranscriptionProviderError(
        "The transcription request timed out",
        input.provider,
        "ETIMEDOUT",
      );
    }
    throw new TranscriptionProviderError(
      "The transcription provider could not be reached",
      input.provider,
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function postBinaryAudioTranscription(input: {
  provider: TranscriptProvider;
  url: string;
  apiKey: string;
  audioPath: string;
  query: Record<string, string>;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}) {
  const audio = await readFile(input.audioPath);
  const url = new URL(input.url);
  for (const [name, value] of Object.entries(input.query)) url.searchParams.set(name, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${input.apiKey}`,
        "Content-Type": "audio/flac",
      },
      body: new Blob([audio], { type: "audio/flac" }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new TranscriptionProviderError(
        await errorMessage(response),
        input.provider,
        `HTTP_${response.status}`,
        response.status,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof TranscriptionProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new TranscriptionProviderError(
        "The transcription request timed out",
        input.provider,
        "ETIMEDOUT",
      );
    }
    throw new TranscriptionProviderError(
      "The transcription provider could not be reached",
      input.provider,
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }
}
