import { expect, request as pwRequest, test } from "@playwright/test";
import { db, documents, passageAnnotations, processingRuns } from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "./helpers";

/**
 * v2 critical-edition reader coverage (Phase 8 acceptance gate).
 *
 * The edition is SEEDED rather than produced by the pipeline, which is what
 * makes this spec CI-safe: no worker, no GROBID, no live API spend. The
 * pipeline that produces this shape is exercised separately by production
 * canary runs; what is asserted here is the contract between a published run
 * and the reader — including the things that are easy to regress silently:
 * authorial notes staying distinct from AI-generated ones, claims exposing
 * evidence on both sides, provider honesty, and one Library entry per work.
 */

const EMAIL = `edition-${Date.now()}@example.com`;
const PASSWORD = "Test-Password-1";

let workId = "";

test.beforeAll(async () => {
  const userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  const seeded = await seedPublishedEdition(userId);
  workId = seeded.workId;
});

test.afterAll(async () => {
  await deleteTestUser(EMAIL);
});

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
  await page.goto(`/works/${workId}/reader`);
  // The interactive reader defaults to a labelled processed transcript;
  // published source is a separate immutable mode, never a second name for
  // processed text.
  await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();
});

test("the interactive reader renders its processed structure and run provenance", async ({ page }) => {
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  await expect(edition).toContainText("Interactive reader · processed text · run v1");
  // Structure state must be stated, not implied — a degraded run has to be
  // visibly different from a full one.
  await expect(edition).toContainText(/structured extraction/i);
  await expect(edition).toContainText("A Gap in Aristotle's Moral Psychology");
  await expect(edition).toContainText("Vicious people act on decision");
  await expect(edition).not.toContainText("Adapted from Aquinas");
  await expect(edition).not.toContainText("Irwin, Terence. Vice and Reason.");
});

test("authorial notes stay distinct from AI-generated ones", async ({ page }) => {
  await page.getByRole("button", { name: /^Apparatus/i }).click();
  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  // The source's own footnote is a labelled, block-anchored apparatus entry,
  // rather than a second copy in body prose or generated-note sidebar.
  await expect(sidebar.getByRole("heading", { name: /footnotes apparatus/i })).toBeVisible();
  await expect(sidebar).toContainText(/footnote.*1.*page\/block anchored/i);
  await expect(sidebar).toContainText(/Adapted from Aquinas/i);
  await expect(sidebar).toContainText(/provenance: authorial source/i);

  await page.getByRole("button", { name: /^Notes/i }).click();
  // The machine's editorial commentary, which must never be mistaken for it.
  await expect(sidebar.getByRole("region", { name: /Generated critical notes/i })).toContainText(/reason subordinated to antecedent inclination/i);
  await expect(sidebar.getByRole("region", { name: /Generated critical notes/i })).not.toContainText(/Adapted from Aquinas/i);
});

test("a generated claim exposes supporting AND contradicting evidence", async ({ page }) => {
  await page.getByRole("button", { name: /^Notes/i }).click();
  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  await expect(sidebar).toContainText(/reason subordinated to antecedent inclination/i);
  // Contested agreement has to be stated on the claim itself.
  const evidenceToggle = sidebar.getByRole("button", { name: /evidence and claims/i }).first();
  await evidenceToggle.click();
  await expect(sidebar).toContainText(/cannot be equated with akrasia/i);
  await expect(sidebar).toContainText(/contested/i);

  const claimEvidenceToggle = sidebar.getByRole("button", { name: /evidence \(\d+\)/i }).first();
  await claimEvidenceToggle.click();
  await expect(sidebar).toContainText(/supporting/i);
  await expect(sidebar).toContainText(/contradicting/i);
  await expect(sidebar).toContainText(/Vice remains a state on which one decides/i);
  await expect(sidebar).toContainText(/soul is not harmonious/i);
});

