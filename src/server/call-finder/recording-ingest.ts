import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { copyFile, link, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { InteractionProvider } from "@prisma/client";
import { probeAudioMetadata } from "@/server/call-finder/audio-metadata";
import { prepareAudioForPlayback } from "@/server/call-finder/audio-preparation";
import {
  getRecordingStorageRoot,
  isAllowedAudioMimeType,
  resolveRecordingStorageKey,
} from "@/server/call-finder/storage";

const DEFAULT_MAX_RECORDING_BYTES = 250 * 1024 * 1024;

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/flac": ".flac",
  "audio/m4a": ".m4a",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/x-m4a": ".m4a",
  "audio/x-wav": ".wav",
  "video/mp4": ".mp4",
};

export class RecordingIngestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "RecordingIngestError";
  }
}

export type StoredRecording = {
  storageKey: string;
  originalFileName: string | null;
  mimeType: string;
  byteSize: bigint;
  sha256: string;
  durationMs: number | null;
  channelCount: number | null;
};

function configuredMaxBytes() {
  const parsed = Number(process.env.MAX_RECORDING_BYTES ?? DEFAULT_MAX_RECORDING_BYTES);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RECORDING_BYTES;
}

function normalizeInstanceKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  return normalized.slice(0, 80) || "default";
}

function responseFileName(response: Response) {
  const disposition = response.headers.get("content-disposition");
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = disposition?.match(/filename="([^"]+)"/i)?.[1];
  const plain = disposition?.match(/filename=([^;]+)/i)?.[1];
  const candidate = encoded ? decodeURIComponent(encoded) : (quoted ?? plain)?.trim();
  return candidate
    ? path
        .basename(candidate)
        .replace(/[\r\n"\\]/g, "_")
        .slice(0, 160)
    : null;
}

function responseMimeType(response: Response) {
  return (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

async function removeIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function fileDigest(filePath: string) {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteSize += bytes.length;
    hash.update(bytes);
  }
  return { byteSize, sha256: hash.digest("hex") };
}

export async function persistPlaybackRecording(input: {
  sourceStorageKey: string;
  provider: InteractionProvider;
  providerInstance: string;
  interactionId: string;
  startedAt: Date;
}): Promise<StoredRecording> {
  const root = getRecordingStorageRoot();
  const sourcePath = resolveRecordingStorageKey(input.sourceStorageKey, root);
  const maximumBytes = configuredMaxBytes();
  const prepared = await prepareAudioForPlayback({
    sourcePath,
    ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
    maxAudioBytes: maximumBytes,
  });

  try {
    const digest = await fileDigest(prepared.audioPath);
    if (digest.byteSize <= 0 || digest.byteSize > maximumBytes) {
      throw new RecordingIngestError(
        "Browser-compatible recording exceeds the configured size limit",
        "FILE_TOO_LARGE",
      );
    }
    const year = String(input.startedAt.getUTCFullYear());
    const month = String(input.startedAt.getUTCMonth() + 1).padStart(2, "0");
    const storageKey = path.posix.join(
      input.provider.toLowerCase(),
      normalizeInstanceKey(input.providerInstance),
      year,
      month,
      `${input.interactionId}-${digest.sha256.slice(0, 16)}-playback.wav`,
    );
    const destination = resolveRecordingStorageKey(storageKey, root);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await copyFile(prepared.audioPath, destination, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await stat(destination);
      if (!existing.isFile() || existing.size !== digest.byteSize) {
        throw new RecordingIngestError(
          "Stored playback recording conflicts with an existing file",
          "STORAGE_CONFLICT",
        );
      }
    }

    return {
      storageKey,
      originalFileName: `playback-${input.interactionId}.wav`,
      mimeType: "audio/wav",
      byteSize: BigInt(digest.byteSize),
      sha256: digest.sha256,
      durationMs: prepared.durationMs,
      channelCount: prepared.channelCount,
    };
  } finally {
    await prepared.cleanup();
  }
}

export async function persistRecordingResponse(input: {
  response: Response;
  provider: InteractionProvider;
  providerInstance: string;
  interactionId: string;
  startedAt: Date;
}): Promise<StoredRecording> {
  if (!input.response.ok || !input.response.body) {
    throw new RecordingIngestError(
      `Recording provider returned HTTP ${input.response.status}`,
      "PROVIDER_RESPONSE",
    );
  }

  const mimeType = responseMimeType(input.response);
  if (!isAllowedAudioMimeType(mimeType)) {
    throw new RecordingIngestError("Recording MIME type is not allowed", "UNSUPPORTED_MEDIA");
  }

  const maximumBytes = configuredMaxBytes();
  const declaredLength = Number(input.response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RecordingIngestError("Recording exceeds the configured size limit", "FILE_TOO_LARGE");
  }

  const root = getRecordingStorageRoot();
  const stagingDirectory = path.join(root, ".staging");
  await mkdir(stagingDirectory, { recursive: true });
  const stagingFile = path.join(stagingDirectory, `${randomUUID()}.part`);
  const hash = createHash("sha256");
  let byteSize = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > maximumBytes) {
        callback(
          new RecordingIngestError("Recording exceeds the configured size limit", "FILE_TOO_LARGE"),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(input.response.body as import("node:stream/web").ReadableStream),
      meter,
      createWriteStream(stagingFile, { flags: "wx" }),
    );

    if (byteSize === 0) {
      throw new RecordingIngestError("Recording response was empty", "EMPTY_RECORDING");
    }

    const sha256 = hash.digest("hex");
    const year = String(input.startedAt.getUTCFullYear());
    const month = String(input.startedAt.getUTCMonth() + 1).padStart(2, "0");
    const extension = AUDIO_EXTENSIONS[mimeType] ?? ".audio";
    const storageKey = path.posix.join(
      input.provider.toLowerCase(),
      normalizeInstanceKey(input.providerInstance),
      year,
      month,
      `${input.interactionId}-${sha256.slice(0, 16)}${extension}`,
    );
    const destination = resolveRecordingStorageKey(storageKey, root);
    await mkdir(path.dirname(destination), { recursive: true });

    try {
      await link(stagingFile, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await stat(destination);
      if (!existing.isFile() || existing.size !== byteSize) {
        throw new RecordingIngestError(
          "Stored recording conflicts with an existing file",
          "STORAGE_CONFLICT",
        );
      }
    }

    const metadata = await probeAudioMetadata({
      sourcePath: destination,
      ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
    }).catch(() => ({ durationMs: null, channelCount: null }));

    return {
      storageKey,
      originalFileName: responseFileName(input.response),
      mimeType,
      byteSize: BigInt(byteSize),
      sha256,
      durationMs: metadata.durationMs,
      channelCount: metadata.channelCount,
    };
  } finally {
    await removeIfPresent(stagingFile);
  }
}
