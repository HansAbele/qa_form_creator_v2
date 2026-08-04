import { expect, type Page, test } from "@playwright/test";
import { QA_AUTH_STATE } from "./auth-state";

async function openDefaultEvaluation(page: Page) {
  await page.goto("/forms");
  await expect(page.getByText("Customer Service QA Form", { exact: true }).first()).toBeVisible();
  const evaluateLink = page.getByRole("link", { name: "Evaluate" });
  await expect(evaluateLink).toBeVisible();
  const evaluationHref = await evaluateLink.getAttribute("href");
  expect(evaluationHref).toMatch(/^\/forms\/[^/?]+$/);
  await page.goto(evaluationHref as string);
  await expect(page.getByRole("heading", { name: "New Evaluation" })).toBeVisible();
}

async function selectEvaluationAgent(page: Page) {
  const agentSelect = page.getByRole("combobox").first();
  await agentSelect.click();
  await page.getByRole("option", { name: /John Smith/ }).click();
}

test.describe("Critical evaluation persistence", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.use({ storageState: QA_AUTH_STATE });

  test("keeps incomplete work out of drafts and guards unsaved navigation", async ({ page }) => {
    await openDefaultEvaluation(page);
    await expect(page.getByRole("button", { name: /Save draft/i })).toHaveCount(0);
    await selectEvaluationAgent(page);

    const firstRating = page.getByRole("radiogroup").first();
    await firstRating.getByRole("radio").last().click();
    await expect(page).not.toHaveURL(/responseId=/);
    const evaluationUrl = page.url();

    let guardDialogSeen = false;
    page.once("dialog", async (dialog) => {
      guardDialogSeen = true;
      expect(dialog.message()).toContain("You have unsaved changes");
      await dialog.dismiss();
    });
    await page.getByRole("link", { name: "Dashboard" }).click();
    expect(guardDialogSeen).toBe(true);
    await expect(page).toHaveURL(evaluationUrl);
  });
});
