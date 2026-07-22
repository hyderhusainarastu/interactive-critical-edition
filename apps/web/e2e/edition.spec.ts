import { expect, test } from "@playwright/test";
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
  await expect(sidebar.getByRole("region", { name: /AI-generated critical notes/i })).toContainText(/reason subordinated to antecedent inclination/i);
  await expect(sidebar.getByRole("region", { name: /AI-generated critical notes/i })).not.toContainText(/Adapted from Aquinas/i);
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
  await edition.getByText(/AI cost/).click();
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
  const widthPx = () => edition.evaluate((el) => el.getBoundingClientRect().width);
  const initial = await widthPx();

  await page.getByRole("button", { name: "Workspace preferences" }).click();
  await page.getByLabel("Reading width").selectOption("compact");
  const compact = await widthPx();
  expect(compact).toBeLessThan(initial);

  await page.getByLabel("Reading width").selectOption("wide");
  const wide = await widthPx();
  expect(wide).toBeGreaterThan(compact);
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
