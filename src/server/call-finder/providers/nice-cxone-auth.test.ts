import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadNiceCxoneAccessKeyConfig, NiceCxoneAccessKeyTokenProvider } from "./nice-cxone-auth";

const config = {
  tokenUrl: "https://na1.nice-incontact.com/authentication/v1/token/access-key",
  accessKeyId: "access-key-id",
  accessKeySecret: "super-secret-value",
};

describe("NiceCxoneAccessKeyTokenProvider", () => {
  let now: number;

  beforeEach(() => {
    now = Date.parse("2026-07-21T00:00:00.000Z");
  });

  it("should exchange access-key credentials and reuse a valid bearer token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ access_token: "token-1", expires_in: 3_600 }, { status: 200 }),
      );
    const provider = new NiceCxoneAccessKeyTokenProvider(config, fetchMock, () => now);

    await expect(provider.getAccessToken()).resolves.toBe("token-1");
    await expect(provider.getAccessToken()).resolves.toBe("token-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      config.tokenUrl,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          accessKeyId: config.accessKeyId,
          accessKeySecret: config.accessKeySecret,
        }),
      }),
    );
  });

  it("should refresh a token inside the expiry safety window", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "token-1", expires_in: 120 }))
      .mockResolvedValueOnce(Response.json({ access_token: "token-2", expires_in: 120 }));
    const provider = new NiceCxoneAccessKeyTokenProvider(config, fetchMock, () => now);

    await expect(provider.getAccessToken()).resolves.toBe("token-1");
    now += 61_000;
    await expect(provider.getAccessToken()).resolves.toBe("token-2");
  });

  it("should not leak access-key secrets in authentication failures", async () => {
    const provider = new NiceCxoneAccessKeyTokenProvider(
      config,
      vi.fn().mockResolvedValue(new Response("provider details", { status: 401 })),
      () => now,
    );

    try {
      await provider.getAccessToken();
      throw new Error("Expected NICE authentication to fail");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("HTTP 401");
      expect(message).not.toContain(config.accessKeySecret);
      expect(message).not.toContain("provider details");
    }
  });
});

describe("loadNiceCxoneAccessKeyConfig", () => {
  it("should reject non-NICE token hosts", () => {
    expect(() =>
      loadNiceCxoneAccessKeyConfig({
        NICE_CXONE_TOKEN_URL: "https://attacker.example/token",
        NICE_CXONE_ACCESS_KEY_ID: "id",
        NICE_CXONE_ACCESS_KEY_SECRET: "secret",
      }),
    ).toThrow("official HTTPS endpoint");
  });
});