test("Sources consulted lists one entry per work, not one per record, in the sidebar's Sources tab (plan §36 11.5)", async ({ page }) => {
  await page.getByRole("button", { name: /^Sources/i }).click();
  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  // Four records describe two works: a book with a review and a second
  // edition, plus one unrelated article. Repeating the book three times is
  // exactly the failure this grouping exists to prevent.
  await expect(sidebar).toContainText(/2 works, 4 records/i);
  await expect(sidebar.getByRole("heading", { name: /sources consulted/i })).toBeVisible();

  // Two top-level entries, not four: the list is of works, and the direct
  // children are what the reader scans.
  const workList = sidebar.locator("ul").first();
  await expect(workList.locator(":scope > li")).toHaveCount(2);
  // The book's review and second edition are attached beneath it — still
  // visible, labelled by role, never listed as separate works.
  const bookEntry = workList.locator(":scope > li").filter({ hasText: "Ethics with Aristotle" });
  await expect(bookEntry).toHaveCount(1);
  await expect(bookEntry).toContainText(/review/i);
  await expect(bookEntry).toContainText(/edition/i);
  await expect(bookEntry).toContainText(/Recensão a/i);
});

test("a passage annotation renders as an in-text marker; clicking it reveals its sidebar card (plan §36 11.5)", async ({ page }) => {
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  const marker = edition.locator("button[data-annotation-id][data-marker-kind='annotation']");
  await expect(marker).toHaveCount(1);

  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  await expect(sidebar.getByRole("button", { name: /page 1.*flags the gap/i })).toBeVisible();
  // Clicking a marker selects its one sidebar detail rather than creating a
  // second long copy of every note in the rail.
  await marker.click();
  const detail = sidebar.getByRole("region", { name: /annotation detail/i });
  await expect(detail).toContainText(/tension Irwin's paper investigates/i);
  await expect(detail).toContainText(/live according to passion/i);
  await expect(detail).toContainText(/source: anchored document passage.*confidence.*provenance/i);
  // Phase 22.3 residual parity check (D-21-8): this annotation is seeded
  // with `relationship: "interpretive_aid"` (helpers.ts). The Relationship
  // filter renders its option text straight from the SAME shared
  // `CATEGORY_META` module the Visualization inspector now also reuses for
  // a categorized edge (GraphView.tsx) — locking in that this annotation
  // sidebar was never the divergent side of D-21-8's finding, only the
  // Visualization inspector was.
  await expect(page.getByLabel("Relationship")).toContainText("Interpretive aid");
});

test("a quote-matched critical note marker opens the sidebar Notes tab (plan §36 11.6)", async ({ page }) => {
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  const marker = edition.locator("button[data-annotation-id][data-marker-kind='matched-note']");
  await expect(marker).toHaveCount(1);

  await page.getByRole("button", { name: /^Sources/i }).click();
  await marker.click();

  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  await expect(sidebar.getByRole("button", { name: /^Notes/i })).toHaveAttribute("aria-pressed", "true");
  await expect(sidebar).toContainText(/quote-matched/i);
  await expect(sidebar).toContainText(/Vice remains a state on which one decides/i);
  await expect(sidebar).toContainText(/reason subordinated to antecedent inclination/i);
});

test("whole-work guidance is labelled and kept separate from passage-anchored notes, in the sidebar", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  await expect(sidebar.getByRole("button", { name: /whole work.*vice and akrasia/i })).toBeVisible();
  // The index marks this as whole-work rather than inventing a page anchor.
  await sidebar.getByRole("button", { name: /whole work.*vice and akrasia/i }).click();
  await expect(sidebar.getByRole("region", { name: /annotation detail/i })).toContainText(/vice and akrasia are distinct psychological states/i);
});

test("provider reports are honest about what was not consulted", async ({ page }) => {
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  // Silence must never look like "nothing was found": a rate-limited or
  // disabled provider has to say so.
  await expect(edition).toContainText(/crossref.*queried/i);
  await expect(edition).toContainText(/googlebooks.*rate_limited/i);
  await expect(edition).toContainText(/mastodon.*disabled/i);
});

