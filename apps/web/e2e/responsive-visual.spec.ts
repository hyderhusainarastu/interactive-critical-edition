import { expect, test, type Page } from "@playwright/test";
import {
  concepts,
  db,
  documents,
  pages,
  passageAnnotations,
  processingRuns,
  termOccurrences,
  termVariants,
  textBlocks,
  users,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import {
  createVerifiedTestUser,
  deleteTestUser,
  seedPublishedEdition,
  seedWorkInStatus,
  seedWorkWithGraphData,
  seedWorkWithLibraryItem,
  seedWorkWithLibraryItems,
} from "./helpers";

/**
 * Phase 23.3 (responsive and visual hardening). Scope per
 * `palimnote_phases_19_23_plan_revised.md` §23.3: widths 320/375/768/1024/
 * 1280/1440+; long titles/authors, RTL direction and genuine original-script
 * text, large annotation counts, empty/large Library, one/many works, long
 * graph labels/large graph, processing failure, offline/network failure,
 * slow response, expired session; visual-regression baselines (light +
 * dark) for major pages. This file also carries the deferred VISUAL
 * confirmations for D-23-15 (app-shell header wrap at 768px) and D-23-17
 * (annotation detail card's mount-time auto-scroll) — both already fixed in
 * code (`40e87b0`, `29e6472`), confirmed here only structurally/visually,
 * not re-fixed.
 *
 * "RTL/original-script text" is deliberately split into two separate,
 * honestly-scoped checks rather than one overstated one: a plain
 * `dir="rtl"` flip on ordinary Latin text (proves layout direction alone,
 * not genuine non-Latin rendering) and a SEPARATE fixture that seeds real
 * polytonic Greek through the actual `term_variant`/`term_occurrence`
 * script-display machinery (`renderVerifiedTerms()` in `EditionReader.tsx`
 * requires the source text's own bytes at that offset to equal
 * `originalScript` exactly, so this is genuine non-Latin content, not a
 * cosmetic direction toggle).
 *
 * All work/library/graph data is SEEDED directly (no worker, no live API
 * calls) — same CI-safety precedent as curriculum.spec.ts/library.spec.ts/
 * accessibility-sweep.spec.ts. Visual-regression baselines cover every major
 * page (dashboard, Library, Reading Queue, work detail, Upload, Reader,
 * Roadmap, Knowledge Map) in light+dark and desktop+mobile. The one
 * exception is the 3D graph's own `<canvas>` (`[data-graph-canvas]`), whose
 * WebGL projection varies with device pixel ratio and container size — not
 * a stable screenshot subject, matching landing-contract.spec.ts's own
 * precedent — so the Visualization baseline masks that one region rather
 * than skipping the page entirely; the surrounding chrome (heading,
 * filters, legend, accessible table) is still real screenshot coverage.
 *
 * MEASUREMENT FREEZE HAS LIFTED, but this file's execution remains
 * sequenced by the coordinator — do not run it from this session. Once
 * cleared to run (see docs/PROJECT-LOG.md's Commands section for how to
 * start web + worker + Postgres):
 *   pnpm --filter web exec playwright test e2e/responsive-visual.spec.ts --workers=1 --update-snapshots
 *   pnpm --filter web exec playwright test e2e/responsive-visual.spec.ts --workers=1
 * (the first run creates the screenshot baselines this file references but
 * has not yet generated; the second is the real regression run.)
 */

const PASSWORD = "password123";
const WIDTHS = [320, 375, 768, 1024, 1280, 1440] as const;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Onboarded (gates /dashboard and /works — see accessibility-sweep.spec.ts),
 *  optionally with an explicit theme (workspace-shell.spec.ts's own shape). */
async function markOnboarded(userId: string, theme?: "light" | "dark") {
  await db
    .update(users)
    .set({
      preferences: {
        onboardedAt: new Date().toISOString(),
        ...(theme ? { workspace: { theme, fontSize: "medium", readingWidth: "comfortable", focusMode: false, scriptDisplay: "original" } } : {}),
      },
    })
    .where(eq(users.id, userId));
}

/** Same technique as hardening.spec.ts's existing RTL/overflow check. */
async function assertNoHorizontalOverflow(page: Page) {
  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowing).toBe(false);
}

async function seedReadyWork(userId: string, title: string, authorName: string | null): Promise<string> {
  const [work] = await db.insert(works).values({ userId, title, authorName }).returning({ id: works.id });
  await db.insert(documents).values({
    userId,
    workId: work.id,
    storagePath: `${userId}/${work.id}/none.txt`,
    originalFilename: "none.txt",
    mimeType: "text/plain",
    fileSize: 100,
    processingStatus: "ready",
    extractedText: "Seeded text for a Phase 23.3 responsive fixture.",
  });
  return work.id;
}

/**
 * A minimal published edition whose body text genuinely CONTAINS polytonic
 * Greek (not a transliteration standing in for it), with a verified
 * `term_variant`/`term_occurrence` anchored at that exact substring —
 * `renderVerifiedTerms()` (EditionReader.tsx) only treats an occurrence as
 * real when `text.slice(start, end) === term.originalScript`, so this is
 * the one seeding shape that actually exercises original-script rendering
 * rather than merely flipping `dir="rtl"` on ordinary Latin text.
 */
async function seedEditionWithOriginalScriptTerm(userId: string): Promise<{ workId: string }> {
  const bodyText = "The concept of ἀκρασία describes weakness of will in Aristotle's ethics.";
  const term = "ἀκρασία";
  const start = bodyText.indexOf(term);

  const [work] = await db.insert(works).values({ userId, title: "Original Script Fixture", authorName: "Fixture Author" }).returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/original-script.txt`,
      originalFilename: "original-script.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: bodyText,
    })
    .returning({ id: documents.id });
  const [run] = await db
    .insert(processingRuns)
    .values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true })
    .returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text: bodyText }).returning({ id: pages.id });
  const [block] = await db.insert(textBlocks).values({ pageId: page.id, blockOrder: 0, kind: "body", text: bodyText }).returning({ id: textBlocks.id });
  const [termVariant] = await db
    .insert(termVariants)
    .values({ documentId: doc.id, originalScript: term, transliteration: "akrasia", language: "grc", direction: "ltr", verificationStatus: "verified", source: "system" })
    .returning({ id: termVariants.id });
  await db.insert(termOccurrences).values({ termVariantId: termVariant.id, textBlockId: block.id, startOffset: start, endOffset: start + term.length });

  return { workId: work.id };
}

test.describe("Phase 23.3 — viewport sweep (no horizontal overflow, 320–1440px)", () => {
  const EMAIL = `e2e-responsive-sweep-${Date.now()}@example.com`;
  let userId = "";
  let editionWorkId = "";
  let graphWorkId = "";

  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
    editionWorkId = (await seedPublishedEdition(userId)).workId;
    graphWorkId = (await seedWorkWithGraphData(userId, { title: "Viewport Sweep Graph Work" })).workId;
    await seedWorkWithLibraryItem(userId, { title: "Viewport Sweep Library Work" });
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  // Named `routes`, not `pages` — this file also imports the unrelated
  // `pages` table from `@ice/db` and shadowing it here would be confusing.
  const routes: Array<{ name: string; path: () => string }> = [
    { name: "dashboard", path: () => "/dashboard" },
    { name: "library", path: () => "/library" },
    { name: "reader", path: () => `/works/${editionWorkId}/reader` },
    { name: "graph (per-work)", path: () => `/works/${graphWorkId}/graph` },
  ];

  for (const width of WIDTHS) {
    for (const { name, path } of routes) {
      test(`${name} at ${width}px has no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await login(page, EMAIL);
        await page.goto(path());
        await assertNoHorizontalOverflow(page);
      });
    }
  }
});

