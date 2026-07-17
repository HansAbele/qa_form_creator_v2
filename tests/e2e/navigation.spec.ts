import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE, QA_AUTH_STATE } from "./auth-state";

test.describe("Navigation (QA Manager)", () => {
  test.use({ storageState: ADMIN_AUTH_STATE });
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("should navigate to forms page", async ({ page }) => {
    await page.getByRole("link", { name: "Formularios" }).click();
    await expect(page.getByRole("heading", { name: "Formularios" })).toBeVisible();
  });

  test("should navigate to reports page", async ({ page }) => {
    await page.getByRole("link", { name: "Reportes" }).click();
    await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  });

  test("should expose evaluations from the primary navigation", async ({ page }) => {
    const desktopNavigation = page.locator("#desktop-primary-navigation");
    const primaryNavigation = desktopNavigation.getByRole("region", { name: "Principal" });

    await expect(primaryNavigation.getByRole("link", { name: "Evaluaciones" })).toHaveAttribute(
      "href",
      "/evaluations",
    );
    await expect(
      desktopNavigation
        .getByRole("region", { name: "Configuración" })
        .getByRole("link", { name: "Configuración de calidad" }),
    ).toHaveAttribute("href", "/settings");
    await expect(
      desktopNavigation
        .getByRole("region", { name: "Operación" })
        .getByRole("link", { name: "Gestionar agentes" }),
    ).toHaveAttribute("href", "/operations/agents");
  });

  test("should navigate to KPIs page", async ({ page }) => {
    await page.getByRole("link", { name: "KPIs" }).click();
    await expect(page.getByRole("heading", { name: "KPIs por Campaña" })).toBeVisible();
  });

  test("should navigate to agent performance page", async ({ page }) => {
    const analyticsNavigation = page
      .locator("#desktop-primary-navigation")
      .getByRole("region", { name: "Analítica" });
    await analyticsNavigation
      .getByRole("link", { name: "Rendimiento de agentes", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Rendimiento de Agentes" })).toBeVisible();
  });

  test("should navigate to QA Manager users page", async ({ page }) => {
    await page.getByRole("link", { name: "Usuarios" }).click();
    await expect(page.getByRole("heading", { name: "Gestión de Usuarios" })).toBeVisible();
  });

  test("should navigate to QA Manager campaigns page", async ({ page }) => {
    await page.getByRole("link", { name: "Campañas" }).click();
    await expect(page.getByRole("heading", { name: "Gestión de Campañas" })).toBeVisible();
  });
});

test.describe("Navigation (QA - campaign scoped)", () => {
  test.use({ storageState: QA_AUTH_STATE });
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("exposes daily read modules but hides QA Manager controls", async ({ page }) => {
    const desktopNavigation = page.locator("#desktop-primary-navigation");
    const analyticsNavigation = desktopNavigation.getByRole("region", { name: "Analítica" });

    await expect(page.getByRole("link", { name: "Usuarios" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Campañas" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Evaluaciones" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reportes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "KPIs" })).toBeVisible();
    await expect(
      analyticsNavigation.getByRole("link", { name: "Rendimiento de agentes", exact: true }),
    ).toHaveAttribute("href", "/analytics/agents");
    await expect(
      analyticsNavigation.getByRole("link", { name: "Rendimiento por equipos", exact: true }),
    ).toHaveAttribute("href", "/analytics/teams");
    await expect(
      analyticsNavigation.getByRole("link", {
        name: "Resultados por disposición",
        exact: true,
      }),
    ).toHaveAttribute("href", "/analytics/dispositions");
    await expect(page.getByRole("link", { name: "Gestionar agentes" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Gestionar equipos" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Gestionar disposiciones" })).not.toBeVisible();
  });

  test("should navigate to the assigned-campaign analytics modules", async ({ page }) => {
    const destinations = [
      ["/reports", "Reportes"],
      ["/kpis", "KPIs por Campaña"],
      ["/analytics/agents", "Rendimiento de Agentes"],
      ["/analytics/teams", "Performance por Equipo"],
      ["/analytics/dispositions", "Disposiciones"],
    ] as const;

    for (const [route, heading] of destinations) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}$`));
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("should redirect from QA Manager page to home", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL("/");
  });
});
