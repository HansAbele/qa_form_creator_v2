import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, reportOperationalErrorMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  reportOperationalErrorMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/observability", () => ({
  reportOperationalError: reportOperationalErrorMock,
}));

import { POST } from "./route";

function makeRequest(body: unknown, origin = "https://qore.example") {
  return new NextRequest("https://qore.example/api/observability/client-error", {
    method: "POST",
    headers: {
      host: "qore.example",
      origin,
      "content-type": "application/json",
      "user-agent": "Qore test browser",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/observability/client-error", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_URL", "https://qore.example");
    authMock.mockReset();
    reportOperationalErrorMock.mockReset();
    authMock.mockResolvedValue({ user: { id: `user-${crypto.randomUUID()}` } });
    reportOperationalErrorMock.mockResolvedValue("event-1");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects cross-origin and unauthenticated reports", async () => {
    const crossOrigin = await POST(makeRequest({ message: "failure" }, "https://attacker.example"));
    expect(crossOrigin.status).toBe(403);
    expect(authMock).not.toHaveBeenCalled();

    authMock.mockResolvedValue(null);
    const unauthenticated = await POST(makeRequest({ message: "failure" }));
    expect(unauthenticated.status).toBe(401);
    expect(reportOperationalErrorMock).not.toHaveBeenCalled();
  });

  it("validates the minimal event contract", async () => {
    const response = await POST(makeRequest({ source: "client-runtime" }));

    expect(response.status).toBe(400);
    expect(reportOperationalErrorMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body without relying on Content-Length", async () => {
    const response = await POST(makeRequest({ message: "x".repeat(9_000) }));

    expect(response.status).toBe(413);
    expect(reportOperationalErrorMock).not.toHaveBeenCalled();
  });

  it("attaches the authenticated user and ignores an untrusted source", async () => {
    authMock.mockResolvedValue({ user: { id: "user-safe" } });
    const response = await POST(
      makeRequest({
        source: "server-admin",
        name: "TypeError",
        message: "client failed",
        path: "/reports?token=secret",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true, eventId: "event-1" });
    expect(reportOperationalErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "client-runtime",
        userId: "user-safe",
        message: "client failed",
        path: "/reports?token=secret",
      }),
    );
  });

  it("limits authenticated client-error bursts per user", async () => {
    authMock.mockResolvedValue({ user: { id: `burst-${crypto.randomUUID()}` } });
    for (let index = 0; index < 12; index += 1) {
      const accepted = await POST(makeRequest({ message: `failure-${index}` }));
      expect(accepted.status).toBe(202);
    }

    const limited = await POST(makeRequest({ message: "failure-over-limit" }));
    expect(limited.status).toBe(429);
    expect(reportOperationalErrorMock).toHaveBeenCalledTimes(12);
  });
});
