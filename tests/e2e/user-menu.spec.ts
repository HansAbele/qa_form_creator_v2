import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE } from "./auth-state";

test.use({ storageState: ADMIN_AUTH_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Abrir men.* de usuario/ })).toBeVisible();
});

test("user menu exposes profile and all supported appearance preferences", async ({ page }) => {
  const trigger = page.getByRole("button", { name: /Abrir men.* de usuario/ });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const profileItem = page.getByRole("menuitem", { name: /Mi perfil/ });
  await expect(profileItem).toBeFocused();

  await expect(page.getByText("Preferencias de apariencia", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Claro" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Oscuro" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Sistema" })).toBeVisible();

  await page.getByRole("menuitemradio", { name: "Oscuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("menuitemradio", { name: "Sistema" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("theme"))).toBe("system");

  await profileItem.click();
  await expect(page).toHaveURL(/\/settings\?section=account$/);
  await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
});

test("user menu closes the authenticated session", async ({ page }) => {
  await page.getByRole("button", { name: /Abrir men.* de usuario/ }).click();
  await page.getByRole("menuitem", { name: /Cerrar sesi/ }).click();

  await expect(page).toHaveURL(/\/login$/);
});
