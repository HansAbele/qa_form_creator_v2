import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE } from "./auth-state";

test.use({ storageState: ADMIN_AUTH_STATE });

test("Reports filters and calendar fit on mobile without global overflow", async ({ page }) => {
  await page.goto("/preferences");
  await page.getByRole("radio", { name: "Dark Use the dark color palette." }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

  const periodTrigger = page.getByRole("button", { name: /^Period:/ });
  await periodTrigger.click();
  const menu = page.getByRole("dialog");
  await expect(menu).toBeVisible();

  const viewport = page.viewportSize();
  const menuBox = await menu.boundingBox();
  expect(viewport).not.toBeNull();
  expect(menuBox).not.toBeNull();
  if (viewport && menuBox) {
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  const openMenuOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(openMenuOverflow).toBeLessThanOrEqual(1);

  await menu.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(menu).toBeHidden();

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
});