test("research cost is disclosed to the reader, with a per-module breakdown (Phase 9.7)", async ({ page }) => {
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  await expect(edition).toContainText(/\$0\.04/);

  // The total is a <summary> — the per-stage breakdown is collapsed by
  // default and only in the DOM/visible once expanded.
  await edition.getByText(/Analysis cost/).click();
  await expect(edition).toContainText("research-discovery");
  await expect(edition).toContainText("$0.0300");
  await expect(edition).toContainText("classification");
  await expect(edition).toContainText("$0.0121");
});

test("the immutable published source remains reachable alongside processed text", async ({ page }) => {
  await page.getByRole("button", { name: "Published edition" }).click();
  await expect(page.getByRole("region", { name: /published edition.*original source text/i })).toBeVisible();
  await page.getByRole("button", { name: "Interactive reader" }).click();
  await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();
});

test("the reader-view toggle plainly distinguishes immutable source from processed text", async ({ page }) => {
  const group = page.getByRole("group", { name: /reader view/i });
  const editionButton = group.getByRole("button", { name: "Published edition" });
  const interactiveButton = group.getByRole("button", { name: "Interactive reader" });
  await expect(editionButton).toHaveAttribute("aria-pressed", "false");
  await expect(interactiveButton).toHaveAttribute("aria-pressed", "true");

  await editionButton.click();
  await expect(editionButton).toHaveAttribute("aria-pressed", "true");
  await expect(interactiveButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("region", { name: /published edition.*original source text/i })).toBeVisible();
});

test("script display preference swaps a verified term's shown text between original script and transliteration (Phase 19 interaction inventory)", async ({ page }) => {
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  const term = edition.locator("[data-verified-term]");
  await expect(term).toHaveCount(1);
  await expect(term).toHaveText("decision");

  await page.getByRole("button", { name: "Workspace preferences" }).click();
  await page.getByLabel("Script display").selectOption("transliteration");
  await expect(term).toHaveText("DECISION-XLIT");

  await page.getByLabel("Script display").selectOption("original");
  await expect(term).toHaveText("decision");
});

test("reading width preference changes the interactive reader's actual content width (Phase 19 interaction inventory, D-19-21)", async ({ page }) => {
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  // The *computed* max-width (resolved from var(--reading-measure)) is what
  // proves EditionReader.tsx's own rule actually consumes the preference —
  // D-19-21's bug was a hardcoded max-w-[72ch] ignoring the variable
  // entirely. This is deliberately NOT getBoundingClientRect(): the
  // rendered box's *used* width can be clamped by an ancestor's own
  // available width regardless of this element's max-width (observed in
  // CI: compact 58ch and wide 88ch both rendered at an identical 624px,
  // even after waiting for the preferences round trip and polling for
  // several seconds — the box was hitting a narrower ancestor constraint in
  // that environment, unrelated to this fix). The *computed* max-width is
  // the length CSS resolves var() to, independent of any ancestor's box.
  const computedMaxWidthPx = () => edition.evaluate((el) => parseFloat(getComputedStyle(el).maxWidth));

  await page.getByRole("button", { name: "Workspace preferences" }).click();

  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
    page.getByLabel("Reading width").selectOption("compact"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "compact");
  const compactMaxWidth = await computedMaxWidthPx();

  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
    page.getByLabel("Reading width").selectOption("wide"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "wide");
  await expect.poll(computedMaxWidthPx, { message: "the section's computed max-width should grow once 'wide' is selected" }).toBeGreaterThan(compactMaxWidth);
});

