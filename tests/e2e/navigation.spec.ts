import { expect, test } from "@playwright/test";
import { ADMIN_AUTH_STATE, QA_AUTH_STATE } from "./auth-state";

test.describe("Navigation (QA Manager)", () => {
  test.use({ storageState: ADMIN_AUTH_STATE });
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("navigates through the daily workspace", async ({ page }) => {
    await page.getByRole("link", { name: "Forms" }).click();
    await expect(page.getByRole("heading", { name: "Forms" })).toBeVisible();

    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  });

  test("exposes the current information architecture", async ({ page }) => {
    const navigation = page.locator("#desktop-primary-navigation");
    await expect(
      navigation.getByRole("region", { name: "Workspace" }).getByRole("link", {
        name: "Evaluations",
      }),
    ).toHaveAttribute("href", "/evaluations");
    await expect(
      navigation.getByRole("region", { name: "Settings" }).getByRole("link", {
        name: "Settings",
      }),
    ).toHaveAttribute("href", "/settings");
    await expect(
      navigation.getByRole("region", { name: "Operations" }).getByRole("link", {
        name: "Manage agents",
      }),
    ).toHaveAttribute("href", "/operations/agents");
  });

  test("navigates through performance and administration", async ({ page }) => {
    await page.getByRole("link", { name: "KPIs" }).click();
    await expect(page.getByRole("heading", { name: "Campaign KPIs" })).toBeVisible();

    await page.goto("/analytics/agents");
    await expect(page.getByRole("heading", { name: "Agent performance" })).toBeVisible();

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();

    await page.goto("/admin/campaigns");
    await expect(page.getByRole("heading", { name: "Campaign Management" })).toBeVisible();
  });
});

test.describe("Navigation (campaign-scoped QA)", () => {
  test.use({ storageState: QA_AUTH_STATE });
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });

  test("shows daily modules and hides QA Manager controls", async ({ page }) => {
    const navigation = page.locator("#desktop-primary-navigation");
    const performance = navigation.getByRole("region", { name: "Performance" });

    await expect(page.getByRole("link", { name: "Users" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Campaigns" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Evaluations" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "KPIs" })).toBeVisible();
    await expect(performance.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/analytics/agents",
    );
    await expect(performance.getByRole("link", { name: "Teams" })).toHaveAttribute(
      "href",
      "/analytics/teams",
    );
    await expect(performance.getByRole("link", { name: "Dispositions" })).toHaveAttribute(
      "href",
      "/analytics/dispositions",
    );
    await expect(page.getByRole("link", { name: "Manage agents" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Manage teams" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Manage dispositions" })).not.toBeVisible();
  });

  test("opens analytics only for the assigned campaign", async ({ page }) => {
    const destinations = [
      ["/reports", "Reports"],
      ["/kpis", "Campaign KPIs"],
      ["/analytics/agents", "Agent performance"],
      ["/analytics/teams", "Team performance"],
      ["/analytics/dispositions", "Dispositions"],
    ] as const;

    for (const [route, heading] of destinations) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}$`));
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("redirects global administration to home", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL("/");
  });
});
