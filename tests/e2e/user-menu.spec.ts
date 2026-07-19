import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE } from "./auth-state";

test.use({ storageState: ADMIN_AUTH_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Open user menu/ })).toBeVisible();
});

test("user menu exposes account and preferences without notifications or theme controls", async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: /Open user menu/ });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const accountItem = page.getByRole("menuitem", { name: /My account/ });
  await expect(accountItem).toBeFocused();
  await expect(page.getByRole("menuitem", { name: /Preferences/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);
  await expect(page.getByText("Notifications", { exact: true })).toHaveCount(0);

  await accountItem.click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();
});

test("user menu closes the authenticated session", async ({ page }) => {
  await page.getByRole("button", { name: /Open user menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/login$/);
});