test("reading passage body text uses the serif reading typeface, matching the landing depiction, in both the interactive reader and the original-text view (Phase 22.2, D-22-5)", async ({ page }) => {
  // The landing Reader/Annotations showcase (`page.tsx`'s ReaderShowcase, via
  // `READING_PROSE_CLASS` in `components/shared/typography.ts`) depicts body
  // prose in a serif stack headed by "Iowan Old Style" — that name only
  // ever appears in `--font-serif`, never in body's own sans-first stack
  // (`--font-sans, Georgia, serif`), so asserting on it (not a bare
  // "serif" substring) actually distinguishes the two font stacks rather
  // than passing on the generic fallback every element already inherits.
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  const editionParagraph = edition.locator("p", { hasText: "Vicious people act on decision" }).first();
  await expect(editionParagraph).toHaveCSS("font-family", /Iowan Old Style/);

  await page.getByRole("button", { name: "Published edition" }).click();
  const original = page.getByRole("region", { name: /published edition.*original source text/i });
  const originalParagraph = original.locator("p", { hasText: "Vicious people act on decision" }).first();
  await expect(originalParagraph).toHaveCSS("font-family", /Iowan Old Style/);
});

test("reading width preference scales the original-text view by the identical compact->wide ratio as the interactive reader, proving both derive from the same --reading-measure token (Phase 22.2, D-22-6)", async ({ page }) => {
  // D-22-6: EditionReader consumes the global --reading-measure token
  // (58/72/88ch, the same one Workspace preferences writes to
  // :root[data-reading-width]), but TextReader (rendered here via the
  // "Published edition" original-text view for a text/plain source) used a
  // second, independently-computed --reader-line-width (56/66/82ch) — a
  // different NUMBER of ch for the exact same labelled preference. Fixed
  // by having TextReader consume --reading-measure directly.
  //
  // This asserts the wide/compact RATIO rather than raw pixel equality
  // deliberately: TextReader's wrapper also carries its own independent
  // --reader-font-size (a *separate*, pre-existing per-reader font-SIZE
  // preference EditionReader has no equivalent of at all, out of scope for
  // D-22-5/D-22-6, which are about the serif font family and the reading
  // WIDTH token specifically). That mismatched font-size baseline scales
  // ch's absolute pixel size and would make a raw-pixel equality assertion
  // fail even after this fix for a reason unrelated to the reading-width
  // token itself. The ratio is immune to that constant per-element
  // scaling factor: 88ch/58ch and 82ch/56ch are different ratios
  // (~1.517 vs ~1.464), so it still fails on the un-unified code and only
  // passes once both readers are driven by the same 58/72/88ch scale.
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  const editionMaxWidthPx = () => edition.evaluate((el) => parseFloat(getComputedStyle(el).maxWidth));

  const originalMaxWidthPx = async () => {
    await page.getByRole("button", { name: "Published edition" }).click();
    const original = page.getByRole("region", { name: /published edition.*original source text/i });
    const width = await original.locator(".reader-content").evaluate((el) => parseFloat(getComputedStyle(el).maxWidth));
    await page.getByRole("button", { name: "Interactive reader" }).click();
    await expect(edition).toBeVisible();
    return width;
  };

  async function setReadingWidth(option: "compact" | "wide") {
    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Reading width").selectOption(option),
    ]);
    await expect(page.locator("html")).toHaveAttribute("data-reading-width", option);
    // Close the (non-modal) preferences dialog via Escape — the established
    // D-19-19 pattern — rather than re-clicking its own trigger, which would
    // just toggle it closed a second time and desync this test's assumption
    // about its open/closed state.
    await page.keyboard.press("Escape");
  }

  await setReadingWidth("compact");
  const editionCompact = await editionMaxWidthPx();
  const originalCompact = await originalMaxWidthPx();

  await setReadingWidth("wide");
  const editionWide = await editionMaxWidthPx();
  const originalWide = await originalMaxWidthPx();

  expect(originalWide).toBeGreaterThan(originalCompact);
  const editionRatio = editionWide / editionCompact;
  const originalRatio = originalWide / originalCompact;
  expect(originalRatio).toBeCloseTo(editionRatio, 2);
});

