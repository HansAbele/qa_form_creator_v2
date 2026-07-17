import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE } from "./auth-state";

test.use({ storageState: ADMIN_AUTH_STATE });

test("los filtros de Reports y su calendario caben en móvil sin desbordamiento global", async ({
  page,
}) => {
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  await page.getByRole("button", { name: "Usar tema oscuro" }).click();
  await expect(page.getByRole("button", { name: "Usar tema oscuro" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const periodTrigger = page.getByRole("button", { name: /^Periodo:/ });
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

  await menu.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(menu).toBeHidden();

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
});