test.describe("Phase 23.3 — visual-regression baselines (light and dark)", () => {
  const EMAIL = `e2e-responsive-visual-${Date.now()}@example.com`;
  let userId = "";
  let editionWorkId = "";
  let roadmapWorkId = "";

  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    editionWorkId = (await seedPublishedEdition(userId)).workId;
    roadmapWorkId = (await seedWorkWithGraphData(userId, { title: "Visual Baseline Roadmap Work" })).workId;
    await seedWorkWithLibraryItem(userId, { title: "Visual Baseline Library Work" });
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  // Covers every major page (plan §23.3: "all major pages"). `heading: null`
  // means the page has no single fixed accessible heading worth asserting
  // (the reader's title is dynamic content, not a stable heading string) —
  // the screenshot itself is still full coverage. `mask` is set only for
  // Visualization's 3D canvas (see this file's header comment for why).
  const baselinePages: Array<{ name: string; path: () => string; heading: RegExp | string | null; mask?: boolean }> = [
    { name: "dashboard", path: () => "/dashboard", heading: /Welcome back/ },
    { name: "library", path: () => "/library", heading: "Library" },
    { name: "works", path: () => "/works", heading: "Reading Queue" },
    { name: "work-detail", path: () => `/works/${editionWorkId}`, heading: "Vice and Reason" },
    { name: "upload", path: () => "/upload", heading: "Upload works" },
    { name: "reader", path: () => `/works/${editionWorkId}/reader`, heading: null },
    { name: "roadmap", path: () => `/works/${roadmapWorkId}/roadmap`, heading: "Reading roadmap", mask: true },
    // The Stage 3 Knowledge Map rebuild replaced the old page-level
    // "Visualization" heading with the toolbar's own context label (the
    // work's title) — `heading: null` here plus the dedicated toolbar
    // readiness wait below is the correct successor to the old string
    // match, not a weakened assertion: the old heading string genuinely no
    // longer exists anywhere in the new `KnowledgeMapWorkspace` DOM (grep-
    // confirmed), by design, so asserting it would only ever time out.
    { name: "graph", path: () => `/works/${roadmapWorkId}/graph`, heading: null, mask: true },
  ];

  for (const { name, path, heading, mask } of baselinePages) {
    for (const theme of ["light", "dark"] as const) {
      for (const viewport of [
        { label: "desktop", width: 1440, height: 900 },
        { label: "mobile", width: 375, height: 812 },
      ]) {
        test(`${name} — ${viewport.label} — ${theme}`, async ({ page }) => {
          await markOnboarded(userId, theme);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await login(page, EMAIL);
          await page.goto(path());
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          if (heading !== null) await expect(page.getByRole("heading", { name: heading })).toBeVisible();
          // `heading: null` means the reader has no single fixed heading to
          // assert (see this array's own doc comment), but that left this
          // one page with NO readiness wait at all before the screenshot —
          // unlike every other entry here. In practice the theme==="light"
          // combinations (the default value, so the data-theme assertion
          // above resolves immediately with nothing to actually wait for)
          // reliably raced ahead of the reader's own data fetch and froze
          // the "Loading…" placeholder into the baseline (found regenerating
          // these baselines: reader-desktop-light kept re-capturing that
          // placeholder even after the route was already warm). Wait for
          // its toolbar's "Notes" control (Stage 4 read spec §4.2 merged
          // the former separate "Analysis"/"My notes" toggles into one),
          // which only renders once ReaderShell's own data has loaded.
          if (name === "reader") await expect(page.getByRole("button", { name: /^(Notes|Hide notes)/ })).toBeVisible();
          // Stage 3 rebuild: the Knowledge Map's own readiness signal is its
          // toolbar (no page heading — see the `baselinePages` row comment
          // above), so this page needs its own explicit wait, same
          // rationale as the reader's above.
          if (name === "graph") await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
          // A brief settle wait before the canvas-bearing page's screenshot —
          // same rationale as accessibility-sweep.spec.ts's own settle wait,
          // giving the 3D scene's initial mount/effects time to finish before
          // the mask is captured.
          if (mask) await page.waitForTimeout(500);
          await expect(page).toHaveScreenshot(`${name}-${viewport.label}-${theme}.png`, {
            fullPage: true,
            animations: "disabled",
            maxDiffPixelRatio: 0.01,
            // `[data-graph-canvas]` was the legacy `KnowledgeGraph3D.tsx`
            // selector — the Stage 3 rebuild's real 3D mount point is
            // `[data-testid="knowledge-map-scene"]` (see
            // `KnowledgeMapScene.tsx`). Matching the OLD, now-nonexistent
            // selector wasn't "unmasked" in any meaningful sense — it was a
            // mask option matching zero elements, silently masking nothing
            // while still being read as "the canvas is masked here" by
            // anyone skimming this file. Fixed to mask the REAL live
            // element (a real WebGL render is not byte-stable across
            // GPU/driver combinations even with a deterministic camera
            // pose/layout seed, so masking it here remains the right call —
            // charter §16's "nonblank unmasked canvas + numeric in-frustum
            // assertions" requirement is met by the dedicated
            // `knowledge-map.spec.ts` suite instead, not by this baseline
            // sweep, which is about full-page layout/theme regressions).
            ...(mask ? { mask: [page.locator('[data-testid="knowledge-map-scene"] canvas'), page.locator("[data-roadmap-canvas]")] } : {}),
          });
        });
      }
    }
  }
});

