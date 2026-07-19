import { expect, test } from "@playwright/test";
import { QA_AUTH_STATE } from "./auth-state";

test.use({ storageState: QA_AUTH_STATE });

test("user menu remains usable without horizontal overflow on mobile", async ({ page }) => {
  await page.goto("/");

  const trigger = page.getByRole("button", { name: /Open user menu|Abrir men.* de usuario/ });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const menu = page.locator('[data-slot="dropdown-menu-content"]');
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /My account|Mi cuenta/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Preferences|Preferencias/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Sign out|Cerrar sesi/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);

  const viewport = page.viewportSize();
  const menuBox = await menu.boundingBox();
  expect(viewport).not.toBeNull();
  expect(menuBox).not.toBeNull();
  if (viewport && menuBox) {
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});
