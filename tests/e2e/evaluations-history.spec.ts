import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE, QA_AUTH_STATE } from "./auth-state";

test.describe("historial mensual del QA", () => {
  test.use({ storageState: QA_AUTH_STATE });

  test("mantiene la actividad propia y no expone el filtro de evaluador", async ({ page }) => {
    await page.goto("/evaluations?scope=own");

    await expect(page.getByRole("heading", { name: "Evaluaciones" })).toBeVisible();
    await expect(page.getByText("Solo tu actividad", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Agente")).toBeVisible();
    await expect(page.locator('label[for="evaluations-evaluator"]')).toHaveCount(0);

    await page.getByRole("button", { name: /^Periodo:/ }).click();
    await expect(page.getByRole("button", { name: "Este mes" })).toBeVisible();
    await page.getByText("Mes anterior", { exact: true }).click();

    await expect(page).toHaveURL(/dateFrom=\d{4}-\d{2}-01/);
    await expect(page).toHaveURL(/dateTo=\d{4}-\d{2}-\d{2}/);
  });
});

test.describe("historial administrado", () => {
  test.use({ storageState: ADMIN_AUTH_STATE });

  test("permite filtrar por evaluador dentro del alcance administrado", async ({ page }) => {
    await page.goto("/evaluations?scope=managed");

    await expect(page.getByRole("heading", { name: "Evaluaciones" })).toBeVisible();
    await expect(page.getByText("Alcance administrado", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Agente")).toBeVisible();
    await expect(page.getByLabel("Evaluador")).toBeVisible();
    await expect(page.getByLabel("Formulario")).toBeVisible();
    await expect(page.getByLabel("Disposición")).toBeVisible();
    await expect(page.getByText("Solo fatales", { exact: true })).toBeVisible();
  });
});
