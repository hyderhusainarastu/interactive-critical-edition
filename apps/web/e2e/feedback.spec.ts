import AxeBuilder from "@axe-core/playwright";
import { db, feedback } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Workstream J (v.5): the feedback mechanism — `FeedbackModal.tsx` +
 * `FeedbackTrigger`, `api/feedback/route.ts`, and the two footer mount
 * points (`AppFooter`, `SiteFooter`).
 *
 * Admin-inbox round-trip assertions (the feedback showing up in the
 * `/admin-dash` inbox, mark-read) belong to Lane H's `admin-dash.spec.ts` —
 * this file stays self-contained at the DB level, per the plan's lane
 * split, and never assumes the admin dashboard exists.
 */

const EMAIL = `e2e-feedback-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Feedback mechanism (Workstream J)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("the footer trigger opens the modal, traps focus, and returns focus on Escape", async ({ page }) => {
    await login(page);

    const trigger = page.getByRole("button", { name: "Feedback" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Share feedback" });
    await expect(dialog).toBeVisible();

    const closeButton = dialog.getByRole("button", { name: "Close feedback form" });
    await expect(closeButton).toBeFocused();

    // Focus trap, backward: Shift+Tab from the first focusable element
    // (the close button, focused on open) must wrap to the LAST one, not
    // escape the dialog. With no category chosen and the body empty, the
    // submit button is disabled (excluded from the tab order) and there is
    // no email field (signed-in), so the last focusable element is the
    // textarea.
    const textarea = dialog.locator("textarea");
    await page.keyboard.press("Shift+Tab");
    await expect(textarea).toBeFocused();

    // Focus trap, forward: Tab from the last focusable element must wrap
    // back to the first (the close button) rather than leaving the dialog.
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("dispatching the palimnote:open-feedback event opens the modal (the profile-menu contract)", async ({ page }) => {
    await login(page);

    // Lane G's profile-menu "Feedback" item does nothing but dispatch this
    // window CustomEvent (see FeedbackModal.tsx's doc comment) — simulate
    // that directly, without depending on Lane G's ProfileMenu existing in
    // this worktree yet.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("palimnote:open-feedback")));

    const dialog = page.getByRole("dialog", { name: "Share feedback" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("has zero WCAG 2A/2AA violations while open", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Feedback" }).click();
    await expect(page.getByRole("dialog", { name: "Share feedback" })).toBeVisible();
    // A brief settle wait before scanning (accessibility-sweep.spec.ts's own
    // precedent, D-19-8): a scan taken mid-flight through `.app-panel-enter`'s
    // 0.18s opacity/transform entrance transiently reports a lower rendered
    // contrast than the settled color-token values actually have. 300ms is
    // the same generous margin that finding established.
    await page.waitForTimeout(300);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("category chips and the primary actions meet the 44px touch-target floor", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Share feedback" });

    const bugChip = dialog.getByRole("button", { name: "Bug" });
    const bugBox = await bugChip.boundingBox();
    expect(bugBox?.height).toBeGreaterThanOrEqual(44);
    expect(bugBox?.width).toBeGreaterThanOrEqual(44);

    const closeButton = dialog.getByRole("button", { name: "Close feedback form" });
    const closeBox = await closeButton.boundingBox();
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);

    // The submit button only needs the height floor — its width naturally
    // exceeds 44px from label/padding, same convention as the library
    // reading-status tabs (`min-h-11`, no `min-w`).
    await bugChip.click();
    await dialog.locator("textarea").fill("Touch target check.");
    const submitButton = dialog.getByRole("button", { name: "Send feedback" });
    const submitBox = await submitButton.boundingBox();
    expect(submitBox?.height).toBeGreaterThanOrEqual(44);
  });

  test("submitting valid feedback (signed-in) stores a row and shows a success state", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Share feedback" });

    const uniqueBody = `Round-trip check ${Date.now()}`;
    await dialog.getByRole("button", { name: "Bug" }).click();
    await dialog.locator("textarea").fill(uniqueBody);

    const response = page.waitForResponse((res) => res.url().includes("/api/feedback") && res.request().method() === "POST");
    await dialog.getByRole("button", { name: "Send feedback" }).click();
    await response;

    await expect(dialog.getByText("Thank you — your note has been sent.")).toBeVisible();

    const rows = await db.select().from(feedback).where(and(eq(feedback.userId, userId), eq(feedback.body, uniqueBody)));
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("bug");
    expect(rows[0].email).toBeNull();
  });

  test("a filled honeypot returns a fake success without storing a row", async ({ page }) => {
    await login(page);
    const uniqueBody = `Honeypot check ${Date.now()}`;
    // Direct API call (not through the hidden field's real UI, which is
    // deliberately unreachable by a sighted or keyboard user) — same
    // technique graph-expansion.spec.ts uses for its own rate-limit probes.
    // Signed in via `page.request`'s shared cookie jar, but the honeypot
    // check runs BEFORE rate limiting in the route, so this never consumes
    // the account's feedback rate-limit budget.
    const response = await page.request.post("/api/feedback", {
      data: { category: "other", body: uniqueBody, website: "http://spam.example", path: "/dashboard" },
    });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ ok: true });

    const rows = await db.select().from(feedback).where(eq(feedback.body, uniqueBody));
    expect(rows).toHaveLength(0);
  });

  test("the 4th signed-in submission within the window is rate-limited", async ({ page }) => {
    await login(page);
    // The prior "submitting valid feedback" test already consumed request
    // #1 of this user's 3-per-hour budget (scope "feedback") — two more
    // here bring it to exactly 3 (both must still succeed), and a 4th must
    // be rejected with a friendly, non-technical message.
    for (let i = 0; i < 2; i += 1) {
      const response = await page.request.post("/api/feedback", {
        data: { category: "idea", body: `Rate limit budget ${Date.now()}-${i}`, path: "/dashboard" },
      });
      expect(response.status()).toBe(200);
    }

    const limited = await page.request.post("/api/feedback", {
      data: { category: "idea", body: `Rate limit blocked ${Date.now()}`, path: "/dashboard" },
    });
    expect(limited.status()).toBe(429);
    expect(limited.headers()["retry-after"]).toBeTruthy();
    const body = await limited.json();
    expect(body.error).toMatch(/too many/i);
  });

  test("an unauthenticated submission with an email is stored", async ({ request }) => {
    const uniqueBody = `Anonymous check ${Date.now()}`;
    const email = `anon-${Date.now()}@example.test`;
    // A fresh, cookie-less request context — not `page.request`, which
    // would carry the logged-in session from the tests above.
    const response = await request.post("/api/feedback", {
      data: { category: "praise", body: uniqueBody, email, path: "/" },
    });
    expect(response.ok()).toBe(true);

    const rows = await db.select().from(feedback).where(eq(feedback.body, uniqueBody));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].email).toBe(email);
    expect(rows[0].category).toBe("praise");

    // Unlike every other row in this file, this one has no userId at all
    // (a genuinely anonymous submission), so `deleteTestUser`'s sweep
    // (which filters by userId) can never reach it — clean it up here
    // directly rather than leaking it into the local Postgres forever.
    await db.delete(feedback).where(eq(feedback.body, uniqueBody));
  });
});
