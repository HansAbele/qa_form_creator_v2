import { test, expect } from "@playwright/test";

test.describe("Forms (Admin)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@qa.local");
    await page.getByLabel("Contraseña").fill("Admin.2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL("/");
  });

  test("should show forms list", async ({ page }) => {
    await page.getByRole("link", { name: "Formularios" }).click();
    await expect(page.getByText("Formularios")).toBeVisible();
    await expect(page.getByText("Nuevo formulario")).toBeVisible();
  });

  test("should open form builder", async ({ page }) => {
    await page.goto("/forms/new");
    await expect(page.getByText("Nuevo Formulario")).toBeVisible();
    await expect(page.getByText("Editor")).toBeVisible();
    await expect(page.getByText("Vista previa")).toBeVisible();
  });

  test("should add a question in form builder", async ({ page }) => {
    await page.goto("/forms/new");
    await page.getByRole("button", { name: "Agregar pregunta" }).click();
    await expect(page.getByPlaceholder("Texto de la pregunta...")).toBeVisible();
  });
});

test.describe("Forms (QA)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("qa@qa.local");
    await page.getByLabel("Contraseña").fill("Qa.2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL("/");
  });

  test("should show forms list without create button", async ({ page }) => {
    await page.getByRole("link", { name: "Formularios" }).click();
    await expect(page.getByText("Formularios")).toBeVisible();
    await expect(page.getByText("Nuevo formulario")).not.toBeVisible();
  });
});
