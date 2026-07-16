import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test as setup } from "@playwright/test";
import { ADMIN_AUTH_STATE, QA_AUTH_STATE } from "./auth-state";
import { E2E_ADMIN_PASSWORD, E2E_QA_PASSWORD } from "./credentials";
import { loginAs } from "./login";

setup.beforeAll(async () => {
  await mkdir(path.dirname(ADMIN_AUTH_STATE), { recursive: true });
});

setup("authenticate QA Manager", async ({ page }) => {
  await loginAs(page, "admin@qa.local", E2E_ADMIN_PASSWORD);
  await page.context().storageState({ path: ADMIN_AUTH_STATE });
});

setup("authenticate QA", async ({ page }) => {
  await loginAs(page, "qa@qa.local", E2E_QA_PASSWORD);
  await page.context().storageState({ path: QA_AUTH_STATE });
});
