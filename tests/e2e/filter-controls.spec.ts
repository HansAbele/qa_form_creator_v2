import { expect, type Page, test } from "@playwright/test";
import { ADMIN_AUTH_STATE } from "./auth-state";

test.use({ storageState: ADMIN_AUTH_STATE });

async function expectSharedPeriodMenu(page: Page) {
  const periodTrigger = page.getByRole("button", { name: /^Period:/ });
  await expect(periodTrigger).toBeVisible();
  await periodTrigger.click();

  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Last 7 days", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Last 30 days", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Last 90 days", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "All time", exact: true })).toBeVisible();

  return { menu, periodTrigger };
}

test.describe("shared filter identity", () => {
  test("Dashboard keeps the localized campaign and reference period controls", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const campaign = page.getByRole("combobox", { name: "Campaign" });
    await expect(campaign).toBeVisible();
    await expect(campaign).toContainText("All");
    await expect(campaign).not.toContainText(/^all$/i);

    const { menu } = await expectSharedPeriodMenu(page);
    await menu.getByRole("button", { name: "All time", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
  });

  test("KPIs reuse the same selector and remove native date inputs", async ({ page }) => {
    await page.goto("/kpis");
    await expect(page.getByRole("heading", { name: "Campaign KPIs" })).toBeVisible();

    const { menu } = await expectSharedPeriodMenu(page);
    await menu.getByRole("button", { name: "Last 30 days", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: /^Period:/ })).not.toHaveAccessibleName(
      "Period: All time",
    );
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
  });

  test("Reports uses business labels and applies every filter consistently", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

    await expect(page.getByRole("combobox", { name: "Campaign" })).toContainText("All campaigns");
    await expect(page.getByRole("combobox", { name: "Form" })).toContainText("All forms");
    await expect(page.getByRole("combobox", { name: "Result" })).toContainText("All results");
    await expect(page.getByRole("combobox", { name: "Disposition" })).toContainText(
      "All dispositions",
    );
    await expect(page.getByRole("checkbox", { name: "Critical failures only" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
    const controlHeights = await page
      .locator('[data-slot="select-trigger"], #reports-period, label[for="reports-fatal-only"]')
      .evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height));
    expect(controlHeights.every((height) => Math.abs(height - 40) < 1)).toBe(true);

    const { menu } = await expectSharedPeriodMenu(page);
    await menu.getByRole("button", { name: "Last 7 days", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
  });
});
