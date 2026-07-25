import AxeBuilder from "@axe-core/playwright";
import { db, ragConversations, ragMessages, userDeletionArchives, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Workstream H (v.5): the separate, credential-gated `/admin-dash`
 * dashboard.
 *
 * Requires `ADMIN_DASH_USERNAME` / `ADMIN_DASH_PASSWORD_HASH` /
 * `ADMIN_DASH_SECRET` set on the server under test (see `.env.local`), plus
 * a FOURTH, test-only env var — `ADMIN_DASH_TEST_PASSWORD`, the matching
 * PLAINTEXT password — that exists solely so this spec can submit a real
 * login form; `apps/web/src/lib/adminDash.ts` never reads it, and it is
 * gitignored the same as every other local env value. This whole file
 * self-skips (rather than failing confusingly) when either isn't present.
 *
 * The plan's "any env var unset -> the whole tree 404s" case is instead
 * covered by a UNIT test (`adminDash.test.ts`'s `readAdminDashCredentials`/
 * `createAdminDashCookie` null-env assertions, and `verifyAdminDashToken`'s
 * "env unset at verify time" case) rather than here — spinning up a SECOND
 * web server with a different env, alongside the one THIS whole file needs
 * running with all three vars set, was judged not worth the added
 * local/CI complexity for a behavior the unit test already proves
 * deterministically and instantly (documented choice, per the plan's own
 * "or test via unit if impractical" allowance).
 *
 * Rate-limiting note: every login attempt below carries its OWN synthetic
 * `x-real-ip` header (`clientIdentity()` in `preAuthRateLimit.ts` trusts
 * that header when present) so each test scenario gets an independent
 * 5-per-15-minutes budget rather than all sharing one bucket across the
 * whole file, which would make test order rate-limit-fragile.
 */

const ADMIN_USERNAME = process.env.ADMIN_DASH_USERNAME;
const ADMIN_PASSWORD_PLAINTEXT = process.env.ADMIN_DASH_TEST_PASSWORD;
const HAS_ADMIN_DASH_ENV = Boolean(ADMIN_USERNAME && ADMIN_PASSWORD_PLAINTEXT);

async function loginAs(page: Page, ip: string, username: string, password: string) {
  return page.request.post("/api/admin-dash/login", {
    headers: { "x-real-ip": ip },
    form: { username, password },
    maxRedirects: 0,
  });
}

test.describe("Admin dashboard (Workstream H)", () => {
  test.skip(!HAS_ADMIN_DASH_ENV, "ADMIN_DASH_USERNAME / ADMIN_DASH_TEST_PASSWORD not set for this run");

  test("wrong credentials show a generic error and set no session", async ({ page }) => {
    const res = await loginAs(page, "10.9.1.1", ADMIN_USERNAME!, "definitely-wrong");
    expect([302, 303]).toContain(res.status());
    expect(res.headers()["location"]).toContain("/admin-dash/login");
    expect(res.headers()["location"]).toContain("error=1");

    await page.goto("/admin-dash/login?error=1");
    await expect(page.getByText("Invalid username or password.")).toBeVisible();

    // No session was established — the guarded overview 404s.
    const overview = await page.request.get("/admin-dash");
    expect(overview.status()).toBe(404);
  });

  test("the 6th login attempt within the window is rate-limited", async ({ page }) => {
    const ip = "10.9.1.2";
    for (let i = 0; i < 5; i += 1) {
      const res = await loginAs(page, ip, ADMIN_USERNAME!, "still-wrong");
      expect(res.status(), `attempt ${i + 1} of 5`).not.toBe(429);
    }
    const sixth = await loginAs(page, ip, ADMIN_USERNAME!, "still-wrong");
    expect(sixth.status()).toBe(429);
    expect(sixth.headers()["retry-after"]).toBeTruthy();
  });

  test("a successful login sets the cookie and reaches the overview", async ({ page }) => {
    const res = await loginAs(page, "10.9.1.3", ADMIN_USERNAME!, ADMIN_PASSWORD_PLAINTEXT!);
    expect([302, 303]).toContain(res.status());
    expect(res.headers()["location"]).not.toContain("error=1");

    await page.goto("/admin-dash");
    await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
    await expect(page.getByText("Platform")).toBeVisible();
  });

  test("logging out clears the session and the overview 404s again", async ({ page }) => {
    await loginAs(page, "10.9.1.4", ADMIN_USERNAME!, ADMIN_PASSWORD_PLAINTEXT!);
    await page.goto("/admin-dash");
    await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/admin-dash\/login/);

    const overview = await page.request.get("/admin-dash");
    expect(overview.status()).toBe(404);
  });

  test("zero WCAG 2A/2AA violations on login and the authenticated pages", async ({ page }) => {
    await page.goto("/admin-dash/login");
    // Same settle margin as feedback.spec.ts's own axe precedent (D-19-8) —
    // the root layout's PageTransition wraps admin-dash pages too.
    await page.waitForTimeout(300);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);

    await loginAs(page, "10.9.1.5", ADMIN_USERNAME!, ADMIN_PASSWORD_PLAINTEXT!);

    await page.goto("/admin-dash");
    await page.waitForTimeout(300);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);

    await page.goto("/admin-dash/users");
    await page.waitForTimeout(300);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);

    await page.goto("/admin-dash/feedback");
    await page.waitForTimeout(300);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  });

  test.describe("privacy gate (data-sharing)", () => {
    const SHARED_EMAIL = `e2e-admindash-shared-${Date.now()}@example.com`;
    const PRIVATE_EMAIL = `e2e-admindash-private-${Date.now()}@example.com`;
    const PASSWORD = "password123";
    const SENTINEL = `SENTINEL${Date.now()}DoNotLeak`;
    let sharedUserId = "";
    let privateUserId = "";

    test.beforeAll(async () => {
      sharedUserId = await createVerifiedTestUser(SHARED_EMAIL, PASSWORD);
      privateUserId = await createVerifiedTestUser(PRIVATE_EMAIL, PASSWORD);
      await db.update(users).set({ dataSharingEnabled: true }).where(eq(users.id, sharedUserId));
      // privateUserId is left at the schema default (dataSharingEnabled: false).

      for (const userId of [sharedUserId, privateUserId]) {
        const [conversation] = await db
          .insert(ragConversations)
          .values({ userId, title: "Sentinel check" })
          .returning({ id: ragConversations.id });
        await db.insert(ragMessages).values([
          { conversationId: conversation.id, role: "user", content: SENTINEL },
          { conversationId: conversation.id, role: "assistant", content: `Answer referencing ${SENTINEL}` },
        ]);
      }
    });

    test.afterAll(async () => {
      await deleteTestUser(SHARED_EMAIL);
      await deleteTestUser(PRIVATE_EMAIL);
    });

    test("a non-opted-in user's chat content never appears in their drill-down HTML", async ({ page }) => {
      await loginAs(page, "10.9.1.6", ADMIN_USERNAME!, ADMIN_PASSWORD_PLAINTEXT!);
      await page.goto(`/admin-dash/users/${privateUserId}`);
      await expect(page.getByRole("heading", { name: PRIVATE_EMAIL })).toBeVisible();
      const html = await page.content();
      expect(html).not.toContain(SENTINEL);
      await expect(page.getByText(/has not opted in/i)).toBeVisible();
    });

    test("an opted-in user's chat content appears in their drill-down HTML", async ({ page }) => {
      await loginAs(page, "10.9.1.7", ADMIN_USERNAME!, ADMIN_PASSWORD_PLAINTEXT!);
      await page.goto(`/admin-dash/users/${sharedUserId}`);
      await expect(page.getByRole("heading", { name: SHARED_EMAIL })).toBeVisible();
      const html = await page.content();
      expect(html).toContain(SENTINEL);
    });
  });

  test.describe("deleted-user snapshot", () => {
    const ARCHIVE_USER_ID = "00000000-0000-4000-8000-000000000001";
    const ARCHIVE_EMAIL = `e2e-admindash-archived-${Date.now()}@example.test`;

    test.beforeAll(async () => {
      await db.insert(userDeletionArchives).values({
        userId: ARCHIVE_USER_ID,
        email: ARCHIVE_EMAIL,
        name: "Archived Reader",
        userCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
        docsProcessed: 3,
        totalAiCostUsd: 0.42,
        chatMessages: 7,
        lastActiveAt: new Date("2026-02-01T00:00:00.000Z"),
        readerLevel: "advanced",
        dataSharingWasEnabled: true,
      });
    });

    test.afterAll(async () => {
      await db.delete(userDeletionArchives).where(eq(userDeletionArchives.userId, ARCHIVE_USER_ID));
    });

    test("a deleted user's row renders from the archive snapshot, not a live account", async ({ page }) => {
      await loginAs(page, "10.9.1.8", ADMIN_USERNAME!, ADMIN_PASSWORD_PLAINTEXT!);
      await page.goto(`/admin-dash/users/${ARCHIVE_USER_ID}`);
      await expect(page.getByRole("heading", { name: ARCHIVE_EMAIL })).toBeVisible();
      // Anchored at the start: "Deleted" also appears mid-sentence in two
      // other strings on this page ("Not available (account deleted)",
      // "...was deleted with it..."), so an unanchored match is ambiguous.
      await expect(page.getByText(/^Deleted\b/)).toBeVisible();
      await expect(page.getByText("Archived Reader")).toBeVisible();
      await expect(page.getByText(/removed with it/i)).toBeVisible();
    });
  });
});
