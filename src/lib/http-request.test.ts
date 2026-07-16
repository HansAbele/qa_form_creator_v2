import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCanonicalSameOrigin,
  readJsonBodyWithinLimit,
  RequestBodyTooLargeError,
} from "./http-request";

describe("bounded HTTP requests", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("parses a JSON stream below the byte budget", async () => {
    const request = new Request("https://qore.example/api", {
      method: "POST",
      body: JSON.stringify({ value: "ok" }),
    });

    await expect(readJsonBodyWithinLimit(request, 64)).resolves.toEqual({ value: "ok" });
  });

  it("rejects streamed bytes even when Content-Length is omitted", async () => {
    const encoder = new TextEncoder();
    const request = new Request("https://qore.example/api", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"value":"'));
          controller.enqueue(encoder.encode("x".repeat(80)));
          controller.enqueue(encoder.encode('"}'));
          controller.close();
        },
      }),
      // Required by Node's Request implementation for a streaming body.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readJsonBodyWithinLimit(request, 32)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it("uses AUTH_URL instead of spoofable forwarding headers", () => {
    vi.stubEnv("AUTH_URL", "https://qore.example");
    const trusted = new Request("http://internal:3000/api", {
      headers: { origin: "https://qore.example", "x-forwarded-host": "attacker.example" },
    });
    const attacker = new Request("http://internal:3000/api", {
      headers: { origin: "https://attacker.example", "x-forwarded-host": "qore.example" },
    });

    expect(isCanonicalSameOrigin(trusted)).toBe(true);
    expect(isCanonicalSameOrigin(attacker)).toBe(false);
  });
});
