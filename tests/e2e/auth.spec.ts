import { expect, test } from "@playwright/test";
import { E2E_ADMIN_PASSWORD, E2E_QA_PASSWORD } from "./credentials";
import { loginAs } from "./login";

test.describe("Authentication", () => {
  test("should show login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("img", { name: "TNO" })).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("should redirect unauthenticated user to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("should show error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("wrong@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Invalid credentials")).toBeVisible();
  });

  test("should login successfully as QA Manager", async ({ page }) => {
    await loginAs(page, "admin@qa.local", E2E_ADMIN_PASSWORD);
  });

  test("should login successfully as QA", async ({ page }) => {
    await loginAs(page, "qa@qa.local", E2E_QA_PASSWORD);
  });
});
