import { db, users, verificationTokens } from "@ice/db";
import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { generateToken } from "@/lib/tokens";
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

/**
 * Signup-through-email-verification (pull-forward of the recorded Phase 19
 * residual gap — docs/PROJECT-LOG.md's Phase 19.I/19.J entry: "a fully-scripted
 * signup-through-email-verification E2E remains unbuilt ... the flow was
 * manually verified end-to-end in Phase 1 and hasn't changed since, but no
 * automated spec drives the real verification-link step"). This closes that
 * gap.
 *
 * Local dev has no RESEND_API_KEY configured (confirmed by inspecting
 * apps/web/.env.local before writing this suite), so `mailProvider`
 * (apps/web/src/lib/mail.ts) resolves to `ConsoleMailProvider` — the
 * verification email is only ever console-logged by the dev server process,
 * never actually delivered anywhere a Playwright test can intercept it.
 * That console-log hop is the ONE step this suite simulates, named
 * honestly: rather than scrape server stdout for the logged link, tests
 * that need a *known* raw token seed a `verification_token` row using the
 * exact same `generateToken()`/SHA-256-hashing helper `registerUser()`
 * itself calls (`@/lib/tokens`, inspected below) — the identical
 * "seed the token directly, then drive the real link" technique this file
 * already uses for password reset via `seedPasswordResetToken` above.
 * Every other step is driven for real: the actual `/signup` form → the real
 * `registerAction`/`registerUser()` → a real row in both `user` and
 * `verification_token`; the actual `GET /api/auth/verify-email` route →
 * the real `verifyEmailToken()`; the real Auth.js `authorize()` callback's
 * `EmailNotVerifiedError` rejection of an unverified account (inspected in
 * apps/web/src/lib/auth.ts before writing the assertion below — it throws
 * a `CredentialsSignin` subclass that `loginAction` maps to the same
 * generic `/login?error=1` state as an invalid password, by the app's own
 * anti-account-enumeration design, not a distinct "unverified" message);
 * and a real login of the now-verified account.
 */
