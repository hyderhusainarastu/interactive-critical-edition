import { db, documents, pages, processingRuns, textBlocks, users, works } from "@ice/db";
import { eq } from "drizzle-orm";

/**
 * Stage 4 VERIFICATION lane (round 1) — additional seed fixtures for
 * journeys the existing `./helpers.ts` seed functions don't already cover.
 * Created here (not added to `helpers.ts`) per this lane's file-ownership
 * rule: `apps/web/e2e/helpers.ts` is off-limits to edit, so any new seed
 * shape gets its own file, following the same pattern (direct `@ice/db`
 * inserts, no worker/live-API dependency, CI-safe by construction).
 */

/**
 * Seeds a PUBLISHED v2 edition spanning TWO pages, several body blocks each
 * — the shape journey 2's "saved position" check actually needs. Read
 * directly from `EditionReader.tsx` before writing this (not guessed):
 * `onPositionChange` only fires on a `pageIndex` change (the "← Prev"/
 * "Next →" pagination controls), never from in-page scroll — there is no
 * per-paragraph IntersectionObserver on this reader the way the legacy
 * `TextReader` has (`onParagraphInView`). `helpers.ts`'s own
 * `seedPublishedEdition` is a single page, which can't distinguish this at
 * all; a scroll-based version of this fixture would silently test nothing.
 * Also gives the Document-outline rail two distinguishable header entries.
 */
export async function seedTallPublishedEdition(
  userId: string,
  opts: { title?: string },
): Promise<{ workId: string; documentId: string; runId: string }> {
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.title ?? "A Tall Edition Fixture", authorName: "Fixture Author" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/tall-edition.txt`,
      originalFilename: "tall-edition.txt",
      mimeType: "text/plain",
      fileSize: 500,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "Paragraph one of a tall fixture document.",
    })
    .returning({ id: documents.id });
  const [run] = await db
    .insert(processingRuns)
    .values({
      documentId: doc.id,
      version: 1,
      pipelineVersion: "v2",
      status: "complete",
      stage: "publish",
      structureState: "full",
      isPublished: true,
      aiCostUsd: 0,
      degraded: false,
    })
    .returning({ id: processingRuns.id });
  const [pageOne, pageTwo] = await db
    .insert(pages)
    .values([
      { runId: run.id, pageIndex: 0, isOcr: false, text: "Page one of a two-page saved-position fixture." },
      { runId: run.id, pageIndex: 1, isOcr: false, text: "Page two of a two-page saved-position fixture." },
    ])
    .returning({ id: pages.id });

  await db.insert(textBlocks).values([
    { pageId: pageOne!.id, blockOrder: 0, kind: "title" as const, text: opts.title ?? "A Tall Edition Fixture" },
    { pageId: pageOne!.id, blockOrder: 1, kind: "header" as const, text: "Section One" },
    { pageId: pageOne!.id, blockOrder: 2, kind: "body" as const, text: "First-page filler prose for a saved-position fixture." },
    { pageId: pageTwo!.id, blockOrder: 3, kind: "header" as const, text: "Section Two" },
    { pageId: pageTwo!.id, blockOrder: 4, kind: "body" as const, text: "Second-page filler prose, distinguishable from page one." },
  ]);

  return { workId: work.id, documentId: doc.id, runId: run.id };
}

/**
 * Seeds a ready work with a real `document.lastPosition` already set —
 * the exact shape `DashboardPage`'s "Continue reading" card query looks
 * for (`processingStatus = 'ready' AND lastPosition IS NOT NULL`), without
 * needing to actually scroll a reader through the UI first. Kept
 * deliberately minimal: this is Home's own query contract being exercised
 * directly, not a re-test of position-saving itself (that's
 * `seedTallPublishedEdition` + a real reader scroll, used separately).
 */
export async function seedResumableWork(
  userId: string,
  opts: { title?: string } = {},
): Promise<{ workId: string; documentId: string }> {
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.title ?? "Resumable Home Fixture", authorName: "Fixture Author" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/resumable.txt`,
      originalFilename: "resumable.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "Resumable Home fixture body text.",
      lastPosition: { kind: "text", paragraphIndex: 2 },
    })
    .returning({ id: documents.id });
  return { workId: work.id, documentId: doc.id };
}

/** Login via the real form — identical shape to every existing spec's own
 *  inline `login()` helper, hoisted here once so the new Stage 4
 *  verification specs don't each redeclare it. */
export async function loginAs(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Marks a seeded user as already onboarded (`preferences.onboardedAt`) —
 *  same pattern `accessibility-sweep.spec.ts`/`library.spec.ts`/
 *  `link-check.spec.ts` already use — so a spec that needs `/dashboard`
 *  itself to render (Home) doesn't get redirected to `/welcome` first. */
export async function markOnboarded(userId: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
}

/** Clears `document.lastPosition` for a documentId — used to reset a
 *  fixture between a "resume" assertion and an "empty state" assertion
 *  within the same seeded account, without needing a second account. */
export async function clearLastPosition(documentId: string) {
  await db.update(documents).set({ lastPosition: null }).where(eq(documents.id, documentId));
}
