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
  // The edition loads asynchronously; the toggle only appears once it has.
  await page.getByRole("button", { name: /published edition/i }).click();
  await expect(page.getByRole("region", { name: /published critical edition/i })).toBeVisible();
});

test("the published edition renders its structure and run provenance", async ({ page }) => {
  const edition = page.getByRole("region", { name: /published critical edition/i });
  await expect(edition).toContainText("Edition v1");
  // Structure state must be stated, not implied — a degraded run has to be
  // visibly different from a full one.
  await expect(edition).toContainText(/structured extraction/i);
  await expect(edition).toContainText("A Gap in Aristotle's Moral Psychology");
  await expect(edition).toContainText("Vicious people act on decision");
});

test("authorial notes stay distinct from AI-generated ones", async ({ page }) => {
  const edition = page.getByRole("region", { name: /published critical edition/i });
  // The source's own footnote.
  await expect(edition).toContainText(/Adapted from Aquinas/i);
  // The machine's editorial commentary, which must never be mistaken for it.
  await expect(edition).toContainText(/reason subordinated to antecedent inclination/i);
});

test("a generated claim exposes supporting AND contradicting evidence", async ({ page }) => {
  const edition = page.getByRole("region", { name: /published critical edition/i });
  await expect(edition).toContainText(/cannot be equated with akrasia/i);
  // Contested agreement has to be stated on the claim itself.
  await expect(edition).toContainText(/contested/i);

  const evidenceToggle = edition.getByRole("button", { name: /evidence \(\d+\)/i }).first();
  await evidenceToggle.click();
  await expect(edition).toContainText(/supporting/i);
  await expect(edition).toContainText(/contradicting/i);
  await expect(edition).toContainText(/Vice remains a state on which one decides/i);
  await expect(edition).toContainText(/soul is not harmonious/i);
});

test("Sources consulted lists one entry per work, not one per record", async ({ page }) => {
  const edition = page.getByRole("region", { name: /published critical edition/i });
  // Four records describe two works: a book with a review and a second
  // edition, plus one unrelated article. Repeating the book three times is
  // exactly the failure this grouping exists to prevent.
  await expect(edition).toContainText(/2 works, 4 records/i);

  await expect(edition.getByRole("heading", { name: /sources consulted/i })).toBeVisible();

  // Scope to the Sources section by its own text; a `has:` filter needs a
  // locator relative to the candidate, not one rooted at an ancestor.
  const sources = edition.locator("section").filter({ hasText: "Sources consulted" });
  // Two top-level entries, not four: the list is of works, and the direct
  // children are what the reader scans.
  const workList = sources.locator("ul").first();
  await expect(workList.locator(":scope > li")).toHaveCount(2);
  // The book's review and second edition are attached beneath it — still
  // visible, labelled by role, never listed as separate works.
  const bookEntry = workList.locator(":scope > li").filter({ hasText: "Ethics with Aristotle" });
  await expect(bookEntry).toHaveCount(1);
  await expect(bookEntry).toContainText(/review/i);
  await expect(bookEntry).toContainText(/edition/i);
  await expect(bookEntry).toContainText(/Recensão a/i);
});

test("a passage annotation renders inline at its own paragraph, collapsed until expanded", async ({ page }) => {
  const edition = page.getByRole("region", { name: /published critical edition/i });
  const anchoredNote = edition.locator("li").filter({ hasText: "Flags the gap between decision and passion" });
  await expect(anchoredNote).toBeVisible();
  // The explanation is not shown until the reader asks for it.
  await expect(anchoredNote).not.toContainText(/tension Irwin's paper investigates/i);
  await anchoredNote.getByRole("button", { name: /read more/i }).click();
  await expect(anchoredNote).toContainText(/tension Irwin's paper investigates/i);
  await expect(anchoredNote).toContainText(/live according to passion/i);
});

test("whole-work guidance is labelled and kept separate from passage-anchored notes", async ({ page }) => {
  const edition = page.getByRole("region", { name: /published critical edition/i });
  await expect(edition.getByRole("region", { name: /whole-work guidance/i })).toBeVisible();
  const guidance = edition.getByRole("region", { name: /whole-work guidance/i });
  await expect(guidance).toContainText(/vice and akrasia are distinct psychological states/i);
  // It never carries a page/block anchor — no quoted excerpt is shown even
  // after expanding, because it genuinely has none.
  await guidance.getByRole("button", { name: /read more/i }).click();
  await expect(guidance).not.toContainText(/“/);
});

test("provider reports are honest about what was not consulted", async ({ page }) => {
  const edition = page.getByRole("region", { name: /published critical edition/i });
  // Silence must never look like "nothing was found": a rate-limited or
  // disabled provider has to say so.
  await expect(edition).toContainText(/crossref.*queried/i);
  await expect(edition).toContainText(/googlebooks.*rate_limited/i);
  await expect(edition).toContainText(/mastodon.*disabled/i);
});

test("research cost is disclosed to the reader", async ({ page }) => {
  const edition = page.getByRole("region", { name: /published critical edition/i });
  await expect(edition).toContainText(/\$0\.04/);
});

test("the interactive reader remains reachable alongside the edition", async ({ page }) => {
  // The published edition is an additional view, never a replacement: the
  // user's own highlights/notes live in the interactive reader.
  await page.getByRole("button", { name: /interactive reader/i }).click();
  await expect(page.getByRole("region", { name: /published critical edition/i })).toHaveCount(0);
});