test.describe("Signup and email verification (pull-forward of Phase 19's noted gap)", () => {
  const SIGNUP_EMAIL = `e2e-signup-${Date.now()}@example.com`;
  const UNVERIFIED_EMAIL = `e2e-unverified-${Date.now()}@example.com`;
  const VERIFY_EMAIL = `e2e-verify-${Date.now()}@example.com`;
  const TOKEN_REJECT_EMAIL = `e2e-tokenreject-${Date.now()}@example.com`;
  const PASSWORD = "password123";

  /** Creates an unverified user directly (mirrors `createVerifiedTestUser` in ./helpers, but leaves `emailVerified` null) — for tests whose subject is login/verification behavior, not the signup form itself. */
  async function createUnverifiedTestUser(email: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.insert(users).values({ name: "E2E Test", email, passwordHash });
  }

  /**
   * Seeds a `verification_token` row exactly the way `registerUser()` does
   * (same `generateToken()` call, same SHA-256 hash stored) — this is the
   * simulated email-delivery hop documented above, setup only, never the
   * thing under test. Returns the raw token, which is what a real
   * verification link's `?token=` query param carries and what the DB
   * itself never stores (only the hash — see `@/lib/tokens`).
   */
  async function seedVerificationToken(email: string, opts?: { expired?: boolean }): Promise<string> {
    const { raw, hash } = generateToken();
    await db.insert(verificationTokens).values({
      identifier: email.toLowerCase(),
      token: hash,
      expires: opts?.expired
        ? new Date(Date.now() - 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return raw;
  }

  async function getUser(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) throw new Error(`test setup/assertion: no user row found for ${email}`);
    return user;
  }

  async function getVerificationTokenRow(email: string) {
    const [row] = await db
      .select()
      .from(verificationTokens)
      .where(eq(verificationTokens.identifier, email.toLowerCase()))
      .limit(1);
    return row;
  }

  test.afterAll(async () => {
    await deleteTestUser(SIGNUP_EMAIL);
    await deleteTestUser(UNVERIFIED_EMAIL);
    await deleteTestUser(VERIFY_EMAIL);
    await deleteTestUser(TOKEN_REJECT_EMAIL);

    // `verification_token` has NO foreign key to `user` at all (it's keyed
    // by the plain-text `identifier` email column, matching Auth.js's own
    // schema shape) — confirmed directly against the local schema before
    // adding this. `deleteTestUser()` above therefore cannot cascade-clean
    // any token row for these emails; without this explicit delete, the
    // real signup-form test's own genuine (unconsumed) token row, and the
    // deliberately-expired one seeded for the rejection test, would leak
    // into the table forever. Confirmed as a real, pre-existing gap (not
    // introduced by this suite): a repo-wide check found 10 already-orphaned
    // verification_token rows and 21 already-orphaned password_reset_token
    // rows predating this session, left behind by this same file's
    // pre-existing password-reset tests, which have the identical gap.
    // That wider defect is reported upstream rather than fixed here (out of
    // this task's scope — no file other than this one may be touched), but
    // this suite's own afterAll should not keep contributing to it.
    await db
      .delete(verificationTokens)
      .where(
        inArray(verificationTokens.identifier, [
          SIGNUP_EMAIL,
          UNVERIFIED_EMAIL,
          VERIFY_EMAIL,
          TOKEN_REJECT_EMAIL,
        ]),
      );
  });

  test("submitting the real signup form creates an unverified user and a verification token", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("E2E Signup");
    await page.getByLabel("Email").fill(SIGNUP_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    // Workstream G (2026-07-25) added a required policy-acceptance checkbox
    // to the signup form; without checking it, the browser's native
    // required-field validation silently blocks submission and the button
    // click never navigates, hanging until the test timeout.
    await page.locator('input[name="policyAccepted"]').check();
    await page.getByRole("button", { name: "Sign up" }).click();

    await page.waitForURL(/\/verify-email\?sent=1/);
    await expect(page.getByText(/we sent a verification link/i)).toBeVisible();

    const user = await getUser(SIGNUP_EMAIL);
    expect(user.emailVerified).toBeNull();

    const tokenRow = await getVerificationTokenRow(SIGNUP_EMAIL);
    if (!tokenRow) throw new Error("expected a verification_token row after signup");
    // Only the SHA-256 hash is ever persisted (lib/tokens.ts) — a 64-char
    // lowercase hex string, never a plaintext/raw token.
    expect(tokenRow.token).toMatch(/^[a-f0-9]{64}$/);
  });

  test("an unverified account cannot log in — the real authorize() rejection, not an assumed one", async ({ page }) => {
    await createUnverifiedTestUser(UNVERIFIED_EMAIL, PASSWORD);

    await page.goto("/login");
    await page.getByLabel("Email").fill(UNVERIFIED_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    // authorize() throws EmailNotVerifiedError for exactly this case; every
    // AuthError (this one included) is mapped by loginAction to the same
    // generic /login?error=1 state as an invalid password — asserting the
    // app's real, deliberately-generic behavior, not a distinct message.
    await page.waitForURL(/\/login\?error=1/);
    await expect(
      page.getByText(/Invalid email or password, or your email isn.t verified yet/i),
    ).toBeVisible();

    const stillUnverified = await getUser(UNVERIFIED_EMAIL);
    expect(stillUnverified.emailVerified).toBeNull();
  });

  test("driving the real verification route with a seeded token verifies the account, deletes the token, and a real login then succeeds", async ({ page }) => {
    await createUnverifiedTestUser(VERIFY_EMAIL, PASSWORD);
    const rawToken = await seedVerificationToken(VERIFY_EMAIL);

    const before = await getUser(VERIFY_EMAIL);
    expect(before.emailVerified).toBeNull();

    await page.goto(`/api/auth/verify-email?token=${rawToken}&email=${encodeURIComponent(VERIFY_EMAIL)}`);
    await page.waitForURL(/\/login\?verified=1/);
    await expect(page.getByText(/email verified.*log in now/i)).toBeVisible();

    const after = await getUser(VERIFY_EMAIL);
    expect(after.emailVerified).toBeTruthy();

    // verifyEmailToken() deletes the consumed row rather than marking it
    // used (apps/web/src/lib/auth-service.ts) — a replayed link must find
    // nothing to match, not merely a "used" flag.
    const consumedRow = await getVerificationTokenRow(VERIFY_EMAIL);
    expect(consumedRow).toBeUndefined();

    // Now-verified account: a real login through the browser succeeds.
    await page.getByLabel("Email").fill(VERIFY_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/(dashboard|welcome)/);
  });

  test("an invalid token and an expired token are both rejected safely, without verifying the account", async ({ page }) => {
    await createUnverifiedTestUser(TOKEN_REJECT_EMAIL, PASSWORD);

    // Invalid: no such token row exists at all.
    await page.goto(`/api/auth/verify-email?token=not-a-real-token&email=${encodeURIComponent(TOKEN_REJECT_EMAIL)}`);
    await page.waitForURL(/\/verify-email\?error=invalid/);
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();

    // Expired: a real token row exists but its `expires` timestamp is past.
    const expiredToken = await seedVerificationToken(TOKEN_REJECT_EMAIL, { expired: true });
    await page.goto(`/api/auth/verify-email?token=${expiredToken}&email=${encodeURIComponent(TOKEN_REJECT_EMAIL)}`);
    await page.waitForURL(/\/verify-email\?error=invalid/);
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();

    const stillUnverified = await getUser(TOKEN_REJECT_EMAIL);
    expect(stillUnverified.emailVerified).toBeNull();
  });
});
