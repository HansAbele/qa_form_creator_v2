import { expect, type Page, type Route, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { QA_AUTH_STATE } from "./auth-state";

async function openDefaultEvaluation(page: Page) {
  await page.goto("/forms");
  await expect(page.getByText("Customer Service QA Form", { exact: true }).first()).toBeVisible();
  const evaluateLink = page.getByRole("link", { name: "Evaluar" });
  await expect(evaluateLink).toBeVisible();
  const evaluationHref = await evaluateLink.getAttribute("href");
  expect(evaluationHref).toMatch(/^\/forms\/[^/?]+$/);
  // This scenario exercises autosave and recovery, not client-side link
  // transitions. A direct navigation keeps its setup isolated from the
  // outgoing form-card animation while still verifying the rendered href.
  await page.goto(evaluationHref as string);
  await expect(page.getByRole("heading", { name: "Nueva evaluacion" })).toBeVisible();
}

async function selectEvaluationContext(page: Page, beforeDispositionSelect?: () => Promise<void>) {
  const agentSelect = page.getByRole("combobox").first();
  await agentSelect.click();
  await page.getByRole("option", { name: /John Smith/ }).click();

  const dispositionSelect = page.getByRole("combobox").nth(1);
  await dispositionSelect.click();
  const disposition = page.getByRole("button", { name: /Resolved/ }).last();
  await expect(disposition).toBeVisible();
  await beforeDispositionSelect?.();
  await disposition.click();
}

test.describe("Critical evaluation persistence", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.use({ storageState: QA_AUTH_STATE });

  test("recovers autosave after a network failure, reloads the draft, and guards unsaved navigation", async ({
    page,
  }) => {
    await openDefaultEvaluation(page);

    let failedAutosave = false;
    const failFirstServerAction = async (route: Route) => {
      const request = route.request();
      if (!failedAutosave && request.method() === "POST" && request.headers()["next-action"]) {
        failedAutosave = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    };

    await selectEvaluationContext(page, async () => {
      await page.route("**/*", failFirstServerAction);
    });

    const draftStatus = page.locator('[role="alert"], [role="status"]').filter({
      hasText: /Borrador|Guardando|Cambios/,
    });
    await expect(draftStatus).toContainText("Borrador sin guardar");
    expect(failedAutosave).toBe(true);

    const firstRating = page.getByRole("radiogroup").first();
    await firstRating.getByRole("radio").last().click();
    await expect(draftStatus).toContainText("Borrador guardado");
    await expect(page).toHaveURL(/\/forms\/[^?]+\?responseId=[^&]+$/);

    const draftUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(draftUrl);
    await expect(page.getByRole("combobox").first()).toContainText("John Smith");
    await expect(page.getByRole("radiogroup").first().getByRole("radio").last()).toHaveAttribute(
      "aria-checked",
      "true",
    );

    let guardDialogSeen = false;
    page.once("dialog", async (dialog) => {
      guardDialogSeen = true;
      expect(dialog.message()).toContain("Hay cambios sin guardar");
      await dialog.dismiss();
    });
    await page.getByRole("radiogroup").first().getByRole("radio").nth(3).click();
    await page.getByRole("link", { name: "Dashboard" }).click();
    expect(guardDialogSeen).toBe(true);
    await expect(page).toHaveURL(draftUrl);

    await page.unroute("**/*", failFirstServerAction);
  });
});

test.describe("Notification visibility and lifecycle", () => {
  test.use({ storageState: QA_AUTH_STATE });

  test.beforeEach(async () => {
    const prisma = new PrismaClient();
    try {
      const fixture = await prisma.notification.updateMany({
        where: { id: "e2e-notification-visible" },
        data: { readAt: null, archivedAt: null },
      });
      expect(fixture.count, "the deterministic notification fixture must be seeded").toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("shows only assigned-campaign notifications and supports read/archive", async ({ page }) => {
    await page.goto("/");
    const notifications = page.getByRole("button", { name: /Notificaciones/ });
    await expect(notifications).toHaveAccessibleName(/1 sin leer/);
    await notifications.click();

    const visibleNotice = page.getByText("E2E Customer Service notice", { exact: true });
    await expect(visibleNotice).toBeVisible();
    await expect(page.getByText("E2E Backoffice secret notice", { exact: true })).not.toBeVisible();

    await page.getByRole("button", { name: /^E2E Customer Service notice/ }).click();
    await expect(notifications).toHaveAccessibleName(/ninguna sin leer/);
    await page
      .getByRole("button", { name: /Archivar notificaci.*E2E Customer Service notice/ })
      .click();
    await expect(visibleNotice).not.toBeVisible();
  });
});
