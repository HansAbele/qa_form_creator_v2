import { test, expect } from "@playwright/test";

test.describe("Navigation (Admin)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@qa.local");
    await page.getByLabel("Contraseña").fill("Admin.2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL("/");
  });

  test("should navigate to forms page", async ({ page }) => {
    await page.getByRole("link", { name: "Formularios" }).click();
    await expect(page.getByText("Formularios")).toBeVisible();
  });

  test("should navigate to reports page", async ({ page }) => {
    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page.getByText("Reportes")).toBeVisible();
  });

  test("should navigate to KPIs page", async ({ page }) => {
    await page.getByRole("link", { name: "KPIs" }).click();
    await expect(page.getByText("KPIs por Campaña")).toBeVisible();
  });

  test("should navigate to agent performance page", async ({ page }) => {
    await page.getByRole("link", { name: "Agentes" }).first().click();
    await expect(page.getByText("Rendimiento de Agentes")).toBeVisible();
  });

  test("should navigate to admin users page", async ({ page }) => {
    await page.getByRole("link", { name: "Usuarios" }).click();
    await expect(page.getByText("Gestión de Usuarios")).toBeVisible();
  });

  test("should navigate to admin campaigns page", async ({ page }) => {
    await page.getByRole("link", { name: "Campañas" }).click();
    await expect(page.getByText("Gestión de Campañas")).toBeVisible();
  });
});

test.describe("Navigation (QA - restricted)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("qa@qa.local");
    await page.getByLabel("Contraseña").fill("Qa.2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL("/");
  });

  test("should not see admin links in sidebar", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Usuarios" })).not.toBeVisible();
  });

  test("should redirect from admin page to home", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL("/");
  });
});
