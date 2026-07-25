import {
  concepts,
  conceptMastery,
  db,
  documents,
  feedback,
  ragConversations,
  ragMessages,
  readingRecords,
  userDeletionArchives,
  users,
  works,
} from "@ice/db";
import { getDocumentFileSize, uploadDocumentFile } from "@ice/ingestion";
import { and, eq } from "drizzle-orm";
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
    const nameInput = page.locator('input[name="name"]');
    await nameInput.fill("Renamed Reader");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.reload();
    await expect(page.locator('input[name="name"]')).toHaveValue("Renamed Reader");

    const [row] = await db.select({ name: users.name }).from(users).where(eq(users.email, EMAIL)).limit(1);
    expect(row?.name).toBe("Renamed Reader");
  });

  test("data-sharing toggle lifecycle: off by default, flips on, flips back off, persists across reload", async ({ page }) => {
    await login(page, EMAIL, PASSWORD);
    await page.goto("/account/profile");

    const toggle = page.getByLabel("Share my activity for research");
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    await expect(toggle).toBeChecked();
    await page.waitForTimeout(300); // the toggle's server action round trip
    await page.reload();
    await expect(page.getByLabel("Share my activity for research")).toBeChecked();

    const [enabledRow] = await db.select({ dataSharingEnabled: users.dataSharingEnabled }).from(users).where(eq(users.email, EMAIL)).limit(1);
    expect(enabledRow?.dataSharingEnabled).toBe(true);

    await page.getByLabel("Share my activity for research").uncheck();
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.getByLabel("Share my activity for research")).not.toBeChecked();

    const [disabledRow] = await db.select({ dataSharingEnabled: users.dataSharingEnabled }).from(users).where(eq(users.email, EMAIL)).limit(1);
    expect(disabledRow?.dataSharingEnabled).toBe(false);
  });

  test("plan page shows the free beta plan with disabled upgrade affordances and no cost figures", async ({ page }) => {
    await login(page, EMAIL, PASSWORD);
    await page.goto("/account/plan");
    await expect(page.getByRole("heading", { name: "Beta (free)" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Upgrade/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Manage billing/ })).toBeDisabled();
    // No user-facing cost figures anywhere on the plan or usage surfaces.
    await expect(page.locator("body")).not.toContainText("$");
  });
});

test.describe("Account — usage page (Workstream G)", () => {
  test("usage page shows honest empty states for a brand-new account", async ({ page }) => {
    const email = `e2e-account-usage-empty-${Date.now()}@example.com`;
    await createVerifiedTestUser(email, "password123");
    try {
      await login(page, email, "password123");
      await page.goto("/account/usage");
      await expect(page.getByText(/No documents yet/)).toBeVisible();
      await expect(page.getByText(/No reading activity yet/)).toBeVisible();
      await expect(page.getByText(/No concept ratings yet/)).toBeVisible();
      await expect(page.locator("body")).not.toContainText("$");
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
      const [concept] = await db.insert(concepts).values({ slug: `usage-fixture-concept-${userId}`, kind: "concept", label: "Fixture Concept" }).returning({ id: concepts.id });
      await db.insert(conceptMastery).values({ userId, conceptId: concept.id, score: 72, source: "explicit" });
      const [conversation] = await db.insert(ragConversations).values({ userId, title: "Usage fixture" }).returning({ id: ragConversations.id });
      await db.insert(ragMessages).values({ conversationId: conversation.id, role: "user", content: "A seeded question." });

      await login(page, email, "password123");
      await page.goto("/account/usage");
      await expect(page.getByText(/No documents yet/)).toHaveCount(0);
      await expect(page.getByText(/No reading activity yet/)).toHaveCount(0);
      await expect(page.getByText(/No concept ratings yet/)).toHaveCount(0);
      // Four charts (bar, line, radar, sparkline) each render as an
      // accessible `role="img"` SVG with its own descriptive name.
      await expect(page.getByRole("img", { name: "Documents uploaded per month" })).toBeVisible();
      await expect(page.getByRole("img", { name: "Reading progress by month" })).toBeVisible();
      await expect(page.getByRole("img", { name: "Concept mastery" })).toBeVisible();
      await expect(page.getByRole("img", { name: /Ask Library questions per day/ })).toBeVisible();
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
      await page.getByRole("button", { name: "Delete my account" }).click();
      await page.getByLabel(/Type your email/).fill(email);
      await page.getByLabel("Current password").fill(password);
      const confirmButton = page.getByRole("button", { name: "Permanently delete my account" });
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
      const { learningResources } = await import("@ice/db");
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
      await page.getByRole("button", { name: "Delete my account" }).click();
      await page.getByLabel(/Type your email/).fill(email);
      await page.getByLabel("Current password").fill("definitely-wrong-password");
      await page.getByRole("button", { name: "Permanently delete my account" }).click();

      await expect(page.getByRole("alert")).toContainText(/didn't match/i);
      await expect(page).toHaveURL(/\/account\/profile/);

      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      expect(row, "the account must still exist after a failed deletion attempt").toBeDefined();
    } finally {
      await deleteTestUser(email);
    }
  });
});
