import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { QA_AUTH_STATE, QA_ELEVATED_AUTH_STATE } from "./auth-state";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoWcagViolations(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY,
              ).length,
        ),
      { timeout: 10_000 },
    )
    .toBe(0);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const details = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target),
  }));
  expect(details, JSON.stringify(details, null, 2)).toEqual([]);
}

test.describe("WCAG 2.1 A/AA - QA", () => {
  test.use({ storageState: QA_AUTH_STATE });

  test("dashboard and forms list have no detectable violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Periodo:/ })).toBeVisible();
    const mainContent = page.locator("#main-content");
    await expect(mainContent).toHaveCount(1);
    await expect(mainContent).toBeVisible();
    await expectNoWcagViolations(page);

    await page.goto("/forms");
    await expect(page.getByRole("heading", { name: "Formularios" })).toBeVisible();
    await expect(page.locator("#main-content")).toHaveCount(1);
    await expectNoWcagViolations(page);
  });

  test("evaluation controls expose labels, errors and keyboard radio behavior", async ({
    page,
  }) => {
    await page.goto("/forms");
    await page.getByRole("link", { name: "Evaluar" }).click();
    await expect(page.getByRole("heading", { name: "Nueva evaluacion" })).toBeVisible();

    const rating = page.getByRole("radiogroup").first();
    const firstOption = rating.getByRole("radio").first();

    // Server-rendered controls can appear just before React finishes hydration.
    // Confirm real interactivity before sending a one-shot keyboard event.
    await expect(async () => {
      await firstOption.click();
      await expect(firstOption).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    await firstOption.focus();
    await expect(firstOption).toBeFocused();
    await firstOption.press("End");

    const lastOption = rating.getByRole("radio").last();
    await expect(lastOption).toHaveAttribute("aria-checked", "true");
    await expect(lastOption).toBeFocused();

    await lastOption.press("ArrowRight");
    await expect(firstOption).toHaveAttribute("aria-checked", "true");
    await expect(firstOption).toBeFocused();

    await expectNoWcagViolations(page);
  });
});

test.describe("WCAG 2.1 A/AA - QA elevado", () => {
  test.use({ storageState: QA_ELEVATED_AUTH_STATE });

  test("KPI charts expose text alternatives without detectable violations", async ({ page }) => {
    await page.goto("/kpis");
    await expect(page.getByRole("heading", { name: /KPIs por Campa/ })).toBeVisible();
    await expectNoWcagViolations(page);
  });
});
