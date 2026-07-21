import { expect, test } from "@playwright/test";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

const EMAIL = `e2e-workspace-shell-${Date.now()}@example.com`;
const PASSWORD = "password123";

test.describe("Phase 12 workspace foundation", () => {
  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await db
      .update(users)
      .set({
        preferences: {
          onboardedAt: new Date().toISOString(),
          workspace: {
            theme: "dark",
            fontSize: "medium",
            readingWidth: "comfortable",
            focusMode: false,
            scriptDisplay: "original",
          },
        },
      })
      .where(eq(users.id, userId));
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("offers keyboard search and persists presentation controls", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await expect(page.getByText("Navigate")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await page.getByLabel("Theme").selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  });
});
