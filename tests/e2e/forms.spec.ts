import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE, QA_AUTH_STATE } from "./auth-state";

test.describe("Forms (QA Manager)", () => {
  test.use({ storageState: ADMIN_AUTH_STATE });
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("should show forms list", async ({ page }) => {
    await page.getByRole("link", { name: "Formularios" }).click();
    await expect(page.getByRole("heading", { name: "Formularios" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nuevo formulario" })).toBeVisible();
  });

  test("should open form builder", async ({ page }) => {
    await page.goto("/forms/new");
    await expect(page.getByRole("heading", { name: "Nuevo Formulario" })).toBeVisible();
    const editorTab = page.getByRole("tab", { name: "Editor" });
    const previewTab = page.getByRole("tab", { name: "Vista previa" });
    await expect(editorTab).toHaveCount(1);
    await expect(previewTab).toHaveCount(1);
    await expect(editorTab).toBeVisible();
    await expect(previewTab).toBeVisible();
  });

  test("should add a question in form builder", async ({ page }) => {
    await page.goto("/forms/new");
    await page.getByRole("button", { name: "Agregar pregunta", exact: true }).click();
    await expect(page.getByText("Texto de la pregunta", { exact: true })).toBeVisible();
  });
});

test.describe("Forms (QA)", () => {
  test.use({ storageState: QA_AUTH_STATE });
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("should show forms list without create button", async ({ page }) => {
    await page.goto("/forms");
    await expect(page.getByRole("heading", { name: "Formularios" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nuevo formulario" })).not.toBeVisible();
  });
});
