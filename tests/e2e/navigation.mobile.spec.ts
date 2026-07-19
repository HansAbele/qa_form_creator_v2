import { expect, test } from "@playwright/test";
import { QA_AUTH_STATE } from "./auth-state";

test.use({ storageState: QA_AUTH_STATE });

test("mobile navigation is keyboard reachable, labelled, and usable without horizontal overflow", async ({
  page,
}) => {
  await page.goto("/");

  const periodTrigger = page.getByRole("button", { name: /^Period:/ });
  await expect(periodTrigger).toBeVisible();
  const mainContent = page.locator("#main-content");
  await expect(mainContent).toHaveCount(1);

  // Hydration can replace the initially rendered shell and reset focus. Start
  // keyboard traversal from the document only after the dashboard is stable.
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(mainContent).toBeFocused();

  await periodTrigger.click();

  const dateRangePopover = page.locator('[data-slot="popover-content"]');
  await expect(dateRangePopover).toBeVisible();
  const viewport = page.viewportSize();
  const popoverBox = await dateRangePopover.boundingBox();
  expect(viewport).not.toBeNull();
  expect(popoverBox).not.toBeNull();
  if (viewport && popoverBox) {
    expect(popoverBox.x).toBeGreaterThanOrEqual(0);
    expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  const openPopoverOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(openPopoverOverflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Apply" }).click();
  await expect(dateRangePopover).toBeHidden();

  const menuTrigger = page.getByRole("button", { name: "Open main menu" });
  await expect(menuTrigger).toBeVisible();
  await menuTrigger.focus();
  await expect(menuTrigger).toBeFocused();
  await page.keyboard.press("Enter");

  const mobileNavigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(mobileNavigation).toBeVisible();
  await expect(
    mobileNavigation
      .getByRole("region", { name: "Workspace" })
      .getByRole("link", { name: "Evaluations" }),
  ).toHaveAttribute("href", "/evaluations");
  await mobileNavigation.getByRole("link", { name: "Forms" }).click();
  await expect(page.getByRole("heading", { name: "Forms" })).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});
