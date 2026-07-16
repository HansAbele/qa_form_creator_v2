const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Production cookies stay secure by default. The only opt-out is an explicit
 * loopback-only switch used to exercise a production build over local HTTP.
 */
export function shouldUseSecureAuthCookies(
  env: {
    NODE_ENV?: string;
    AUTH_URL?: string;
    QORE_ALLOW_INSECURE_LOCAL_AUTH_COOKIES?: string;
  } = process.env,
) {
  if (env.NODE_ENV !== "production") return false;
  if (env.AUTH_URL?.startsWith("https://")) return true;

  if (env.QORE_ALLOW_INSECURE_LOCAL_AUTH_COOKIES === "true" && env.AUTH_URL) {
    try {
      const hostname = new URL(env.AUTH_URL).hostname.replace(/^\[|\]$/g, "").toLowerCase();
      if (LOOPBACK_HOSTS.has(hostname)) return false;
    } catch {
      // Invalid or missing production URLs retain the safest cookie behavior.
    }
  }

  return true;
}
