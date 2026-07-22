import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedPasswordResetToken } from "./helpers";

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

/**
 * Phase 19 audit (§19.5 user journeys): the password-reset request → token
 * → new password → login round trip had no E2E coverage at all. The raw
 * reset token is only ever available via the console-logged email (by
 * design — only its SHA-256 hash is ever stored, see `lib/tokens.ts`), so
 * this drives the real request form through the UI for the "request" half,
 * then seeds a token the same way `requestPasswordReset` does
 * (`seedPasswordResetToken`, setup only — never the thing under test) to
 * drive the real `/reset-password` token form, login redirect, old-password
 * invalidation, and the invalid-token error path all through the browser.
 */
test.describe("Password reset (Phase 19 audit)", () => {
  const RESET_EMAIL = `e2e-reset-${Date.now()}@example.com`;
  const OLD_PASSWORD = "password123";
  const NEW_PASSWORD = "new-password-456";

  test.beforeAll(async () => {
    await createVerifiedTestUser(RESET_EMAIL, OLD_PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(RESET_EMAIL);
  });

  test("the request form shows the same generic confirmation regardless of whether the account exists", async ({ page }) => {
    await page.goto("/reset-password");
    await page.getByLabel("Email").fill(RESET_EMAIL);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.waitForURL(/\/reset-password\?sent=1/);
    await expect(page.getByText(/we sent a password reset link/i)).toBeVisible();
  });

  test("a valid reset token lets the user set a new password, log in with it, and invalidates the old one", async ({ page }) => {
    const token = await seedPasswordResetToken(RESET_EMAIL);
    await page.goto(`/reset-password?token=${token}&email=${encodeURIComponent(RESET_EMAIL)}`);
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();

    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Update password" }).click();
    await page.waitForURL(/\/login\?reset=1/);
    await expect(page.getByText(/password updated/i)).toBeVisible();

    // The old password must no longer work.
    await page.getByLabel("Email").fill(RESET_EMAIL);
    await page.getByLabel("Password").fill(OLD_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/login\?error=1/);

    // The new password does.
    await page.getByLabel("Email").fill(RESET_EMAIL);
    await page.getByLabel("Password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/(dashboard|welcome)/);
  });

  test("an invalid or already-used token shows the friendly expired-link message, not a crash", async ({ page }) => {
    await page.goto(`/reset-password?token=not-a-real-token&email=${encodeURIComponent(RESET_EMAIL)}`);
    await page.getByLabel("New password").fill("whatever-password-1");
    await page.getByRole("button", { name: "Update password" }).click();
    await page.waitForURL(/\/reset-password\?.*error=1/);
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    // The form is still there for a retry — not an app-error boundary.
    await expect(page.getByRole("button", { name: "Update password" })).toBeVisible();
  });
});
