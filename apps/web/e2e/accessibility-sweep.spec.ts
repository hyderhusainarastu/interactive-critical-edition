import AxeBuilder from "@axe-core/playwright";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import {
  auditTouchTargets,
  createVerifiedTestUser,
  deleteTestUser,
  seedPublishedEdition,
  seedWorkWithConcepts,
  seedWorkWithGraphData,
  seedWorkWithLibraryItems,
} from "./helpers";

/**
 * Phase 19 accessibility audit (§19.8): axe on every major authenticated
 * route. Before this file, automated axe coverage existed only for the
 * landing/privacy/terms pages (landing.spec.ts) and Writer
 * (hardening.spec.ts) — every other authenticated route had never been
 * scanned. All work data is seeded directly (no real upload/worker/live
 * API calls), matching curriculum.spec.ts/diagnostic.spec.ts/library.spec.ts's
 * own CI-safety reasoning: nothing here needs a running worker.
 *
 * Manual VoiceOver verification (the plan's other §19.8 requirement) is out
 * of scope for this agent — no macOS Accessibility API access — and is
 * recorded as an open item rather than silently skipped.
 */

const EMAIL = `e2e-a11y-sweep-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * A brief settle wait before every scan. Found via this sweep (D-19-8):
 * axe run immediately after `page.goto()` resolves caught a genuinely
 * transient state on /upload and /library — reported foreground colors
 * (`#e5e4e0`/`#e9e7e2`) matched neither this app's light- nor dark-theme
 * `--color-text`/`--color-text-muted` tokens, consistent with a CSS
 * `color` transition (`.app-control`'s `.16s ease`) caught mid-flight
 * rather than a real, stable, wrong-token bug — manually re-reading the
 * same elements' `getComputedStyle` a moment later showed the correct
 * light-theme color every time. 300ms is generous relative to the
 * longest transition/animation duration in `globals.css` (0.28s).
 */
async function scan(page: Page) {
  await page.waitForTimeout(300);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}

test.describe("Accessibility sweep (Phase 19.8)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    // Onboarding itself is covered by onboarding.spec.ts; this sweep needs a
    // user who has already completed it, so /dashboard and /works/trash
    // (both gate on preferences.onboardedAt) don't redirect to /welcome.
    await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("dashboard", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("upload", async ({ page }) => {
    await login(page);
    await page.goto("/upload");
    await expect(page.getByRole("heading", { name: "Upload works" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("library", async ({ page }) => {
    await seedWorkWithLibraryItems(userId, "Library Sweep Work", [
      { resourceTitle: "Prior Analytics", relationship: "prerequisite" },
    ]);
    await login(page);
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("works list and work detail", async ({ page }) => {
    const { workId } = await seedPublishedEdition(userId);
    await login(page);
    await page.goto("/works");
    expect((await scan(page)).violations).toEqual([]);

    await page.goto(`/works/${workId}`);
    expect((await scan(page)).violations).toEqual([]);
  });

  test("reader", async ({ page }) => {
    const { workId } = await seedPublishedEdition(userId);
    await login(page);
    await page.goto(`/works/${workId}/reader`);
    expect((await scan(page)).violations).toEqual([]);
  });

  test("roadmap and per-work graph", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: "Roadmap Sweep Work" });
    await login(page);
    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);

    await page.goto(`/works/${workId}/graph`);
    // The Stage 3 Knowledge Map rebuild has no page-level heading (its
    // readiness signal is the toolbar itself — the successor pattern used
    // across every stale "Visualization" heading locator in this suite).
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("curriculum", async ({ page }) => {
    const { workId } = await seedWorkWithLibraryItems(userId, "Curriculum Sweep Work", [
      { resourceTitle: "Posterior Analytics", relationship: "prerequisite" },
    ]);
    await login(page);
    await page.goto(`/works/${workId}/curriculum`);
    await expect(page.getByRole("heading", { name: "Curriculum" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("diagnostic", async ({ page }) => {
    const { workId } = await seedWorkWithConcepts(userId, { title: "Diagnostic Sweep Work" });
    await login(page);
    await page.goto(`/works/${workId}/diagnostic`);
    await expect(page.getByRole("heading", { name: "Concept check" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("global Knowledge Map", async ({ page }) => {
    await seedWorkWithGraphData(userId, { title: "Global Graph Sweep Work" });
    await login(page);
    await page.goto("/graph");
    // A bare `/graph` intentionally opens the context chooser rather than an
    // implicit whole-corpus render (Stage 3 rebuild, `app/(app)/graph/page.tsx`'s
    // own doc comment) — a genuinely new page state the pre-Stage-3
    // "Visualization" heading assertion never scanned at all. Scan it, then
    // choose a context and scan the resulting workspace too.
    await expect(page.getByTestId("knowledge-map-context-chooser")).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);

    await page.getByRole("tab", { name: "Work" }).click();
    await page.getByRole("button", { name: /Global Graph Sweep Work/ }).click();
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("trash", async ({ page }) => {
    await login(page);
    await page.goto("/works/trash");
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("Ask Library", async ({ page }) => {
    await login(page);
    await page.goto("/ask-library");
    await expect(page.getByRole("heading", { name: "Ask your Library", level: 1 })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  /**
   * Phase 22.6 gate axe extension, retargeted for the Stage 3 Knowledge Map
   * rebuild (stage3-kmap-verification.md §2.1 deleted `GraphView.tsx` and
   * its "Roadmap for" root-work popover / progress strip / "Why this, here"
   * roadmap disclosure entirely — that reasoning now lives only on the
   * dedicated `/works/[workId]/roadmap` page, confirmed by grep to have no
   * replacement anywhere in `components/knowledge-map/`, so there is
   * nothing left to retarget those three specific controls to). The
   * pre-existing "roadmap and per-work graph"/"global Knowledge Map" tests
   * above only scan the Knowledge Map in its closed-shell default state;
   * this test drives it into its real EXPANDED states instead — the
   * "More…" secondary menu and a selected node's Inspector drawer — so axe
   * actually exercises those open surfaces too, not just their closed shell.
   */
  test("Knowledge Map — expanded controls (More menu, selected-node inspector)", async ({ page }) => {
    // Two independent seeded works (own bib/concept pairs, no edge between
    // them) on the GLOBAL /graph, so selecting one leaves the other's node(s)
    // provably unconnected and therefore dimmed by the default "Focus
    // selected" focus mode (`graphFocus.ts`) — deterministically, from this
    // test's own fixtures, not dependent on what earlier tests in this file
    // happened to leave in this user's library.
    await seedWorkWithGraphData(userId, { title: "Roadmap Layout Axe Sweep Work A" });
    await seedWorkWithGraphData(userId, { title: "Roadmap Layout Axe Sweep Work B" });
    await login(page);
    await page.goto("/graph");
    // A bare /graph opens the context chooser first (Stage 3 rebuild, see
    // the "global Knowledge Map" test above) — choose Work A.
    await expect(page.getByTestId("knowledge-map-context-chooser")).toBeVisible();
    await page.getByRole("tab", { name: "Work" }).click();
    await page.getByRole("button", { name: /Roadmap Layout Axe Sweep Work A/ }).click();
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();

    // Open the "More…" secondary menu (Arrange mode, orientation presets,
    // diagnostics) and leave it open for the scan.
    const moreButton = page.getByRole("button", { name: "More…" });
    await moreButton.click();
    await expect(page.getByRole("menu", { name: "Arrange, orientation, and diagnostics" })).toBeVisible();

    // Select the cited "Physics" node via the List view (the accessible node
    // browser's modern successor) to populate the Inspector drawer, leaving
    // both the menu and the inspector open together for the scan.
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByTestId("knowledge-map-list-view")).toBeVisible();
    await page.locator("[data-graph-node]").filter({ hasText: "Physics" }).click();
    await expect(page.getByTestId("knowledge-map-inspector")).toBeVisible();

    expect((await scan(page)).violations).toEqual([]);
  });
});

/**
 * Phase 23.2 (accessibility completion): 200% zoom / reflow, touch targets,
 * streaming live-region semantics, and dialog focus restoration — the
 * remaining verifiable gaps after the axe sweeps above (manual VoiceOver
 * stays a documented agent limitation; see the module docblock).
 */
test.describe("Phase 23.2 accessibility completion", () => {
  let zoomUserId = "";
  const ZOOM_EMAIL = `e2e-a11y-2xzoom-${Date.now()}@example.com`;
  const ZOOM_PASSWORD = "password123";

  test.beforeAll(async () => {
    zoomUserId = await createVerifiedTestUser(ZOOM_EMAIL, ZOOM_PASSWORD);
    await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, zoomUserId));
  });
  test.afterAll(async () => {
    await deleteTestUser(ZOOM_EMAIL);
  });

  async function zoomLogin(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ZOOM_EMAIL);
    await page.getByLabel("Password").fill(ZOOM_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
  }

  /**
   * Playwright has no literal browser-zoom emulation. The standard way to
   * test WCAG 1.4.10 Reflow is to resize the viewport to the CSS-pixel
   * equivalent of the zoomed state: halving both dimensions of a 1280x800
   * window reproduces what that same window looks like once its content is
   * magnified 200% — the technique manual testers use when a real zoomed
   * browser isn't available. This is a genuinely geometric fact (is there
   * hidden horizontal overflow at this viewport), not a case where an
   * ancestor's own box could make `getBoundingClientRect()` lie the way the
   * PROJECT-LOG's reading-width lesson describes — there is no computed-style
   * substitute for "does the document overflow", so measuring
   * `scrollWidth`/`clientWidth` directly is the right tool here.
   */
  async function assertNoHiddenHorizontalOverflow(page: Page) {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, "document should not overflow horizontally at the 200%-zoom-equivalent viewport").toBeLessThanOrEqual(clientWidth);
  }

  test("reader reflows at 200% zoom without horizontal overflow or lost controls", async ({ page }) => {
    const { workId } = await seedPublishedEdition(zoomUserId);
    await zoomLogin(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/works/${workId}/reader`);
    await expect(page.getByRole("button", { name: "Ask Library" })).toBeVisible();
    await page.setViewportSize({ width: 640, height: 400 });
    await expect(page.getByRole("button", { name: "Ask Library" })).toBeVisible();
    await assertNoHiddenHorizontalOverflow(page);
  });

  test("Library reflows at 200% zoom without horizontal overflow or lost controls", async ({ page }) => {
    await seedWorkWithLibraryItems(zoomUserId, "Zoom Sweep Library Work", [
      { resourceTitle: "Zoom Sweep Resource", relationship: "prerequisite" },
    ]);
    await zoomLogin(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await page.setViewportSize({ width: 640, height: 400 });
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await assertNoHiddenHorizontalOverflow(page);
  });

  test("Knowledge Map reflows at 200% zoom without horizontal overflow or lost controls", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(zoomUserId, { title: "Zoom Sweep Roadmap Work" });
    await zoomLogin(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/works/${workId}/graph`);
    // Stage 3 Knowledge Map rebuild: no page-level heading or roadmap
    // progress strip (both retired — see the "expanded controls" test
    // above) — the toolbar itself is the readiness signal.
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
    await page.setViewportSize({ width: 640, height: 400 });
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
    await assertNoHiddenHorizontalOverflow(page);
  });

  test("RAG sidebar reflows at 200% zoom without horizontal overflow or lost controls", async ({ page }) => {
    const { workId } = await seedPublishedEdition(zoomUserId);
    await zoomLogin(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/works/${workId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await page.setViewportSize({ width: 640, height: 400 });
    await expect(chat).toBeVisible();
    await expect(chat.getByRole("button", { name: "Close chat" })).toBeVisible();
    await assertNoHiddenHorizontalOverflow(page);
  });

  /**
   * DOM-measurement audit for a 44x44 CSS-pixel touch-target minimum (a
   * stricter, self-imposed floor above WCAG 2.5.8 Level AA's 24px, matching
   * common mobile-platform touch-target guidance). Scoped to `<button>`,
   * `[role="button"]`, and `<summary>` (disclosure triggers): native
   * `<input>`/`<select>` controls are excluded under SC 2.5.8's own "user
   * agent control" exception (their target is rendered and sized by the
   * browser, not this app), and an `<a>` whose parent is a running block of
   * text (`<p>`/`<li>`/inline `<span>`) is excluded under the SC's "inline"
   * exception. A `role="separator"` drag handle (the RAG sidebar's own
   * resize rail) is excluded for the same reason WCAG doesn't apply this SC
   * to native scrollbars — its function is continuous dragging along an
   * axis, not a discrete tap target. `.reader-footnote-marker`/
   * `.reader-annotation-marker` (superscript glyphs inserted directly into
   * running prose by `highlightDom.ts`'s marker helpers) are the same
   * "inline in a sentence" exception in substance even though they're
   * `<button>`, not `<a>` — enlarging an inline citation-style marker to
   * 44px would make it a giant dot in the middle of a sentence, not a
   * usability improvement. A closed `<details>`'s own non-`<summary>`
   * descendants are excluded too — Chromium keeps reporting a nonzero
   * `getBoundingClientRect()` for content the disclosure has actually
   * collapsed (unlike a hard `display:none`), so without this check the
   * audit would flag targets no real user can currently reach at all; the
   * `<summary>` trigger itself is always still measured.
   *
   * The remaining categories below are genuine, currently-below-the-floor
   * controls this audit REPORTS rather than silently resizes: dense,
   * secondary-action toolbars/panels (the reader's toolbar row and
   * `EditionAnnotationsPanel` sidebar, the Visualization layout/roadmap
   * toolbar, the 3D stage's viewer controls, and the accessible
   * node-browser table) where a blanket 44px floor would require redesigning
   * an entire information-dense surface, not a padding/size-only fix.
   * Marked structurally (`data-dense-controls`, plus the graph's own
   * existing `data-graph-roadmap-progress`/`data-graph-stage`/
   * `aria-label="Accessible graph browser"` hooks, and the annotations
   * panel's own `aria-label="Edition sidebar"`) so this stays reviewable
   * and any NEW small control OUTSIDE these named regions still fails.
   *
   * D-25-10: the audit function itself now lives in `helpers.ts`'s
   * `auditTouchTargets` (imported above) so the research-workspace specs
   * that also needed it don't duplicate this DOM-measurement logic.
   */

  test("reader controls meet the 44x44 touch-target minimum", async ({ page }) => {
    const { workId } = await seedPublishedEdition(zoomUserId);
    await zoomLogin(page);
    await page.goto(`/works/${workId}/reader`);
    await expect(page.getByRole("button", { name: "Ask Library" })).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);

    // The text-selection popover (EditionReader's own "Selected text
    // actions" toolbar, incl. the highlight-color swatches) only mounts
    // once text is selected — the audit above, run on plain page load,
    // never sees it, which is exactly how the popover's swatches shipped
    // at 24x24 (D-23-x) without this test ever catching it. Select real
    // text and re-audit with the popover actually open.
    const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
    const block = edition.locator('[id^="block-"]').filter({ hasText: "Vicious people act on decision" });
    await block.evaluate((el) => {
      const textNode = el.childNodes[0];
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 7);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await block.dispatchEvent("mouseup");
    await expect(page.getByRole("toolbar", { name: "Selected text actions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "gold highlight" })).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
  });

  test("Library controls meet the 44x44 touch-target minimum", async ({ page }) => {
    await seedWorkWithLibraryItems(zoomUserId, "Touch Target Library Work", [
      { resourceTitle: "Touch Target Resource", relationship: "prerequisite" },
    ]);
    await zoomLogin(page);
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
  });

  test("Knowledge Map controls meet the 44x44 touch-target minimum", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(zoomUserId, { title: "Touch Target Roadmap Work" });
    await zoomLogin(page);
    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
  });

  test("RAG sidebar controls meet the 44x44 touch-target minimum", async ({ page }) => {
    const { workId } = await seedPublishedEdition(zoomUserId);
    await zoomLogin(page);
    await page.goto(`/works/${workId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
  });

  // D-23-x: the RAG panel's message list is a chat-style log — new entries
  // append over time and the order is meaningful — which is exactly the
  // case WAI-ARIA's `log` role exists for (implies `aria-live="polite"`,
  // `aria-relevant="additions"` by default). The panel previously only had a
  // bare `aria-live="polite"` div with no role, leaving assistive tech to
  // guess at the relationship between old and newly-announced content.
  test("RAG panel's answer region uses log live-region semantics", async ({ page }) => {
    const { workId } = await seedPublishedEdition(zoomUserId);
    await zoomLogin(page);
    await page.goto(`/works/${workId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    const log = chat.getByRole("log");
    await expect(log).toBeVisible();
    await expect(log).toHaveAttribute("aria-live", "polite");
  });

  // D-23-x: the "Roadmap for" root-work popover (GraphView.tsx) followed
  // the visible-disclosure convention (aria-expanded/aria-controls) but,
  // unlike every other reader-shell/graph disclosure this codebase brought
  // to the D-19-18/19/20 standard, had no Escape-to-close and no
  // trigger-focus restoration at all. The Stage 3 Knowledge Map rebuild
  // deleted that popover entirely with no replacement (see the "expanded
  // controls" test above) — retargeted here to the toolbar's own real
  // "More…" secondary menu, the same disclosure shape, which DOES wire
  // `useDialogEscape` with a focus-restore callback (`KnowledgeMapToolbar.tsx`).
  test("Knowledge Map 'More…' menu supports Escape-to-close and trigger-focus restoration", async ({ page }) => {
    await seedWorkWithGraphData(zoomUserId, { title: "Roadmap Popover Focus Sweep Work" });
    await zoomLogin(page);
    await page.goto("/graph");
    await expect(page.getByTestId("knowledge-map-context-chooser")).toBeVisible();
    await page.getByRole("tab", { name: "Work" }).click();
    await page.getByRole("button", { name: /Roadmap Popover Focus Sweep Work/ }).click();
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();

    const trigger = page.getByRole("button", { name: "More…" });
    await trigger.focus();
    await trigger.click();
    const popover = page.getByRole("menu", { name: "Arrange, orientation, and diagnostics" });
    await expect(popover).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  // D-23-x: a competency notice's "Undo" control replaces its own list item
  // with static text once the undo succeeds — the button the user just
  // activated unmounts, and with nothing else claiming focus a browser
  // silently drops it back to `document.body`, which is exactly the kind
  // of focus-loss this codebase's other Phase 19/22 disclosure fixes were
  // written to prevent. The whole competency-signal pipeline (§3.2-§3.5) is
  // LLM/DB-backed and flag-gated dormant in production, so this test drives
  // the client component through mocked SSE/API responses rather than a
  // live provider call — deterministic, no cost, no DB seeding — and
  // exercises exactly the DOM/focus behavior in question.
  test("competency notice 'Undo' keeps focus reachable instead of losing it to the page body", async ({ page }) => {
    const { workId } = await seedPublishedEdition(zoomUserId);
    await zoomLogin(page);

    const notice = {
      signalId: "mock-signal-1",
      targetKind: "concept" as const,
      targetId: "mock-concept-1",
      label: "akrasia",
      level: "partial" as const,
      quote: "I think I follow the akrasia point",
      previousScore: null,
      newScore: 55,
    };

    await page.route("**/api/rag/conversations", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({ json: { conversation: { id: "mock-conv-1" } } });
    });
    await page.route("**/api/rag/conversations/mock-conv-1", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const now = new Date().toISOString();
      const body = [
        // `claimCitations` is always present (default `[]`) on every real
        // message the server builds (`buildRagMessageView` in
        // `src/lib/ragData.ts`) — `MessageCard` reads
        // `message.claimCitations.length` unconditionally, so a mock message
        // missing this field crashes the render with "Cannot read properties
        // of undefined (reading 'length')" the moment this test actually
        // renders a full turn (unlike its sibling tests in this file, which
        // only open the panel without sending a message).
        `event: user\ndata: ${JSON.stringify({ id: "mock-user-1", role: "user", content: "Do I understand akrasia?", citations: [], claimCitations: [], createdAt: now, latencyMs: null })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "Akrasia is acting against one's own better judgment. " })}\n\n`,
        `event: competency\ndata: ${JSON.stringify(notice)}\n\n`,
        `event: done\ndata: ${JSON.stringify({ message: { id: "mock-assistant-1", role: "assistant", content: "Akrasia is acting against one's own better judgment.", citations: [], claimCitations: [], createdAt: now, latencyMs: 12 }, notFound: false })}\n\n`,
      ].join("");
      await route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body });
    });
    await page.route("**/api/rag/competency-signals/mock-signal-1/undo", async (route) => {
      await route.fulfill({ json: {} });
    });

    await page.goto(`/works/${workId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("Do I understand akrasia?");
    await chat.getByRole("button", { name: "Ask" }).click();

    const noticeToggle = chat.getByRole("button", { name: /Noted: .akrasia./ });
    await expect(noticeToggle).toBeVisible();
    await noticeToggle.click();
    await expect(noticeToggle).toHaveAttribute("aria-expanded", "true");

    const undoButton = chat.getByRole("button", { name: "Undo" });
    await undoButton.focus();
    await undoButton.click();
    await expect(chat.getByText("Undone:", { exact: false })).toBeVisible();
    const activeElementIsBody = await page.evaluate(() => document.activeElement === document.body);
    expect(activeElementIsBody, "focus should not silently fall back to <body> once the Undo control unmounts").toBe(false);
  });

  // Workstream G (v.5): the new /account/* pages had never been scanned.
  // Uses THIS describe block's own `zoomLogin`/`ZOOM_EMAIL` fixture, not the
  // file-level `login`/`EMAIL` — those belong to the sibling
  // "Accessibility sweep (Phase 19.8)" describe above and its `beforeAll`
  // only runs when a test from THAT block is selected. Calling the wrong
  // one silently logs in with a user that was never created whenever these
  // tests are run in isolation (e.g. `-g "account"`) — a real bug this
  // sweep's own live run caught.
  test("account/profile", async ({ page }) => {
    await zoomLogin(page);
    await page.goto("/account/profile");
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("account/profile — delete-account danger zone expanded", async ({ page }) => {
    await zoomLogin(page);
    await page.goto("/account/profile");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByLabel(/Type your email/)).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("account/usage", async ({ page }) => {
    await zoomLogin(page);
    await page.goto("/account/usage");
    await expect(page.getByRole("heading", { name: "Documents uploaded" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("account/plan", async ({ page }) => {
    await zoomLogin(page);
    await page.goto("/account/plan");
    await expect(page.getByRole("heading", { name: "Beta (free)" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });
});
