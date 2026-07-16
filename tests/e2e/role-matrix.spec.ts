import { expect, type Page, test } from "@playwright/test";
import {
  ADMIN_AUTH_STATE,
  QA_AUTH_STATE,
  QA_ELEVATED_AUTH_STATE,
  SUPERVISOR_AUTH_STATE,
} from "./auth-state";

const ASSIGNED_FORM = "Customer Service QA Form";
const RESTRICTED_CAMPAIGN = "Backoffice Restricted";
const RESTRICTED_FORM = "Backoffice Restricted QA Form";

test.describe.configure({ timeout: 90_000 });

async function expectAssignedCampaignOnly(page: Page) {
  await page.goto("/forms");
  await expect(page.getByRole("heading", { name: "Formularios" })).toBeVisible();
  await expect(page.getByText(ASSIGNED_FORM, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(RESTRICTED_FORM, { exact: true })).not.toBeVisible();
  await expect(page.getByText(RESTRICTED_CAMPAIGN, { exact: true })).not.toBeVisible();
}

async function expectRestrictedFormDenied(
  page: Page,
  fallback: "/forms" | "error",
) {
  await page.goto("/forms/restricted-campaign-form");
  await expect(page.getByText(RESTRICTED_FORM, { exact: true })).not.toBeVisible();
  await expect(page.getByText("Restricted quality score", { exact: true })).not.toBeVisible();
  if (fallback === "/forms") {
    await expect(page).toHaveURL(/\/forms$/);
  } else {
    await expect(
      page.getByRole("alert").filter({ hasText: "No pudimos cargar esta secci" }),
    ).toBeVisible();
  }
}

async function expectAuditScope(page: Page, includeRestricted: boolean) {
  await page.goto("/settings");
  await page.getByRole("button", { name: /Auditor/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: /Auditor/ })).toBeVisible();
  await expect(page.getByText("E2E Customer Service audit event", { exact: true })).toBeVisible();
  const restrictedEvent = page.getByText("E2E Backoffice secret audit event", { exact: true });
  if (includeRestricted) {
    await expect(restrictedEvent).toBeVisible();
  } else {
    await expect(restrictedEvent).not.toBeVisible();
  }
}

test.describe("RBAC matrix - QA Manager", () => {
  test.use({ storageState: ADMIN_AUTH_STATE });

  test("has global controls and can see both campaigns", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Usuarios" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Campanas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "KPIs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Exportar" })).toBeVisible();

    await page.goto("/forms");
    await expect(page.getByText(ASSIGNED_FORM, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(RESTRICTED_FORM, { exact: true }).first()).toBeVisible();

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: /Gesti.*Usuarios/ })).toBeVisible();
    await page.goto("/forms/new");
    await expect(page.getByRole("heading", { name: "Nuevo Formulario" })).toBeVisible();
    await expectAuditScope(page, true);
  });
});

test.describe("RBAC matrix - standard QA", () => {
  test.use({ storageState: QA_AUTH_STATE });

  test("sees only evaluator capabilities for the assigned campaign", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Formularios" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reports" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "KPIs" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Exportar" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Usuarios" })).not.toBeVisible();

    await expectAssignedCampaignOnly(page);
    await expect(page.getByRole("link", { name: "Evaluar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Nuevo formulario" })).not.toBeVisible();

    for (const route of [
      "/forms/new",
      "/reports",
      "/kpis",
      "/analytics/export",
      "/operations/agents",
    ]) {
      await page.goto(route);
      await expect(page).toHaveURL(route === "/forms/new" ? /\/forms$/ : /\/settings$/);
    }
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/$/);
    await expectRestrictedFormDenied(page, "error");
  });
});

test.describe("RBAC matrix - elevated QA", () => {
  test.use({ storageState: QA_ELEVATED_AUTH_STATE });

  test("has campaign-manager controls without global administration", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "KPIs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Exportar" })).toBeVisible();
    await expect(page.locator('a[href="/operations/agents"]')).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuarios" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Campanas" })).not.toBeVisible();

    await expectAssignedCampaignOnly(page);
    await expect(page.getByRole("link", { name: "Nuevo formulario" })).toBeVisible();
    await page.goto("/forms/new");
    await expect(page.getByRole("heading", { name: "Nuevo Formulario" })).toBeVisible();

    for (const route of ["/reports", "/kpis", "/analytics/export", "/operations/agents"]) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}$`));
    }
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/$/);
    await expectRestrictedFormDenied(page, "error");
    await expectAuditScope(page, false);
  });
});

test.describe("RBAC matrix - Supervisor", () => {
  test.use({ storageState: SUPERVISOR_AUTH_STATE });

  test("is read-only and remains scoped to the assigned campaign", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "KPIs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Exportar" })).not.toBeVisible();
    await expect(page.locator('a[href="/operations/agents"]')).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Usuarios" })).not.toBeVisible();

    await expectAssignedCampaignOnly(page);
    await expect(page.getByRole("link", { name: "Evaluar" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Nuevo formulario" })).not.toBeVisible();

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
    await page.goto("/kpis");
    await expect(page.getByRole("heading", { name: /KPIs por Campa/ })).toBeVisible();
    for (const route of ["/forms/new", "/analytics/export", "/operations/agents"]) {
      await page.goto(route);
      await expect(page).toHaveURL(route === "/forms/new" ? /\/forms$/ : /\/settings$/);
    }
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/$/);
    await expectRestrictedFormDenied(page, "/forms");
    await expectAuditScope(page, false);
  });
});
