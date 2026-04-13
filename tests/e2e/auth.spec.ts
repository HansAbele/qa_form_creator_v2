import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("should show login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Qore")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
  });

  test("should redirect unauthenticated user to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("should show error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("wrong@example.com");
    await page.getByLabel("Contraseña").fill("wrongpassword");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("Credenciales incorrectas")).toBeVisible();
  });

  test("should login successfully as admin", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@qa.local");
    await page.getByLabel("Contraseña").fill("Admin.2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText("Dashboard")).toBeVisible();
  });

  test("should login successfully as QA", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("qa@qa.local");
    await page.getByLabel("Contraseña").fill("Qa.2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText("Dashboard")).toBeVisible();
  });
});
