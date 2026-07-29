import path from "node:path";

export const DEFAULT_RECORDING_STORAGE_ROOT = "storage/recordings";

export function getRecordingStorageRoot() {
  return path.resolve(
    /* turbopackIgnore: true */
    process.env.RECORDING_STORAGE_ROOT ?? DEFAULT_RECORDING_STORAGE_ROOT,
  );
}

/** Resolve an opaque database key without allowing absolute paths or traversal. */
export function resolveRecordingStorageKey(storageKey: string, root = getRecordingStorageRoot()) {
  const normalizedKey = storageKey.trim();
  if (!normalizedKey || path.isAbsolute(normalizedKey) || normalizedKey.includes("\0")) {
    throw new Error("Invalid recording storage key");
  }

  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, normalizedKey);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid recording storage key");
  }

  return resolvedFile;
}

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
  "video/mp4",
]);

export function isAllowedAudioMimeType(value: string) {
  return ALLOWED_AUDIO_MIME_TYPES.has(value.trim().toLowerCase());
}

export function safeAudioMimeType(value: string) {
  const normalized = value.trim().toLowerCase();
  return ALLOWED_AUDIO_MIME_TYPES.has(normalized) ? normalized : "application/octet-stream";
}
