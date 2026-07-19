import { expect, test } from "@playwright/test";
import { QA_AUTH_STATE } from "./auth-state";

test.use({ storageState: QA_AUTH_STATE });

test("a QA can open account security and personal preferences", async ({ page }) => {
  await page.goto("/account");

  await expect(page.getByRole("heading", { name: /My account|Mi cuenta/, level: 1 })).toBeVisible();
  await expect(page.getByLabel(/Full name|Nombre completo/)).toBeVisible();
  await expect(page.getByLabel("Email")).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: /Change password|Cambiar contraseña/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: /Preferences|Preferencias/ }).click();
  await expect(page).toHaveURL(/\/preferences$/);
  await expect(
    page.getByRole("heading", { name: /Preferences|Preferencias/, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: /Appearance|Apariencia/ })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: /Language|Idioma/ })).toBeVisible();
  await expect(page.getByText("English", { exact: true })).toBeVisible();
  await expect(page.getByText("Español", { exact: true })).toBeVisible();
});
