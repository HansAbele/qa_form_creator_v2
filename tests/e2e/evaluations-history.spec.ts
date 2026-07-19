import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ADMIN_AUTH_STATE, QA_AUTH_STATE } from "./auth-state";

const COACHING_RESPONSE_ID = "e2e-coaching-response";
const COACHING_COMMENT = "Coaching: mantiene un saludo claro y profesional.";

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    const [form, agent, evaluator, disposition] = await Promise.all([
      prisma.form.findFirst({
        where: {
          campaignId: "default-campaign",
          status: "PUBLISHED",
          title: "Customer Service QA Form",
        },
        select: {
          id: true,
          version: true,
          questions: {
            orderBy: { order: "asc" },
            take: 1,
            select: {
              id: true,
              ratingMax: true,
              formCategory: { select: { qaCategoryId: true } },
            },
          },
        },
      }),
      prisma.agent.findFirst({
        where: { campaignId: "default-campaign", name: "John Smith" },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { email: "qa@qa.local" },
        select: { id: true },
      }),
      prisma.disposition.findFirst({
        where: { campaignId: "default-campaign", name: "Resolved" },
        select: { id: true },
      }),
    ]);
    const question = form?.questions[0];
    if (!form || !question || !agent || !evaluator || !disposition) {
      throw new Error("The deterministic coaching fixtures must be seeded before E2E tests");
    }

    await prisma.response.deleteMany({ where: { id: COACHING_RESPONSE_ID } });
    await prisma.response.create({
      data: {
        id: COACHING_RESPONSE_ID,
        formId: form.id,
        formVersion: form.version,
        agentId: agent.id,
        evaluatorId: evaluator.id,
        dispositionId: disposition.id,
        score: 88,
        result: "PASS",
        status: "SUBMITTED",
        submittedAt: new Date(),
        answers: {
          create: {
            questionId: question.id,
            categoryId: question.formCategory?.qaCategoryId,
            value: String(question.ratingMax ?? 5),
            score: 100,
            comment: COACHING_COMMENT,
          },
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.response.deleteMany({ where: { id: COACHING_RESPONSE_ID } });
  } finally {
    await prisma.$disconnect();
  }
});

test.describe("historial mensual del QA", () => {
  test.use({ storageState: QA_AUTH_STATE });

  test("mantiene la actividad propia y no expone el filtro de evaluador", async ({ page }) => {
    await page.goto("/evaluations?scope=own");

    await expect(page.getByRole("heading", { name: "Evaluations" })).toBeVisible();
    await expect(page.getByText("Your activity only", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Agent")).toBeVisible();
    await expect(page.locator('label[for="evaluations-evaluator"]')).toHaveCount(0);

    await page.getByRole("button", { name: /^Period:/ }).click();
    await expect(page.getByRole("button", { name: "This month" })).toBeVisible();
    await page.getByText("Previous month", { exact: true }).click();

    await expect(page).toHaveURL(/dateFrom=\d{4}-\d{2}-01/);
    await expect(page).toHaveURL(/dateTo=\d{4}-\d{2}-\d{2}/);
  });

  test("permite revisar la campaña asignada y abrir el detalle para coaching", async ({ page }) => {
    await page.goto("/evaluations?scope=managed");

    await expect(page.getByText("Managed scope", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Evaluator")).toBeVisible();

    const campaignFilter = page.getByLabel(/Campa/);
    await campaignFilter.click();
    await expect(page.getByRole("option", { name: "Customer Service", exact: true })).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Backoffice Restricted", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    const coachingLink = page.locator(`a[href="/evaluations/${COACHING_RESPONSE_ID}"]`, {
      hasText: "View evaluation",
    });
    const coachingRow = coachingLink.locator("xpath=ancestor::tr");
    await expect(coachingRow).toBeVisible();
    await expect(coachingRow).toContainText("John Smith");
    await expect(coachingRow).toContainText("Customer Service QA Form");
    await coachingLink.click();

    await expect(page).toHaveURL(new RegExp(`/evaluations/${COACHING_RESPONSE_ID}$`));
    await expect(page.getByRole("heading", { name: "Customer Service QA Form" })).toBeVisible();
    await expect(page.getByText("88.0%", { exact: true })).toBeVisible();
    await expect(page.getByText("QA Evaluator", { exact: true })).toBeVisible();
    await expect(page.getByText(COACHING_COMMENT, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel evaluation", exact: true }),
    ).not.toBeVisible();
  });
});

test.describe("historial administrado", () => {
  test.use({ storageState: ADMIN_AUTH_STATE });

  test("permite filtrar por evaluador dentro del alcance administrado", async ({ page }) => {
    await page.goto("/evaluations?scope=managed");

    await expect(page.getByRole("heading", { name: "Evaluations" })).toBeVisible();
    await expect(page.getByText("Managed scope", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Agent")).toBeVisible();
    await expect(page.getByLabel("Evaluator")).toBeVisible();
    await expect(page.getByLabel("Form")).toBeVisible();
    await expect(page.getByLabel("Disposition")).toBeVisible();
    await expect(page.getByText("Critical failures only", { exact: true })).toBeVisible();
  });
});
