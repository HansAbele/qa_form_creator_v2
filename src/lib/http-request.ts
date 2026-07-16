export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Reads a JSON body with a hard byte budget. Content-Length is only an early
 * rejection hint; the stream counter remains authoritative for HTTP/2,
 * chunked requests, and omitted or forged metadata.
 */
export async function readJsonBodyWithinLimit(request: Request, maxBytes: number) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) return JSON.parse("") as unknown;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new SyntaxError("Request body must contain valid UTF-8 JSON.");
  }
  return JSON.parse(text) as unknown;
}

/**
 * In production AUTH_URL is the canonical public origin and does not depend
 * on client-supplied forwarding headers. Local/test environments fall back to
 * the request URL so alternate E2E ports continue to work.
 */
export function isCanonicalSameOrigin(request: Request) {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;

  try {
    const expectedOrigin = process.env.AUTH_URL
      ? new URL(process.env.AUTH_URL).origin
      : new URL(request.url).origin;
    return new URL(suppliedOrigin).origin === expectedOrigin;
  } catch {
    return false;
  }
}
