import { expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}
