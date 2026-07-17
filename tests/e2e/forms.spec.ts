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
    await expect(page.getByText(/^v\d+(?:\.\d+){0,2}$/)).toHaveCount(0);
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

  test("can create forms but cannot edit or publish the manager form", async ({ page }) => {
    await page.goto("/forms");
    await expect(page.getByRole("heading", { name: "Formularios" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nuevo formulario" })).toBeVisible();
    await expect(page.getByText("Customer Service QA Form", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Editar Customer Service QA Form", exact: true }),
    ).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar", exact: true })).not.toBeVisible();
  });

  test("can open the form builder for its assigned campaign", async ({ page }) => {
    await page.goto("/forms/new");
    await expect(page.getByRole("heading", { name: "Nuevo Formulario" })).toBeVisible();
    await expect(page.getByLabel("Titulo")).toBeVisible();
    await expect(page.getByText("Campana", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar pregunta", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Crear formulario", exact: true })).toBeVisible();
  });
});
