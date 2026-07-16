import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number.parseInt(process.env.E2E_PORT ?? "3100", 10);
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;
const e2eWebServerCommand =
  process.env.E2E_WEB_SERVER_COMMAND ?? "node scripts/start-standalone.mjs";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // These scenarios share a deliberately rate-limited auth service and a
  // small integration database. Serial workers keep the suite deterministic
  // without weakening either production control.
  workers: 1,
  reporter: "html",
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: [/.*\.setup\.ts/, /.*\.mobile\.spec\.ts/],
    },
    {
      name: "mobile-chromium",
      testMatch: /.*\.mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: e2eWebServerCommand,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ...process.env,
      PORT: String(e2ePort),
      HOSTNAME: "127.0.0.1",
      AUTH_URL: e2eBaseUrl,
      QORE_ALLOW_INSECURE_LOCAL_AUTH_COOKIES: "true",
    },
  },
});
