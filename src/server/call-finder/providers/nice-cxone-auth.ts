import "server-only";

import { z } from "zod";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive().max(86_400).default(3_600),
});

export type NiceCxoneAccessKeyConfig = {
  tokenUrl: string;
  accessKeyId: string;
  accessKeySecret: string;
};

export class NiceCxoneAuthenticationError extends Error {
  constructor(
    message: string,
    readonly code: "AUTH_REJECTED" | "AUTH_INVALID_RESPONSE" | "AUTH_NETWORK",
  ) {
    super(message);
    this.name = "NiceCxoneAuthenticationError";
  }
}

function validateTokenUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const isNiceHost =
    host === "nice-incontact.com" ||
    host.endsWith(".nice-incontact.com") ||
    host === "niceincontact.com" ||
    host.endsWith(".niceincontact.com");
  if (url.protocol !== "https:" || !isNiceHost || url.username || url.password) {
    throw new Error("NICE CXone token URL must be an official HTTPS endpoint");
  }
  return url.toString();
}

export function loadNiceCxoneAccessKeyConfig(
  environment: Record<string, string | undefined> = process.env,
): NiceCxoneAccessKeyConfig {
  const tokenUrl = environment.NICE_CXONE_TOKEN_URL?.trim();
  const accessKeyId = environment.NICE_CXONE_ACCESS_KEY_ID?.trim();
  const accessKeySecret = environment.NICE_CXONE_ACCESS_KEY_SECRET?.trim();
  if (!tokenUrl || !accessKeyId || !accessKeySecret) {
    throw new Error("NICE CXone access-key credentials are not configured");
  }
  return { tokenUrl: validateTokenUrl(tokenUrl), accessKeyId, accessKeySecret };
}

/** Access-key token exchange documented by NICE; secrets never leave this server module. */
export class NiceCxoneAccessKeyTokenProvider {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: NiceCxoneAccessKeyConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    validateTokenUrl(config.tokenUrl);
    if (!config.accessKeyId.trim() || !config.accessKeySecret.trim()) {
      throw new Error("NICE CXone access-key credentials are incomplete");
    }
  }

  invalidate() {
    this.cachedToken = null;
  }

  async getAccessToken(options: { forceRefresh?: boolean } = {}) {
    const refreshSkewMs = 60_000;
    if (
      !options.forceRefresh &&
      this.cachedToken &&
      this.cachedToken.expiresAt - refreshSkewMs > this.now()
    ) {
      return this.cachedToken.value;
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(validateTokenUrl(this.config.tokenUrl), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          accessKeyId: this.config.accessKeyId,
          accessKeySecret: this.config.accessKeySecret,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new NiceCxoneAuthenticationError(
        "NICE CXone authentication is temporarily unavailable",
        "AUTH_NETWORK",
      );
    }

    if (!response.ok) {
      throw new NiceCxoneAuthenticationError(
        `NICE CXone rejected access-key authentication (HTTP ${response.status})`,
        "AUTH_REJECTED",
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new NiceCxoneAuthenticationError(
        "NICE CXone returned an invalid authentication response",
        "AUTH_INVALID_RESPONSE",
      );
    }
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new NiceCxoneAuthenticationError(
        "NICE CXone returned an invalid authentication response",
        "AUTH_INVALID_RESPONSE",
      );
    }

    this.cachedToken = {
      value: parsed.data.access_token,
      expiresAt: this.now() + parsed.data.expires_in * 1_000,
    };
    return this.cachedToken.value;
  }
}
