import { expect, type Page, test } from "@playwright/test";
import { ADMIN_AUTH_STATE } from "./auth-state";

async function expectDocumentOwnedVerticalScroll(page: Page) {
  const metrics = await page.locator("#main-content").evaluate((main) => {
    const shell = main.parentElement?.parentElement;
    if (!shell) throw new Error("Application shell not found");

    return {
      bodyScrollHeight: document.body.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
      shellHeight: shell.getBoundingClientRect().height,
    };
  });

  expect(metrics.documentScrollHeight).toBeGreaterThan(metrics.documentClientHeight);
  expect(metrics.mainScrollHeight - metrics.mainClientHeight).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.documentScrollHeight - metrics.bodyScrollHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.documentScrollHeight - metrics.shellHeight)).toBeLessThanOrEqual(1);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const header = page.getByRole("banner");
  const sidebar = page.getByRole("complementary");
  await expect(header).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect
    .poll(async () => Math.abs((await header.boundingBox())?.y ?? Number.POSITIVE_INFINITY))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(async () => Math.abs((await sidebar.boundingBox())?.y ?? Number.POSITIVE_INFINITY))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(async () => {
      const box = await sidebar.boundingBox();
      const viewport = page.viewportSize();
      return box && viewport ? Math.abs(box.height - viewport.height) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(1);
}

test.describe("Desktop application shell", () => {
  test.use({ storageState: ADMIN_AUTH_STATE, viewport: { width: 1600, height: 900 } });

  test("uses document scrolling on dashboard without leaving a detached canvas", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await expectDocumentOwnedVerticalScroll(page);
  });

  test("uses document scrolling for a long evaluation form", async ({ page }) => {
    await page.goto("/forms");
    const formCard = page.locator('[data-slot="card"]', {
      has: page.getByText("Customer Service QA Form", { exact: true }),
    });
    await expect(formCard).toBeVisible();
    const evaluationLink = formCard.getByRole("link", { name: "Evaluar" });
    const href = await evaluationLink.getAttribute("href");
    expect(href).toMatch(/^\/forms\/[^/?]+$/);

    await page.goto(href as string);
    await expect(page.getByRole("heading", { name: "Nueva evaluacion" })).toBeVisible();

    await expectDocumentOwnedVerticalScroll(page);
  });
});
