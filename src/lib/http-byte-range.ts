export type ResolvedByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/** Resolve one RFC 7233 byte range. Multipart ranges are intentionally rejected. */
export function resolveByteRange(
  rangeHeader: string | null,
  totalBytes: number,
): ResolvedByteRange {
  if (!rangeHeader) return { kind: "full" };
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return { kind: "unsatisfiable" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) return { kind: "unsatisfiable" };

  const startText = match[1];
  const endText = match[2];

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: "unsatisfiable" };
    }
    const start = Math.max(0, totalBytes - suffixLength);
    return { kind: "partial", start, end: totalBytes - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : totalBytes - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= totalBytes ||
    requestedEnd < start
  ) {
    return { kind: "unsatisfiable" };
  }

  return { kind: "partial", start, end: Math.min(requestedEnd, totalBytes - 1) };
}
