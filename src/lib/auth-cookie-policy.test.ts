import { describe, expect, it } from "vitest";
import { shouldUseSecureAuthCookies } from "./auth-cookie-policy";

describe("auth cookie policy", () => {
  it("uses secure cookies for HTTPS production", () => {
    expect(
      shouldUseSecureAuthCookies({ NODE_ENV: "production", AUTH_URL: "https://qore.example.com" }),
    ).toBe(true);
  });

  it("allows an explicit local HTTP E2E exception", () => {
    expect(
      shouldUseSecureAuthCookies({
        NODE_ENV: "production",
        AUTH_URL: "http://localhost:3100",
        QORE_ALLOW_INSECURE_LOCAL_AUTH_COOKIES: "true",
      }),
    ).toBe(false);
  });

  it("never applies the exception to a remote host", () => {
    expect(
      shouldUseSecureAuthCookies({
        NODE_ENV: "production",
        AUTH_URL: "http://qore.example.com",
        QORE_ALLOW_INSECURE_LOCAL_AUTH_COOKIES: "true",
      }),
    ).toBe(true);
  });

  it("allows an explicit HTTP deployment on a private IPv4 address", () => {
    expect(
      shouldUseSecureAuthCookies({
        NODE_ENV: "production",
        AUTH_URL: "http://192.168.80.243:3000",
        QORE_ALLOW_INSECURE_HTTP_AUTH_COOKIES: "true",
      }),
    ).toBe(false);
  });

  it("does not allow the HTTP deployment override on a public host", () => {
    expect(
      shouldUseSecureAuthCookies({
        NODE_ENV: "production",
        AUTH_URL: "http://qore.example.com",
        QORE_ALLOW_INSECURE_HTTP_AUTH_COOKIES: "true",
      }),
    ).toBe(true);
  });

  it("does not downgrade HTTPS even when the HTTP override is enabled", () => {
    expect(
      shouldUseSecureAuthCookies({
        NODE_ENV: "production",
        AUTH_URL: "https://192.168.80.243:3000",
        QORE_ALLOW_INSECURE_HTTP_AUTH_COOKIES: "true",
      }),
    ).toBe(true);
  });
});
