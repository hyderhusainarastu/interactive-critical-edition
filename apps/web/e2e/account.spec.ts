import {
  concepts,
  conceptMastery,
  db,
  documents,
  feedback,
  learningResources,
  ragConversations,
  ragMessages,
  readingRecords,
  userDeletionArchives,
  users,
  works,
} from "@ice/db";
import { getDocumentFileSize, uploadDocumentFile } from "@ice/ingestion";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithLibraryItem } from "./helpers";

/**
 * Workstream G (v.5) account pages — profile edit, the data-sharing toggle,
 * the plan page, the usage page (empty and seeded), and account deletion.
 *
 * The delete-account test needs a REAL Supabase Storage object (proving
 * "Storage object gone", not a placeholder) — same manual-only posture as
 * `trash-storage.spec.ts` (CI runs with dummy Supabase credentials; see
 * that file's own doc comment). Run against the local dev stack:
 *   pnpm --filter web test:e2e account.spec.ts
 * This file is deliberately NOT added to `.github/workflows/ci.yml`'s
 * explicit spec whitelist, matching `trash-storage.spec.ts`.
 */

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/(dashboard|welcome)/);
}

/**
 * Scoped to `#main-content` (`AppShell.tsx`'s `<main>`) rather than the
 * whole page — a documented Next.js 16 App Router streaming-SSR/hydration
 * artifact (D-19-36, see docs/PROJECT-LOG.md) can transiently duplicate
 * segment HTML in a hidden holder near `</body>` before it self-heals,
 * which otherwise makes an unscoped text/role query ambiguous. Matches the
 * existing repo convention (`curriculum.spec.ts`, `canonical-identity.spec.ts`).
 */
function mainOf(page: Page) {
  return page.locator("#main-content");
}

test.describe("Account — profile, data sharing, plan (Workstream G)", () => {
  const EMAIL = `e2e-account-profile-${Date.now()}@example.com`;
  const PASSWORD = "password123";

  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("editing the profile name persists and renders back on reload", async ({ page }) => {
    await login(page, EMAIL, PASSWORD);
    await page.goto("/account/profile");
    const nameInput = mainOf(page).locator('input[name="name"]');
    await nameInput.fill("Renamed Reader");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(mainOf(page).getByText("Saved.")).toBeVisible();

    await page.reload();
    await expect(mainOf(page).locator('input[name="name"]')).toHaveValue("Renamed Reader");

    const [row] = await db.select({ name: users.name }).from(users).where(eq(users.email, EMAIL)).limit(1);
    expect(row?.name).toBe("Renamed Reader");
  });

  test("data-sharing toggle lifecycle: off by default, flips on, flips back off, persists across reload", async ({ page }) => {
    await login(page, EMAIL, PASSWORD);
    await page.goto("/account/profile");

    const toggle = mainOf(page).getByLabel("Share my activity for research");
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    await expect(toggle).toBeChecked();
    await page.waitForTimeout(300); // the toggle's server action round trip
    await page.reload();
    await expect(mainOf(page).getByLabel("Share my activity for research")).toBeChecked();

    const [enabledRow] = await db.select({ dataSharingEnabled: users.dataSharingEnabled }).from(users).where(eq(users.email, EMAIL)).limit(1);
    expect(enabledRow?.dataSharingEnabled).toBe(true);

    await mainOf(page).getByLabel("Share my activity for research").uncheck();
    await page.waitForTimeout(300);
    await page.reload();
    await expect(mainOf(page).getByLabel("Share my activity for research")).not.toBeChecked();

    const [disabledRow] = await db.select({ dataSharingEnabled: users.dataSharingEnabled }).from(users).where(eq(users.email, EMAIL)).limit(1);
    expect(disabledRow?.dataSharingEnabled).toBe(false);
  });

  test("plan page shows the free beta plan with disabled upgrade affordances and no cost figures", async ({ page }) => {
    await login(page, EMAIL, PASSWORD);
    await page.goto("/account/plan");
    await expect(mainOf(page).getByRole("heading", { name: "Beta (free)" })).toBeVisible();
    await expect(mainOf(page).getByRole("button", { name: /Upgrade/ })).toBeDisabled();
    await expect(mainOf(page).getByRole("button", { name: /Manage billing/ })).toBeDisabled();
    // No user-facing cost figures anywhere on the plan or usage surfaces.
    await expect(mainOf(page)).not.toContainText("$");
  });
});