test.describe("Phase 23.3 — long titles, long authors, and RTL/original-script text", () => {
  const EMAIL = `e2e-responsive-longtext-${Date.now()}@example.com`;
  let userId = "";
  const LONG_TITLE =
    "An Extraordinarily Long Title That a Real Scholarly Monograph Might Actually Carry, Complete With a Colon and a Trailing Subtitle Clause That Keeps Going";
  const LONG_AUTHOR = "Alexandria Constantinopoulos-Featherstonehaugh von Habsburg-Lothringen the Third";

  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("a long title and author name render without overflow on works list and work detail", async ({ page }) => {
    const workId = await seedReadyWork(userId, LONG_TITLE, LONG_AUTHOR);
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, EMAIL);

    await page.goto("/works");
    await expect(page.getByRole("heading", { name: "Reading Queue" })).toBeVisible();
    await expect(page.getByText(LONG_TITLE)).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.goto(`/works/${workId}`);
    await expect(page.getByRole("heading", { name: LONG_TITLE })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("a plain RTL direction flip on ordinary Latin text does not introduce horizontal overflow on Library or the Reader", async ({ page }) => {
    // NOTE: this only flips CSS `dir` on ordinary Latin content — it proves
    // layout survives a direction change, not that genuine non-Latin script
    // renders correctly. See the separate original-script test below for
    // that (real polytonic Greek through the term_variant machinery).
    const { workId } = await seedPublishedEdition(userId);
    await seedWorkWithLibraryItem(userId, { title: "RTL direction-flip check work" });
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, EMAIL);

    // Same technique as hardening.spec.ts's existing Writer RTL check,
    // extended here to Library and the interactive reader.
    await page.goto("/library");
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    await assertNoHorizontalOverflow(page);

    await page.goto(`/works/${workId}/reader`);
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    await assertNoHorizontalOverflow(page);
  });

  test("genuine original-script (polytonic Greek) text renders in the Reader without overflow", async ({ page }) => {
    const { workId } = await seedEditionWithOriginalScriptTerm(userId);
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, EMAIL);
    await page.goto(`/works/${workId}/reader`);

    // Default `scriptDisplay` is "original" (markOnboarded's workspace
    // shape / the app's own default), so the verified term renders as the
    // real Greek characters seeded into the body text, not a transliteration.
    await expect(page.getByText("ἀκρασία")).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("Phase 23.3 — large annotation count, large graph, long graph labels", () => {
  const EMAIL = `e2e-responsive-scale-${Date.now()}@example.com`;
  let userId = "";

  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("a large annotation count renders and the notes drawer stays overflow-free at 768 and 320px", async ({ page }) => {
    const { workId, runId, bodyBlockId } = await seedPublishedEdition(userId);
    // seedPublishedEdition already seeds 2 (1 anchored + 1 whole-work);
    // add 18 more anchored passage annotations so the sidebar's index has a
    // genuinely large list, not just the fixture default.
    await db.insert(passageAnnotations).values(
      Array.from({ length: 18 }, (_, i) => ({
        runId,
        textBlockId: bodyBlockId,
        isWholeWork: false,
        quote: `Seeded stress-test annotation quote ${i}`,
        summary: `Stress-test annotation ${i} for the large-annotation-count fixture.`,
        explanation: `Explanation text for stress-test annotation ${i}, seeded to exercise a large annotation index.`,
        annotationType: "clarification" as const,
        relationship: "interpretive_aid" as const,
        readerLevel: null,
        confidence: 0.6,
      })),
    );

    for (const width of [768, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await login(page, EMAIL);
      await page.goto(`/works/${workId}/reader`);
      // Stage 4 read spec §4.2: the toggle is now "Notes" (merged
      // Analysis + My notes drawer), not "Analysis".
      await page.getByRole("button", { name: /^Notes/ }).click();
      await expect(page.getByRole("dialog", { name: "Edition sidebar" })).toBeVisible();
      // `getByText` substring-matches case-insensitively, and this fixture's
      // own seeded explanation text ends "...exercise a large annotation
      // index.", which collides with the plain-text search below (20
      // matches instead of the intended index heading). Scope to the
      // heading role, which the intended "Annotation index" h3 alone has.
      await expect(page.getByRole("heading", { name: "Annotation index" })).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
  });

  test("a long concept label and a larger graph render without overflow in the Knowledge Map", async ({ page }) => {
    const [longConcept] = await db
      .insert(concepts)
      .values({
        slug: `long-label-concept-${crypto.randomUUID().slice(0, 8)}`,
        kind: "concept",
        label: "An Unusually Long Concept Label Describing a Fine-Grained Distinction Within Peripatetic Moral Psychology",
        summary: "A concept seeded with a deliberately long label for Phase 23.3 responsive coverage.",
      })
      .returning({ id: concepts.id });

    // Eight works, each contributing nodes/edges, for a genuinely larger
    // graph than the single-work fixtures other specs use.
    for (let i = 0; i < 8; i++) {
      await seedWorkWithGraphData(userId, {
        title: `Large Graph Fixture Work ${i}`,
        conceptId: i === 0 ? longConcept.id : undefined,
        withPublicSources: i === 1,
        withRelatedSource: i === 2,
      });
    }

    await page.setViewportSize({ width: 375, height: 900 });
    await login(page, EMAIL);
    await page.goto("/graph");
    // Stage 3 Knowledge Map rebuild: a bare /graph intentionally opens the
    // context chooser rather than an implicit whole-corpus render (no page
    // heading exists anymore either way — see this file's own `graph` row
    // in `baselinePages` above) — choose one of the seeded works.
    await expect(page.getByTestId("knowledge-map-context-chooser")).toBeVisible();
    await page.getByRole("tab", { name: "Work" }).click();
    await page.getByRole("button", { name: /Large Graph Fixture Work 0/ }).click();
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    // Reload keeps the same `ctxId=` deep link, so the toolbar (not the
    // chooser) should be what comes back.
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // `concept` is a global shared catalog table (no user FK — same design
    // as `bibliographic_record`), so deleteTestUser's cascade never reaches
    // it; helpers.ts has no concepts sweep, so clean this one up directly.
    await db.delete(concepts).where(eq(concepts.id, longConcept.id));
  });
});

test.describe("Phase 23.3 — empty/large Library, one/many works", () => {
  test("an empty Library renders without overflow at 320px", async ({ page }) => {
    const email = `e2e-responsive-empty-lib-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, PASSWORD);
    await markOnboarded(userId);
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, email);
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await deleteTestUser(email);
  });

  test("a large Library (many recommended sources on one work) renders without overflow at 320 and 1440px", async ({ page }) => {
    const email = `e2e-responsive-large-lib-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, PASSWORD);
    await markOnboarded(userId);
    await seedWorkWithLibraryItems(
      userId,
      "Large Library Fixture Work",
      Array.from({ length: 20 }, (_, i) => ({
        resourceTitle: `Large Library Fixture Source ${i}`,
        relationship: (["prerequisite", "conceptual_influence", "explicit_reference", "historical_context", "optional_extension"] as const)[i % 5],
      })),
    );
    await login(page, email);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/library");
      await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
    await deleteTestUser(email);
  });

  test("one uploaded work renders without overflow at 320px", async ({ page }) => {
    const email = `e2e-responsive-one-work-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, PASSWORD);
    await markOnboarded(userId);
    await seedReadyWork(userId, "Single Work Fixture", "Fixture Author");
    await page.setViewportSize({ width: 320, height: 700 });
    await login(page, email);
    await page.goto("/works");
    await assertNoHorizontalOverflow(page);
    await deleteTestUser(email);
  });

  test("many uploaded works render without overflow at 320 and 1440px", async ({ page }) => {
    const email = `e2e-responsive-many-works-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, PASSWORD);
    await markOnboarded(userId);
    for (let i = 0; i < 12; i++) {
      await seedReadyWork(userId, `Many Works Fixture ${i}`, "Fixture Author");
    }
    await login(page, email);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/works");
      await expect(page.getByRole("heading", { name: "Reading Queue" })).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
    await deleteTestUser(email);
  });
});

test.describe("Phase 23.3 — processing failure, offline/slow network, expired session", () => {
  test("a processing-failure state renders without overflow and matches its visual baseline", async ({ page }) => {
    const email = `e2e-responsive-failed-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, PASSWORD);
    await markOnboarded(userId);
    const { workId } = await seedWorkInStatus(userId, "failed", {
      title: "Failed Processing Fixture",
      processingError: "No extractable text found. OCR was unavailable or produced no text.",
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, email);
    await page.goto(`/works/${workId}`);
    // `exact: true`: a substring match now also collides with the Library's
    // own "Unavailable — processing failed." recommendation-source status
    // labels elsewhere on this page (pre-existing staleness, unrelated to
    // this fixture) — scope to the work-status heading itself.
    await expect(page.getByText("Processing failed", { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot("work-processing-failed-mobile-light.png", {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
    await deleteTestUser(email);
  });

  test("a genuine network failure on upload shows the existing friendly error, not a blank/broken page", async ({ page }) => {
    const email = `e2e-responsive-offline-${Date.now()}@example.com`;
    await createVerifiedTestUser(email, PASSWORD);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, email);

    // A true network failure (not a structured error response) — the
    // client's own catch block (apps/web/src/app/(app)/upload/page.tsx)
    // surfaces `error.message` from the rejected fetch as the item's error.
    await page.route("**/api/works/upload/init", (route) => route.abort("failed"));
    await page.goto("/upload");
    await page.getByLabel("Choose files to upload").setInputFiles({
      name: "offline-test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("content for an offline-simulation fixture"),
    });
    await expect(page.locator('[data-upload-item="offline-test.txt"]')).toContainText("Needs attention");
    await assertNoHorizontalOverflow(page);
    await deleteTestUser(email);
  });

  test("a slow (delayed) upload response holds the uploading state through the delay window, then completes", async ({ page }) => {
    const email = `e2e-responsive-slow-${Date.now()}@example.com`;
    await createVerifiedTestUser(email, PASSWORD);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, email);

    const DELAY_MS = 2000;
    await page.route("**/api/works/upload/init", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      const payload = route.request().postDataJSON() as { name: string };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          workId: "00000000-0000-4000-8000-000000000002",
          documentId: "00000000-0000-4000-8001-000000000002",
          uploadUrl: `${new URL(page.url()).origin}/test-signed-upload/${payload.name}`,
        }),
      });
    });
    await page.route("**/test-signed-upload/**", (route) => route.fulfill({ status: 200, body: "" }));
    await page.route("**/api/works/upload/complete", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ workId: "00000000-0000-4000-8000-000000000002" }) }),
    );

    await page.goto("/upload");
    await page.getByLabel("Choose files to upload").setInputFiles({
      name: "slow-test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("content for a slow-response fixture"),
    });

    // Sample state partway through the artificial delay, with a TIGHT
    // explicit timeout rather than Playwright's default auto-retry window —
    // an unbounded `expect` here would pass identically even with a 0ms
    // delay (it would just wait past the sampling point until the request
    // eventually resolved), which is exactly what made the original version
    // of this test prove nothing. At the delay's halfway point the item
    // must still be pending and must NOT already be queued.
    const item = page.locator('[data-upload-item="slow-test.txt"]');
    await page.waitForTimeout(DELAY_MS / 2);
    await expect(item).toContainText("Uploading privately", { timeout: 200 });
    await expect(item).not.toContainText("Queued for processing", { timeout: 200 });

    // Only once the full delay elapses does the terminal state appear —
    // this is what actually proves the pending state above was gated on the
    // delayed response, not a static render that would look identical at
    // any delay length.
    await expect(item).toContainText("Queued for processing", { timeout: DELAY_MS * 2 });
    await assertNoHorizontalOverflow(page);
    await deleteTestUser(email);
  });

  test("an expired session (sessionVersion bump) redirects to a clean login page, not a broken render", async ({ page }) => {
    const email = `e2e-responsive-expired-session-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, PASSWORD);
    await markOnboarded(userId);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, email);

    // Same mechanism verified in Phase 1a (docs/PROJECT-LOG.md's Design
    // Decisions): bumping session_version invalidates every outstanding
    // JWT on its next request via the `jwt` callback. This confirms the
    // resulting redirect renders cleanly, not the revocation mechanism
    // itself (already covered elsewhere).
    await db.update(users).set({ sessionVersion: 99 }).where(eq(users.id, userId));
    await page.goto("/dashboard");
    await page.waitForURL("**/login**");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await deleteTestUser(email);
  });
});

test.describe("Phase 23.3 — D-23-15 and D-23-17 visual confirmations", () => {
  test("D-23-15: the header nav and quick theme toggle no longer overlap at 768px", async ({ page }) => {
    const email = `e2e-responsive-d23-15-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, PASSWORD);
    await markOnboarded(userId);
    await page.setViewportSize({ width: 768, height: 700 });
    await login(page, email);
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation", { name: "Primary navigation" });
    // A plain `<div aria-label>`, not a form control — `getByLabel` is
    // reliable only for label-associated form elements, so an attribute
    // selector is the robust match here regardless of element type.
    const themeToggle = page.locator('[aria-label="Quick light or dark switch"]');
    const navBox = await nav.boundingBox();
    const toggleBox = await themeToggle.boundingBox();
    expect(navBox, "primary nav should be visible at 768px (md breakpoint)").not.toBeNull();
    expect(toggleBox, "quick theme toggle should be visible at 768px (sm breakpoint)").not.toBeNull();
    if (navBox && toggleBox) {
      const overlapsX = navBox.x < toggleBox.x + toggleBox.width && toggleBox.x < navBox.x + navBox.width;
      const overlapsY = navBox.y < toggleBox.y + toggleBox.height && toggleBox.y < navBox.y + navBox.height;
      expect(overlapsX && overlapsY, "nav and theme toggle bounding boxes must not overlap").toBe(false);
    }
    await assertNoHorizontalOverflow(page);

    // `page.locator("header")` is ambiguous on /dashboard: besides the
    // app-shell's own sticky header, the dashboard page renders its own
    // in-page section `<header>`s (e.g. per-section PageHeader markup),
    // so a bare tag selector strict-mode-violates with 3 matches. The
    // app-shell header is the only one nested directly under <body>
    // (not inside <section>/<article>/<main>), so it's the sole element
    // with the implicit `banner` landmark role — `getByRole("banner")`
    // targets it unambiguously.
    await expect(page.getByRole("banner")).toHaveScreenshot("app-shell-header-768-light.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });
    await deleteTestUser(email);
  });

  test("D-23-17: opening the narrow notes drawer does not auto-scroll the filter row out of view", async ({ page }) => {
    const email = `e2e-responsive-d23-17-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, PASSWORD);
    await markOnboarded(userId);
    const { workId } = await seedPublishedEdition(userId);
    // 768px is below the reader's 1024px sticky-sidebar breakpoint
    // (useNarrowViewport), so the notes drawer renders as the bottom-sheet
    // dialog the original defect was reported in. Stage 4 read spec §4.2:
    // the toggle is "Notes" now (merged Analysis + My notes drawer).
    await page.setViewportSize({ width: 768, height: 700 });
    await login(page, email);
    await page.goto(`/works/${workId}/reader`);

    await page.getByRole("button", { name: /^Notes/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edition sidebar" });
    await expect(dialog).toBeVisible();

    // The regression (D-23-17): PassageAnnotationCard's mount-time
    // scrollIntoView({block:"center"}) fired unconditionally, scrolling the
    // "Reader level" filter row (a non-sticky sibling above the annotation
    // list) out of view even though nothing was ever actively selected. The
    // fix gates that scroll on a real `activationId` match, so on a plain
    // drawer open (no marker/index click yet) the filter row must still be
    // in view with no scroll having happened.
    await expect(dialog.getByText("Reader level")).toBeInViewport();
    const scrollTop = await dialog.locator(".overflow-y-auto").first().evaluate((el) => el.scrollTop);
    expect(scrollTop).toBe(0);
    await deleteTestUser(email);
  });
});
