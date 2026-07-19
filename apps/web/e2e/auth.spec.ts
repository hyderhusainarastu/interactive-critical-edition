import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 8.1 auth regression: the invalid-password path must return the
 * friendly login error state, NOT an unhandled runtime error. Root cause
 * of the original defect: Auth.js v5 `signIn` throws `CredentialsSignin`
 * (it does not return `{ error }`), so `loginAction`'s old
 * `if (result?.error)` branch was never reached and the throw surfaced as
 * a 500. `loginAction` now try/catches and maps `AuthError` →
 * `/login?error=1`. Needs web + Postgres (no worker) — CI-safe.
 */
const EMAIL = `e2e-auth-${Date.now()}@example.com`;
const PASSWORD = "password123";

test.describe("Authentication (Phase 8.1)", () => {
  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("invalid password returns the friendly error, not a 500", async ({ page }) => {
    const res = await page.goto("/login");
    expect(res?.status()).toBeLessThan(400);

    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("wrong-password-xyz");
    await page.getByRole("button", { name: "Log in" }).click();

    // Stays on /login and shows the friendly message — no error/500 page.
    await page.waitForURL(/\/login\?error=1/);
    await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
    // The login form is still there (not an app-error boundary).
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  });

  test("unknown email returns the friendly error, not a 500", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/login\?error=1/);
    await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
  });

  test("valid credentials log in successfully", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/(dashboard|welcome)/);
  });
});
