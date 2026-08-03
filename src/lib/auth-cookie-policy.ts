const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

/**
 * Production cookies stay secure by default. The only opt-out is an explicit
 * loopback-only switch used to exercise a production build over local HTTP.
 */
export function shouldUseSecureAuthCookies(
  env: {
    NODE_ENV?: string;
    AUTH_URL?: string;
    QORE_ALLOW_INSECURE_LOCAL_AUTH_COOKIES?: string;
    QORE_ALLOW_INSECURE_HTTP_AUTH_COOKIES?: string;
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

  if (env.QORE_ALLOW_INSECURE_HTTP_AUTH_COOKIES === "true" && env.AUTH_URL) {
    try {
      const url = new URL(env.AUTH_URL);
      const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
      if (url.protocol === "http:" && (LOOPBACK_HOSTS.has(hostname) || isPrivateIpv4(hostname))) {
        return false;
      }
    } catch {
      // Invalid production URLs retain the safest cookie behavior.
    }
  }

  return true;
}
