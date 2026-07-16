import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loggerErrorMock, loggerWarnMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: loggerErrorMock,
    warn: loggerWarnMock,
  },
}));

import {
  normalizeOperationalError,
  reportOperationalError,
  sanitizeObservabilityText,
} from "./observability";

describe("observability", () => {
  const originalWebhookUrl = process.env.ERROR_REPORTING_WEBHOOK_URL;
  const originalWebhookToken = process.env.ERROR_REPORTING_WEBHOOK_TOKEN;

  beforeEach(() => {
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
    delete process.env.ERROR_REPORTING_WEBHOOK_URL;
    delete process.env.ERROR_REPORTING_WEBHOOK_TOKEN;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (originalWebhookUrl === undefined) delete process.env.ERROR_REPORTING_WEBHOOK_URL;
    else process.env.ERROR_REPORTING_WEBHOOK_URL = originalWebhookUrl;
    if (originalWebhookToken === undefined) delete process.env.ERROR_REPORTING_WEBHOOK_TOKEN;
    else process.env.ERROR_REPORTING_WEBHOOK_TOKEN = originalWebhookToken;
  });

  it("redacts emails, credentials, tokens and query strings", () => {
    const normalized = normalizeOperationalError({
      source: "next-server",
      message: "user@example.com Bearer abcdefghijklmnopqrstuvwxyz123456 ?token=private-value",
      path: "/reports?agentEmail=user@example.com&token=private-value",
    });

    expect(normalized.message).not.toContain("user@example.com");
    expect(normalized.message).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(normalized.message).toContain("[email]");
    expect(normalized.path).toBe("/reports");
    expect(sanitizeObservabilityText("short", 3)).toBe("sho");
  });

  it("redacts short OAuth keys, basic auth, cookies and URL credentials", () => {
    const result = sanitizeObservabilityText(
      [
        "GET /callback?api_key=short123&access_token=abc&state=s1",
        "Authorization: Basic dXNlcjpwYXNz",
        "Cookie: session=short-cookie; theme=dark",
        "refresh_token='tiny' auth=xyz",
        "https://user:pass@example.invalid/path",
      ].join("\n"),
      4_000,
    );

    for (const secret of [
      "short123",
      "access_token=abc",
      "state=s1",
      "dXNlcjpwYXNz",
      "short-cookie",
      "'tiny'",
      "auth=xyz",
      "user:pass",
    ]) {
      expect(result).not.toContain(secret);
    }
    expect(result).toContain("Authorization: [redacted]");
    expect(result).toContain("Cookie: [redacted]");
  });

  it("sends a sanitized event to the configured provider with bearer auth", async () => {
    process.env.ERROR_REPORTING_WEBHOOK_URL = "https://errors.example.test/intake";
    process.env.ERROR_REPORTING_WEBHOOK_TOKEN = "provider-secret-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const eventId = await reportOperationalError({
      source: "api-route",
      message: "Failure for person@example.com",
      path: "/api/private?secret=do-not-send",
      userId: "user-1",
    });

    expect(eventId).toEqual(expect.any(String));
    expect(loggerErrorMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://errors.example.test/intake");
    expect(init.headers).toMatchObject({ Authorization: "Bearer provider-secret-token" });
    const payload = JSON.parse(String(init.body)) as { message: string; path: string };
    expect(payload.message).toContain("[email]");
    expect(payload.path).toBe("/api/private");
  });

  it("does not break the application when the provider is unavailable", async () => {
    process.env.ERROR_REPORTING_WEBHOOK_URL = "https://errors.example.test/intake";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      reportOperationalError({ source: "next-server", message: "database unavailable" }),
    ).resolves.toEqual(expect.any(String));
    expect(loggerWarnMock).toHaveBeenCalledOnce();
  });
});
