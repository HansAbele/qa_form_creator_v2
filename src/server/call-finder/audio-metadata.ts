import "server-only";

import { spawn } from "node:child_process";

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;

export type AudioMetadata = {
  durationMs: number | null;
  channelCount: number | null;
};

export class AudioMetadataError extends Error {
  constructor(
    message: string,
    readonly code: "AUDIO_PROBE_UNAVAILABLE" | "AUDIO_PROBE_FAILED",
  ) {
    super(message);
    this.name = "AudioMetadataError";
  }
}

type ProbePayload = {
  streams?: Array<{ channels?: number; duration?: string }>;
  format?: { duration?: string };
};

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function durationMilliseconds(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const milliseconds = Math.round(seconds * 1_000);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

export function parseAudioMetadata(value: unknown): AudioMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { durationMs: null, channelCount: null };
  }
  const payload = value as ProbePayload;
  const stream = payload.streams?.[0];
  return {
    durationMs: durationMilliseconds(stream?.duration ?? payload.format?.duration),
    channelCount: positiveInteger(stream?.channels),
  };
}

function runFfprobe(executable: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (settled) return;
      settled = true;
      reject(new AudioMetadataError("Audio metadata probe timed out", "AUDIO_PROBE_FAILED"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_PROBE_OUTPUT_BYTES) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_PROBE_OUTPUT_BYTES) stderr += chunk.toString("utf8");
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(
        new AudioMetadataError(
          error.code === "ENOENT" ? "FFprobe is not installed" : "Audio metadata probe failed",
          error.code === "ENOENT" ? "AUDIO_PROBE_UNAVAILABLE" : "AUDIO_PROBE_FAILED",
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(
          new AudioMetadataError(
            stderr.trim().slice(0, 1_000) || "Audio metadata probe failed",
            "AUDIO_PROBE_FAILED",
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

export async function probeAudioMetadata(input: {
  sourcePath: string;
  ffprobePath?: string;
  timeoutMs?: number;
}): Promise<AudioMetadata> {
  const stdout = await runFfprobe(
    input.ffprobePath ?? "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=channels,duration:format=duration",
      "-of",
      "json",
      input.sourcePath,
    ],
    input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
  );
  try {
    return parseAudioMetadata(JSON.parse(stdout));
  } catch {
    throw new AudioMetadataError("FFprobe returned invalid JSON", "AUDIO_PROBE_FAILED");
  }
}
