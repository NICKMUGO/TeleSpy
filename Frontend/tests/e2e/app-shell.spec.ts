import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("skip link is the first focusable element and jumps to main content", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("sidebar navigation is reachable by mouse and updates the route", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "SIM inventory" }).click();
  await expect(page).toHaveURL(/\/sims$/);
  await expect(
    page.getByRole("heading", { name: "SIM inventory", level: 1 }),
  ).toBeVisible();
});

test("command palette opens with Ctrl+K and navigates", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Control+k");
  await expect(
    page.getByPlaceholder("Search a name or extension, or jump to a page..."),
  ).toBeVisible();

  await page.keyboard.type("Invoices");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/invoices$/);
});

test("keyboard shortcuts dialog opens with ?", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("?");
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeHidden();
});

test("dashboard shell has no automatic a11y violations", async ({ page }) => {
  await page.goto("/dashboard");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
