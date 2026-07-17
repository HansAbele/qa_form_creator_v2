import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE } from "./auth-state";

test.use({ storageState: ADMIN_AUTH_STATE });

async function expectSharedPeriodMenu(page: import("@playwright/test").Page) {
  const periodTrigger = page.getByRole("button", { name: /^Periodo:/ });
  await expect(periodTrigger).toBeVisible();
  await periodTrigger.click();

  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Hoy", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Últimos 7 días", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Últimos 30 días", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Últimos 90 días", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Todo el periodo", exact: true })).toBeVisible();

  return { menu, periodTrigger };
}

test.describe("identidad común de filtros", () => {
  test("Dashboard conserva campaña localizada y el menú de periodo de referencia", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const campaign = page.getByRole("combobox", { name: "Campaña" });
    await expect(campaign).toBeVisible();
    await expect(campaign).toContainText("Todas");
    await expect(campaign).not.toContainText(/^all$/i);

    const { menu } = await expectSharedPeriodMenu(page);
    await menu.getByRole("button", { name: "Todo el periodo", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
  });

  test("KPIs reutiliza el mismo selector y elimina las fechas nativas", async ({ page }) => {
    await page.goto("/kpis");
    await expect(page.getByRole("heading", { name: "KPIs por Campaña" })).toBeVisible();

    const { menu } = await expectSharedPeriodMenu(page);
    await menu.getByRole("button", { name: "Últimos 30 días", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: /^Periodo:/ })).not.toHaveAccessibleName(
      "Periodo: Todo el periodo",
    );
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
  });

  test("Reports muestra labels de negocio y aplica todos los filtros de forma coherente", async ({
    page,
  }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();

    await expect(page.getByRole("combobox", { name: "Campaña" })).toContainText("Todas");
    await expect(page.getByRole("combobox", { name: "Formulario" })).toContainText("Todos");
    await expect(page.getByRole("combobox", { name: "Resultado" })).toContainText("Todos");
    await expect(page.getByRole("combobox", { name: "Disposición" })).toContainText("Todas");
    await expect(page.getByRole("checkbox", { name: "Solo fatales" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Buscar", exact: true })).toHaveCount(0);
    const controlHeights = await page
      .locator('[data-slot="select-trigger"], #reports-period, label[for="reports-fatal-only"]')
      .evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height));
    expect(controlHeights.every((height) => Math.abs(height - 40) < 1)).toBe(true);

    const { menu } = await expectSharedPeriodMenu(page);
    await menu.getByRole("button", { name: "Últimos 7 días", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: "Limpiar", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Limpiar", exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
  });
});
