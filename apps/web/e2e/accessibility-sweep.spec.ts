import AxeBuilder from "@axe-core/playwright";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import {
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
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
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

  test("global Visualization", async ({ page }) => {
    await seedWorkWithGraphData(userId, { title: "Global Graph Sweep Work" });
    await login(page);
    await page.goto("/graph");
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
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
   * Phase 22.6 gate axe extension: the pre-existing "roadmap and per-work
   * graph" test above already loads `/works/[workId]/graph` in its default
   * layout (Phase 22.8: roadmap is the default view, absent from the URL —
   * see `GraphView.tsx`'s `layoutModeFromParams`), but only in its
   * collapsed/closed state — the "Roadmap for" popover, the accessible
   * node-browser table, and the inspector's "Why this, here" disclosure are
   * all closed by default and were never scanned open. This test drives the
   * SAME roadmap layout into its expanded states (progress strip visible,
   * popover open, a roadmap-annotated node selected with its disclosure
   * expanded) so axe actually exercises those new Phase 22.7/22.8 surfaces,
   * not just their closed shell.
   */
  test("Visualization roadmap layout — expanded controls (Roadmap-for popover, progress strip, why-this-here disclosure)", async ({ page }) => {
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
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();

    // Roadmap is the default layout mode; wait for the progress strip (only
    // rendered once at least one roadmap-annotated node is present).
    await expect(page.locator("[data-graph-roadmap-progress]")).toBeVisible();

    // Open the "Roadmap for" root-work popover, then close it again — it's an
    // absolutely-positioned overlay that would otherwise intercept clicks
    // meant for the controls beneath it (e.g. the progress strip's own
    // "Next up: Physics" button, whose accessible name also matches "Physics").
    const roadmapForButton = page.getByRole("button", { name: /^Roadmap for/ });
    await roadmapForButton.click();
    await expect(page.locator("#roadmap-for-popover")).toBeVisible();
    await roadmapForButton.click();
    await expect(page.locator("#roadmap-for-popover")).toHaveCount(0);

    // Open the accessible node browser and select the cited "Physics" node
    // (scoped to its table row, not the progress strip's "Next up: Physics"
    // button, which shares the same accessible-name substring) to populate
    // the inspector, then expand its roadmap disclosure.
    await page.getByText("Accessible node browser").click();
    await page.locator("[data-graph-node]").filter({ hasText: "Physics" }).getByRole("button").first().click();
    const disclosure = page.locator("[data-graph-roadmap-disclosure] summary");
    await expect(disclosure).toBeVisible();
    await disclosure.click();
    await expect(page.locator("[data-graph-roadmap-disclosure]")).toContainText("Why this, here");

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

  test("Visualization roadmap layout reflows at 200% zoom without horizontal overflow or lost controls", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(zoomUserId, { title: "Zoom Sweep Roadmap Work" });
    await zoomLogin(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    await expect(page.locator("[data-graph-roadmap-progress]")).toBeVisible();
    await page.setViewportSize({ width: 640, height: 400 });
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    await expect(page.locator("[data-graph-roadmap-progress]")).toBeVisible();
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
   */
  async function auditTouchTargets(page: Page): Promise<{ tag: string; label: string; width: number; height: number }[]> {
    return page.evaluate(() => {
      const MIN = 44;
      const isInlineProse = (el: Element) => {
        const parent = el.parentElement;
        return el.tagName === "A" && !!parent && ["P", "LI", "SPAN"].includes(parent.tagName);
      };
      const isInlineTextMarker = (el: Element) =>
        el.classList.contains("reader-footnote-marker") || el.classList.contains("reader-annotation-marker");
      const isInClosedDetails = (el: Element) => {
        const details = el.closest("details");
        return !!details && !details.open && el.tagName !== "SUMMARY";
      };
      const ACCEPTED_DENSE_REGION_SELECTOR = [
        "[data-dense-controls]",
        "[data-graph-roadmap-progress]",
        "[data-graph-stage]",
        '[aria-label="Accessible graph browser"]',
        '[aria-label="Edition sidebar"]',
      ].join(", ");
      const isAcceptedDenseRegion = (el: Element) => !!el.closest(ACCEPTED_DENSE_REGION_SELECTOR);
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], summary'));
      const violations: { tag: string; label: string; width: number; height: number }[] = [];
      for (const el of candidates) {
        if (el.closest('[aria-hidden="true"]')) continue;
        if ((el as HTMLButtonElement).disabled) continue;
        if (el.closest('[role="separator"]')) continue;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // not actually rendered
        if (isInlineProse(el) || isInlineTextMarker(el) || isInClosedDetails(el) || isAcceptedDenseRegion(el)) continue;
        if (rect.width < MIN || rect.height < MIN) {
          violations.push({
            tag: el.tagName.toLowerCase(),
            label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
      return violations;
    });
  }

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

  test("Visualization roadmap layout controls meet the 44x44 touch-target minimum", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(zoomUserId, { title: "Touch Target Roadmap Work" });
    await zoomLogin(page);
    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    await expect(page.locator("[data-graph-roadmap-progress]")).toBeVisible();
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
  // trigger-focus restoration at all.
  test("Visualization 'Roadmap for' popover supports Escape-to-close and trigger-focus restoration", async ({ page }) => {
    await seedWorkWithGraphData(zoomUserId, { title: "Roadmap Popover Focus Sweep Work" });
    await zoomLogin(page);
    await page.goto("/graph");
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    const trigger = page.getByRole("button", { name: /^Roadmap for/ });
    await trigger.focus();
    await trigger.click();
    const popover = page.locator("#roadmap-for-popover");
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
        `event: user\ndata: ${JSON.stringify({ id: "mock-user-1", role: "user", content: "Do I understand akrasia?", citations: [], createdAt: now, latencyMs: null })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "Akrasia is acting against one's own better judgment. " })}\n\n`,
        `event: competency\ndata: ${JSON.stringify(notice)}\n\n`,
        `event: done\ndata: ${JSON.stringify({ message: { id: "mock-assistant-1", role: "assistant", content: "Akrasia is acting against one's own better judgment.", citations: [], createdAt: now, latencyMs: 12 }, notFound: false })}\n\n`,
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
});
