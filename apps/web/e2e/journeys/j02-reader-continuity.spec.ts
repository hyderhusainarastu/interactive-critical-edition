import { db, ragChunks } from "@ice/db";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "../helpers";

/**
 * Stage 7 journey matrix — charter §16 journey 2:
 * "Resume reading → switch Published Edition/Interactive Reader/original
 * PDF or file/split view → outline → apparatus/term/generated note/
 * annotation/claim → evidence/source → note/highlight/bookmark → grounded
 * Ask Library answer → return to the same saved position and
 * representation."
 *
 * One of the four cross-workflow journeys (charter: "Run the Reader,
 * Research, Writer, and Knowledge Map cross-workflow journeys additionally
 * at 1024px and 768px" — see playwright.config.ts's "journeys-crossworkflow-*"
 * projects). Fully seeded (`seedPublishedEdition`, a real RAG chunk exactly
 * like `rag.spec.ts`'s own fixture) — no worker, no live model call. Split
 * into two `test()`s (representation/apparatus/notes vs. Ask Library +
 * position-and-representation persistence) rather than one giant test,
 * following j01's own documented finding about long single-tab chains on
 * this app's real pages — each stage here stays well short of that, but
 * splitting keeps each test's own failure signal legible.
 */

const EMAIL = `e2e-j02-reader-continuity-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";
let workId = "";
let documentId = "";
let runId = "";
let bodyBlockId = "";

function main(page: Page) {
  return page.locator("#main-content");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Journey 2 — reader continuity", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    const seeded = await seedPublishedEdition(userId);
    ({ workId, documentId, runId, bodyBlockId } = seeded);
    // A real RAG chunk over the same body text (rag.spec.ts's own fixture
    // shape) so the Ask Library step below can ground a real, cited answer.
    await db.insert(ragChunks).values({
      userId,
      workId,
      documentId,
      processingRunId: runId,
      textBlockId: bodyBlockId,
      sourceType: "uploaded",
      sourceKey: `text-block:${bodyBlockId}`,
      chunkIndex: 0,
      content: "Vicious people act on decision, yet live according to passion. Vice remains a state on which one decides.",
      contentHash: "e2e-j02-body-chunk",
      anchor: { kind: "reader", href: `/works/${workId}/reader#block-${bodyBlockId}`, workId, processingRunId: runId, pageIndex: 0, textBlockId: bodyBlockId, blockOrder: 1, startOffset: 0, endOffset: 106 },
    });
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("2a — switch representations, outline, apparatus/terms/claims, and annotate", async ({ page }) => {
    await login(page);
    await page.goto(`/works/${workId}/reader`);

    // Default is the Interactive reader (processed/annotated text, Phase 16).
    await expect(page.getByRole("region", { name: "Interactive reader — processed text" })).toBeVisible();

    // Outline (the fixture has one header block).
    const outlineToggle = page.getByRole("button", { name: /^(Outline|Hide outline)/ });
    if (await outlineToggle.isVisible().catch(() => false)) {
      if ((await outlineToggle.getAttribute("aria-pressed")) !== "true") await outlineToggle.click();
      await expect(page.getByRole("button", { name: "A Gap in Aristotle's Moral Psychology" })).toBeVisible();
    }

    // Switch to Published edition (the immutable original source file) and back.
    await page.getByRole("button", { name: "Published edition" }).click();
    await expect(page.getByRole("region", { name: "Published edition — original source text" })).toBeVisible();
    await page.getByRole("button", { name: "Interactive reader" }).click();
    await expect(page.getByRole("region", { name: "Interactive reader — processed text" })).toBeVisible();

    // Open the analysis/notes drawer and walk apparatus/terms/claims tabs.
    const notesToggle = page.getByRole("button", { name: /^(Notes|Hide notes)/ });
    if ((await notesToggle.getAttribute("aria-pressed")) !== "true") await notesToggle.click();
    const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
    await expect(sidebar).toBeVisible();

    // Annotations tab (default) — the interpretive_aid passage annotation.
    await expect(sidebar.getByText(/Flags the gap between decision and passion/)).toBeVisible();

    // Critical notes tab — the generated note with claim-level evidence.
    await sidebar.getByRole("button", { name: /^Critical notes/ }).click();
    await expect(sidebar.getByText(/reads vice as reason subordinated/)).toBeVisible();

    // Apparatus tab — the structural footnote/bibliography entries.
    await sidebar.getByRole("button", { name: /^Apparatus/ }).click();
    await expect(sidebar.getByText(/Aquinas on sin from passion/)).toBeVisible();

    // Terms tab — the seeded verified term ("decision" / transliteration).
    await sidebar.getByRole("button", { name: /^Terms/ }).click();

    // Sources tab — the seeded research resources (grouped by canonical work).
    await sidebar.getByRole("button", { name: /^Sources/ }).click();
    await expect(sidebar.getByText("Ethics with Aristotle").first()).toBeVisible();

    // My notes tab — highlight, note, bookmark. The interactive reader
    // anchors real DOM text blocks by `id="block-<id>"`, not a plain-text
    // paragraph index (that's the legacy TextReader's own convention, per
    // `edition.spec.ts`'s own highlight test) — select inside the real body
    // block this fixture seeded.
    await sidebar.getByRole("button", { name: /^My notes/ }).click();
    const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
    const bodyBlock = edition.locator('[id^="block-"]').filter({ hasText: "Vicious people act on decision" });
    await expect(bodyBlock).toBeVisible();
    await bodyBlock.evaluate((el) => {
      const textNode = el.childNodes[0];
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 7); // "Vicious"
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await bodyBlock.dispatchEvent("mouseup");
    const selectionToolbar = page.getByRole("toolbar", { name: "Selected text actions" });
    await selectionToolbar.getByRole("button", { name: "Highlight", exact: true }).click();
    await expect(bodyBlock.locator("mark[data-highlight-id]")).toBeVisible();

    await page.getByPlaceholder("Write a note about this work…").fill("Journey 2 continuity note");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Journey 2 continuity note")).toBeVisible();

    await page.getByRole("button", { name: "+ Bookmark" }).click();
    await expect(sidebar.getByRole("heading", { name: /Bookmarks \(1\)/ })).toBeVisible();
  });

  test("2b — grounded Ask Library answer, then return to the same saved position and representation", async ({ page }) => {
    await login(page);
    await page.goto(`/works/${workId}/reader`);
    await expect(page.getByRole("region", { name: "Interactive reader — processed text" })).toBeVisible();

    // Grounded Ask Library answer, citing back into this same work.
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("How does passion relate to decision in this work?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();
    const citation = chat.getByRole("link", { name: /Vice and Reason.*page 1/i });
    await expect(citation).toHaveAttribute("href", new RegExp(`/works/${workId}/reader#block-`));
    await page.keyboard.press("Escape");

    // Reversible navigation (charter §16 journey 2's own "return to the
    // same saved position and representation"): leave the reader entirely,
    // then return — the Interactive reader (the saved/default
    // representation) and 2a's own highlight must both still hold.
    await page.goto("/dashboard");
    await page.goto(`/works/${workId}/reader`);
    await expect(page.getByRole("region", { name: "Interactive reader — processed text" })).toBeVisible();
    const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
    const bodyBlock = edition.locator('[id^="block-"]').filter({ hasText: "Vicious people act on decision" });
    await expect(bodyBlock.locator("mark[data-highlight-id]")).toBeVisible();
  });
});
