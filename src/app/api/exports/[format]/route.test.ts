import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExportBusyError,
  ExportGlobalBusyError,
  ExportLimitError,
  ExportNoDataError,
  ExportRateLimitError,
} from "@/lib/export-limits";
import { CampaignAuthorizationError } from "@/server/queries/campaign-filter";

const { authMock, createExportDownloadMock, loggerErrorMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  createExportDownloadMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/server/actions/exports", () => ({
  createExportDownload: createExportDownloadMock,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock } }));

import { POST } from "./route";

function makeRequest(options?: { origin?: string; body?: unknown; contentLength?: string }) {
  const body = JSON.stringify(options?.body ?? { campaignId: "campaign-1", fields: ["score"] });
  return new NextRequest("https://qore.example/api/exports/csv", {
    method: "POST",
    headers: {
      host: "qore.example",
      origin: options?.origin ?? "https://qore.example",
      "content-type": "application/json",
      ...(options?.contentLength ? { "content-length": options.contentLength } : {}),
    },
    body,
  });
}

function context(format = "csv") {
  return { params: Promise.resolve({ format }) };
}

describe("POST /api/exports/[format]", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_URL", "https://qore.example");
    authMock.mockReset();
    createExportDownloadMock.mockReset();
    loggerErrorMock.mockReset();
    authMock.mockResolvedValue({ user: { id: "user-1" } });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects cross-origin requests before checking export permissions", async () => {
    const response = await POST(makeRequest({ origin: "https://attacker.example" }), context());

    expect(response.status).toBe(403);
    expect(authMock).not.toHaveBeenCalled();
    expect(createExportDownloadMock).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    authMock.mockResolvedValue(null);
    const response = await POST(makeRequest(), context());

    expect(response.status).toBe(401);
    expect(createExportDownloadMock).not.toHaveBeenCalled();
  });

  it("rejects unknown formats and oversized request metadata", async () => {
    const unknown = await POST(makeRequest(), context("pdf"));
    const oversized = await POST(makeRequest({ contentLength: "20000" }), context());

    expect(unknown.status).toBe(404);
    expect(oversized.status).toBe(413);
    expect(createExportDownloadMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body without relying on Content-Length", async () => {
    const response = await POST(
      makeRequest({ body: { campaignId: "x".repeat(20_000) } }),
      context(),
    );

    expect(response.status).toBe(413);
    expect(createExportDownloadMock).not.toHaveBeenCalled();
  });

  it.each([
    [new ExportLimitError("Reduce los filtros."), 413, "EXPORT_LIMIT_EXCEEDED"],
    [new ExportNoDataError(), 404, "NO_EXPORT_DATA"],
    [new ExportRateLimitError(), 429, "EXPORT_RATE_LIMITED"],
    [new ExportBusyError(), 429, "EXPORT_BUSY"],
    [new ExportGlobalBusyError(), 429, "EXPORT_GLOBAL_BUSY"],
  ])("maps expected export errors without leaking internals", async (error, status, code) => {
    createExportDownloadMock.mockRejectedValue(error);
    const response = await POST(makeRequest(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    if (status === 429) expect(response.headers.get("retry-after")).toBeTruthy();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it("distinguishes denied exports from unexpected operational failures", async () => {
    createExportDownloadMock.mockRejectedValueOnce(new CampaignAuthorizationError());
    const denied = await POST(makeRequest(), context());
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: "EXPORT_FORBIDDEN" },
    });
    expect(loggerErrorMock).not.toHaveBeenCalled();

    createExportDownloadMock.mockRejectedValueOnce(new Error("database unavailable"));
    const failed = await POST(makeRequest(), context());
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({ error: { code: "EXPORT_FAILED" } });
    expect(loggerErrorMock).toHaveBeenCalledOnce();
  });

  it("returns the authenticated stream with download-safe headers", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("score\n95"));
        controller.close();
      },
    });
    createExportDownloadMock.mockResolvedValue({
      body,
      contentType: "text/csv; charset=utf-8",
      extension: "csv",
    });

    const response = await POST(makeRequest(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="evaluations_\d{8}T\d{6}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.text()).resolves.toBe("score\n95");
    expect(createExportDownloadMock).toHaveBeenCalledWith("csv", {
      campaignId: "campaign-1",
      fields: ["score"],
    });
  });
});
