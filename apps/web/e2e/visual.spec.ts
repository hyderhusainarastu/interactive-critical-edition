import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

const EMAIL = `e2e-visual-${Date.now()}@example.com`;
const PASSWORD = "password123";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Phase 12 visual regression", () => {
  test.beforeAll(async () => { await createVerifiedTestUser(EMAIL, PASSWORD); });
  test.afterAll(async () => { await deleteTestUser(EMAIL); });

  test("Writer projects desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await login(page);
    await page.goto("/writer");
    await expect(page).toHaveScreenshot("writer-projects-desktop.png", { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.01 });
  });

  test("Writer projects mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto("/writer");
    await expect(page).toHaveScreenshot("writer-projects-mobile.png", { fullPage: true, animations: "disabled", maxDiffPixelRatio: 0.01 });
  });
});