test("the Split view work picker exposes and dismisses its disclosure state", async ({ page }) => {
  const splitView = page.getByRole("button", { name: "Split view" });
  await expect(splitView).toHaveAttribute("aria-expanded", "false");
  await splitView.focus();
  await splitView.click();
  await expect(splitView).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("group", { name: "Choose a work for split view" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(splitView).toHaveAttribute("aria-expanded", "false");
  await expect(splitView).toBeFocused();
});

test("highlight creation honors the chosen color and survives reload, in the interactive reader (Phase 19 D-19 audit)", async ({ page }) => {
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  const block = edition.locator('[id^="block-"]').filter({ hasText: "Vicious people act on decision" });
  await expect(block).toBeVisible();

  // Choose a non-default color before highlighting.
  const burgundySwatch = page.getByRole("button", { name: "burgundy highlight" });
  await burgundySwatch.click();
  await expect(burgundySwatch).toHaveAttribute("aria-pressed", "true");

  // Bind directly to the locator's already-resolved element handle (rather
  // than re-querying `document` inside a separate `page.evaluate`) — the
  // latter raced the resolved locator and was intermittently empty.
  await block.evaluate((el) => {
    const textNode = el.childNodes[0];
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 7); // "Vicious"
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await block.dispatchEvent("mouseup");
  await page.getByRole("toolbar", { name: "Selected text actions" }).getByRole("button", { name: "Highlight", exact: true }).click();

  const mark = block.locator("mark[data-highlight-id]");
  await expect(mark).toHaveClass(/reader-highlight-burgundy/);

  await page.reload();
  await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();
  const reloadedBlock = page.getByRole("region", { name: /interactive reader.*processed text/i }).locator('[id^="block-"]').filter({ hasText: "Vicious people act on decision" });
  await expect(reloadedBlock.locator("mark[data-highlight-id]")).toHaveClass(/reader-highlight-burgundy/);
});

test("a bookmark and a standalone note persist from the reader sidebar (Phase 19 D-19 audit)", async ({ page }) => {
  await page.getByRole("button", { name: "+ Bookmark" }).click();
  await expect(page.getByText(/Processed page 1/)).toBeVisible();

  await page.getByPlaceholder("Write a note about this work…").fill("A standalone note, not linked to any highlight.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("A standalone note, not linked to any highlight.")).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Processed page 1/)).toBeVisible();
  await expect(page.getByText("A standalone note, not linked to any highlight.")).toBeVisible();
});

test("the reader analysis toggle hides and restores the edition sidebar (Phase 19 D-19 audit)", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  await expect(sidebar).toBeVisible();
  const toggle = page.getByRole("button", { name: /^Hide analysis/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await toggle.click();
  await expect(sidebar).toHaveCount(0);
  const reopenToggle = page.getByRole("button", { name: /^Analysis/ });
  await expect(reopenToggle).toHaveAttribute("aria-pressed", "false");

  await reopenToggle.click();
  await expect(page.getByRole("complementary", { name: /edition sidebar/i })).toBeVisible();
});

/**
 * Phase 22.3 / D-22-1: passage annotations (the default kind under the v2+
 * edition pipeline) must have the same reader-correction workflow as the
 * legacy `annotation` table — verify / dispute / reject, hide / unhide, and
 * edit the explanation — persisted through a new owner-scoped route and the
 * `passage_annotation.verification_status`/`hidden` columns. Before this
 * change the sidebar detail card was entirely read-only, so the landing
 * page's "Approve, edit, or dismiss anything" promise was false for every
 * document the shipped pipeline produces.
 */
async function anchoredPassageAnnotationId(): Promise<string> {
  const rows = await db
    .select({ id: passageAnnotations.id, isWholeWork: passageAnnotations.isWholeWork })
    .from(passageAnnotations)
    .innerJoin(processingRuns, eq(processingRuns.id, passageAnnotations.runId))
    .innerJoin(documents, eq(documents.id, processingRuns.documentId))
    .where(eq(documents.workId, workId));
  const anchored = rows.find((row) => !row.isWholeWork);
  if (!anchored) throw new Error("no anchored passage annotation seeded");
  return anchored.id;
}

test("passage annotations expose the verify/dispute/reject/hide/edit correction controls (D-22-1)", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  const detail = sidebar.getByRole("region", { name: /annotation detail/i });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "Verify" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Dispute" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Reject" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(detail.getByRole("button", { name: /^(Hide|Unhide)$/ })).toBeVisible();
});

test("verifying a passage annotation shows a review badge that persists across reload (D-22-1)", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  const detail = sidebar.getByRole("region", { name: /annotation detail/i });
  await detail.getByRole("button", { name: "Verify" }).click();
  await expect(detail.getByText("Verified by you")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();
  const detailAfter = page.getByRole("complementary", { name: /edition sidebar/i }).getByRole("region", { name: /annotation detail/i });
  await expect(detailAfter.getByText("Verified by you")).toBeVisible();
});

test("hiding a passage annotation removes its in-text marker and files it under Show dismissed, across reload (D-22-1)", async ({ page }) => {
  const anchoredId = await anchoredPassageAnnotationId();
  const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
  await expect(edition.locator(`button[data-annotation-id="${anchoredId}"]`)).toHaveCount(1);

  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  await sidebar.getByRole("button", { name: /page 1.*flags the gap/i }).click();
  const detail = sidebar.getByRole("region", { name: /annotation detail/i });
  await detail.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: /show dismissed/i })).toBeVisible();

  await page.reload();
  const editionAfter = page.getByRole("region", { name: /interactive reader.*processed text/i });
  await expect(editionAfter).toBeVisible();
  // The dismissed annotation's in-text marker is gone after reload.
  await expect(editionAfter.locator(`button[data-annotation-id="${anchoredId}"]`)).toHaveCount(0);
  // …but it remains reviewable under "Show dismissed".
  const sidebarAfter = page.getByRole("complementary", { name: /edition sidebar/i });
  await sidebarAfter.getByRole("button", { name: /show dismissed/i }).click();
  await expect(sidebarAfter.getByRole("button", { name: /dismissed.*flags the gap/i })).toBeVisible();
});

test("editing a passage annotation explanation persists and is attributed to the reader (D-22-1)", async ({ page }) => {
  const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
  const detail = sidebar.getByRole("region", { name: /annotation detail/i });
  await detail.getByRole("button", { name: "Edit" }).click();
  const editText = `Reader-authored explanation ${Date.now()}`;
  await detail.getByRole("textbox", { name: /edit explanation/i }).fill(editText);
  await detail.getByRole("button", { name: "Save" }).click();
  await expect(detail.getByText(editText)).toBeVisible();
  await expect(detail.getByText("Edited by you")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();
  const detailAfter = page.getByRole("complementary", { name: /edition sidebar/i }).getByRole("region", { name: /annotation detail/i });
  await expect(detailAfter.getByText(editText)).toBeVisible();
  await expect(detailAfter.getByText("Edited by you")).toBeVisible();
});

test("the passage-annotation correction route is owner-scoped: 401 anonymous, 404 cross-user (D-22-1 IDOR)", async ({ page, baseURL }) => {
  const anchoredId = await anchoredPassageAnnotationId();
  const url = `/api/works/${workId}/reader/passage-annotations/${anchoredId}`;

  const anon = await pwRequest.newContext({ baseURL: baseURL ?? "http://localhost:3000" });
  const anonRes = await anon.patch(url, { data: { verificationStatus: "rejected" } });
  expect(anonRes.status(), "anonymous PATCH").toBe(401);
  await anon.dispose();

  const attacker = `edition-idor-${Date.now()}@example.com`;
  await createVerifiedTestUser(attacker, PASSWORD);
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(attacker);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/(dashboard|welcome)/);
    const res = await page.request.patch(url, { data: { verificationStatus: "rejected" } });
    expect(res.status(), "cross-user PATCH").toBe(404);
  } finally {
    await deleteTestUser(attacker);
  }
});