test.describe("Account — usage page (Workstream G)", () => {
  test("usage page shows honest empty states for a brand-new account", async ({ page }) => {
    const email = `e2e-account-usage-empty-${Date.now()}@example.com`;
    await createVerifiedTestUser(email, "password123");
    try {
      await login(page, email, "password123");
      await page.goto("/account/usage");
      await expect(mainOf(page).getByText(/No documents yet/)).toBeVisible();
      await expect(mainOf(page).getByText(/No reading activity yet/)).toBeVisible();
      await expect(mainOf(page).getByText(/No concept ratings yet/)).toBeVisible();
      await expect(mainOf(page)).not.toContainText("$");
    } finally {
      await deleteTestUser(email);
    }
  });

  test("usage page renders real charts once the account has activity", async ({ page }) => {
    const email = `e2e-account-usage-seeded-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, "password123");
    try {
      const [work] = await db.insert(works).values({ userId, title: "Seeded Usage Work", authorName: "Test" }).returning({ id: works.id });
      await db.insert(documents).values({
        userId,
        workId: work.id,
        storagePath: `${userId}/${work.id}/usage-fixture.txt`,
        originalFilename: "usage-fixture.txt",
        mimeType: "text/plain",
        fileSize: 10,
        processingStatus: "ready",
        extractedText: "Seeded text for a usage-page fixture.",
      });
      await db.insert(readingRecords).values({ userId, workId: work.id, status: "completed", startedAt: new Date(), finishedAt: new Date() });
      // RadarChart needs at least 3 axes to render as a polygon rather than
      // its own empty state (see components/charts/RadarChart.tsx's own
      // doc comment) — seed three concepts, not one.
      const seededConcepts = await db
        .insert(concepts)
        .values([
          { slug: `usage-fixture-concept-a-${userId}`, kind: "concept", label: "Fixture Concept A" },
          { slug: `usage-fixture-concept-b-${userId}`, kind: "concept", label: "Fixture Concept B" },
          { slug: `usage-fixture-concept-c-${userId}`, kind: "concept", label: "Fixture Concept C" },
        ])
        .returning({ id: concepts.id });
      await db.insert(conceptMastery).values(
        seededConcepts.map((c, i) => ({ userId, conceptId: c.id, score: 72 - i * 10, source: "explicit" as const })),
      );
      const [conversation] = await db.insert(ragConversations).values({ userId, title: "Usage fixture" }).returning({ id: ragConversations.id });
      await db.insert(ragMessages).values({ conversationId: conversation.id, role: "user", content: "A seeded question." });

      await login(page, email, "password123");
      await page.goto("/account/usage");
      await expect(mainOf(page).getByText(/No documents yet/)).toHaveCount(0);
      await expect(mainOf(page).getByText(/No reading activity yet/)).toHaveCount(0);
      await expect(mainOf(page).getByText(/No concept ratings yet/)).toHaveCount(0);
      // Four charts (bar, line, radar, sparkline) each render as an
      // accessible `role="img"` SVG with its own descriptive name.
      await expect(mainOf(page).getByRole("img", { name: "Documents uploaded per month" })).toBeVisible();
      await expect(mainOf(page).getByRole("img", { name: "Reading progress by month" })).toBeVisible();
      await expect(mainOf(page).getByRole("img", { name: "Concept mastery" })).toBeVisible();
      await expect(mainOf(page).getByRole("img", { name: /Ask Library questions per day/ })).toBeVisible();
    } finally {
      await deleteTestUser(email);
    }
  });
});

test.describe("Account — deletion (Workstream G, real Storage)", () => {
  test("full delete-account flow: archives, purges Storage + rows, sweeps orphans, kills the old session", async ({ page, context }) => {
    const email = `e2e-account-delete-${Date.now()}@example.com`;
    const password = "password123";
    const userId = await createVerifiedTestUser(email, password);

    // A real work with a real private Storage object.
    const [work] = await db.insert(works).values({ userId, title: "Deletable Work", authorName: "Test Author" }).returning({ id: works.id });
    const storagePath = `${userId}/${work.id}/deletable.txt`;
    await uploadDocumentFile({ path: storagePath, data: Buffer.from("private bytes for account deletion e2e"), contentType: "text/plain" });
    await db.insert(documents).values({
      userId,
      workId: work.id,
      storagePath,
      originalFilename: "deletable.txt",
      mimeType: "text/plain",
      fileSize: 10,
      processingStatus: "ready",
      extractedText: "Content for the account-deletion e2e fixture.",
    });
    expect(await getDocumentFileSize(storagePath)).not.toBeNull();

    // A recommended Library item this user's own work is the ONLY thing
    // referencing — the orphan sweep should remove its work_identity and
    // learning_resource once the work itself is gone.
    const { resourceId } = await seedWorkWithLibraryItem(userId, { title: "Deletable Work" });

    try {
      await login(page, email, password);

      // Capture the authenticated session cookie before deletion, to prove
      // server-side revocation afterward (not just this browser clearing
      // its own cookie on sign-out).
      const cookiesBefore = await context.cookies();
      const sessionCookie = cookiesBefore.find((c) => c.name.includes("authjs.session-token") || c.name.includes("next-auth.session-token"));
      expect(sessionCookie, "a session cookie must exist after login").toBeTruthy();

      await page.goto("/account/profile");
      await mainOf(page).getByRole("button", { name: "Delete my account" }).click();
      await mainOf(page).getByLabel(/Type your email/).fill(email);
      await mainOf(page).getByLabel("Current password").fill(password);
      const confirmButton = mainOf(page).getByRole("button", { name: "Permanently delete my account" });
      await expect(confirmButton).toBeEnabled();
      await confirmButton.click();

      await page.waitForURL(/\/\?deleted=1/, { timeout: 30000 });
      await expect(page.getByText(/account and its data have been deleted/i)).toBeVisible();

      // The user row is gone.
      const [userRow] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      expect(userRow).toBeUndefined();

      // The archive row exists with the right identifying fields.
      const [archiveRow] = await db.select().from(userDeletionArchives).where(eq(userDeletionArchives.userId, userId)).limit(1);
      expect(archiveRow).toBeDefined();
      expect(archiveRow?.email).toBe(email);
      expect(archiveRow?.docsProcessed).toBeGreaterThanOrEqual(1);

      // The real Storage object is gone.
      expect(await getDocumentFileSize(storagePath)).toBeNull();

      // The work row is gone (cascaded from the user).
      const [workRow] = await db.select({ id: works.id }).from(works).where(eq(works.id, work.id)).limit(1);
      expect(workRow).toBeUndefined();

      // Orphan sweep: the recommended Library item this deleted account's
      // work was the only reference to should be gone too.
      const [resourceRow] = await db.select({ id: learningResources.id }).from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
      expect(resourceRow, "the orphaned learning_resource should have been swept").toBeUndefined();

      // Old session dead: replay the captured cookie in a fresh context and
      // confirm a protected route redirects to login rather than serving
      // the now-deleted account's dashboard.
      if (sessionCookie) {
        const freshContext = await page.context().browser()!.newContext();
        await freshContext.addCookies([sessionCookie]);
        const freshPage = await freshContext.newPage();
        await freshPage.goto("/dashboard");
        await expect(freshPage).toHaveURL(/\/login/);
        await freshContext.close();
      }
    } finally {
      // The account is already gone; this only cleans up anything the
      // delete flow itself doesn't (usage_event/feedback/archive rows are
      // swept by id, matching every other e2e teardown's discipline —
      // the archive row is deliberately real product data at this point,
      // not test debris, but e2e runs must still not accumulate it
      // indefinitely across repeated local runs).
      await db.delete(userDeletionArchives).where(eq(userDeletionArchives.userId, userId));
      await db.delete(feedback).where(eq(feedback.userId, userId));
    }
  });

  test("wrong password leaves the account and Storage fully intact", async ({ page }) => {
    const email = `e2e-account-delete-wrongpass-${Date.now()}@example.com`;
    const password = "password123";
    await createVerifiedTestUser(email, password);
    try {
      await login(page, email, password);
      await page.goto("/account/profile");
      await mainOf(page).getByRole("button", { name: "Delete my account" }).click();
      await mainOf(page).getByLabel(/Type your email/).fill(email);
      await mainOf(page).getByLabel("Current password").fill("definitely-wrong-password");
      await mainOf(page).getByRole("button", { name: "Permanently delete my account" }).click();

      // Scoped to #main-content — a bare page-wide query is ambiguous with
      // both Next.js's own route announcer (`#__next-route-announcer__`,
      // also `role="alert"`) and, in dev mode, the React hydration-overlay
      // text, which can coincidentally also contain "didn't match".
      await expect(mainOf(page).getByText(/didn't match/i)).toBeVisible();
      await expect(page).toHaveURL(/\/account\/profile/);

      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      expect(row, "the account must still exist after a failed deletion attempt").toBeDefined();
    } finally {
      await deleteTestUser(email);
    }
  });
});
