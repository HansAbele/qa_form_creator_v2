import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeAudioMetadata } from "./audio-metadata";

const MAX_FFMPEG_ERROR_LENGTH = 1200;
const DEFAULT_PREPARATION_TIMEOUT_MS = 5 * 60 * 1000;

export class AudioPreparationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AUDIO_PREPROCESSING_UNAVAILABLE"
      | "AUDIO_PREPROCESSING_FAILED"
      | "AUDIO_TOO_LARGE",
  ) {
    super(message);
    this.name = "AudioPreparationError";
  }
}

function runFfmpeg(executable: string, args: string[], timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(
          new AudioPreparationError("Audio preprocessing timed out", "AUDIO_PREPROCESSING_FAILED"),
        );
      }
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_FFMPEG_ERROR_LENGTH) stderr += chunk.toString("utf8");
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(
        new AudioPreparationError(
          error.code === "ENOENT" ? "FFmpeg is not installed" : "Audio preprocessing failed",
          error.code === "ENOENT"
            ? "AUDIO_PREPROCESSING_UNAVAILABLE"
            : "AUDIO_PREPROCESSING_FAILED",
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new AudioPreparationError(
          stderr.trim().slice(0, MAX_FFMPEG_ERROR_LENGTH) || "Audio preprocessing failed",
          "AUDIO_PREPROCESSING_FAILED",
        ),
      );
    });
  });
}

export type PreparedAudio = {
  audioPath: string;
  byteSize: number;
  channelCount: 1;
  sourceDurationMs: number | null;
  sourceChannelCount: number | null;
  cleanup: () => Promise<void>;
};

export async function prepareAudioForTranscription(input: {
  sourcePath: string;
  ffmpegPath: string;
  ffprobePath?: string;
  maxAudioBytes: number;
  timeoutMs?: number;
}): Promise<PreparedAudio> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qore-transcription-"));
  const audioPath = path.join(directory, "audio.flac");
  const cleanup = () => rm(directory, { recursive: true, force: true });

  try {
    const sourceMetadata = await probeAudioMetadata({
      sourcePath: input.sourcePath,
      ffprobePath: input.ffprobePath,
    }).catch(() => ({ durationMs: null, channelCount: null }));
    await runFfmpeg(
      input.ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        input.sourcePath,
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "flac",
        audioPath,
      ],
      input.timeoutMs ?? DEFAULT_PREPARATION_TIMEOUT_MS,
    );
    const output = await stat(audioPath);
    if (!output.isFile() || output.size <= 0) {
      throw new AudioPreparationError(
        "Audio preprocessing produced an empty file",
        "AUDIO_PREPROCESSING_FAILED",
      );
    }
    if (output.size > input.maxAudioBytes) {
      throw new AudioPreparationError(
        "The normalized audio exceeds the provider upload limit",
        "AUDIO_TOO_LARGE",
      );
    }
    return {
      audioPath,
      byteSize: output.size,
      channelCount: 1,
      sourceDurationMs: sourceMetadata.durationMs,
      sourceChannelCount: sourceMetadata.channelCount,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
