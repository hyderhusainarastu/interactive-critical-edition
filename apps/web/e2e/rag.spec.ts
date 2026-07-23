import { expect, test } from "@playwright/test";
import { db, ragChunks } from "@ice/db";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "./helpers";

const EMAIL = `rag-${Date.now()}@example.com`;
const PASSWORD = "Test-Password-1";
let userId = "";
let workId = "";
let documentId = "";
let runId = "";

test.describe("Phase 18 Library-grounded Socratic RAG", () => {
  test.skip(process.env.PHASE_18_RAG_ENABLED !== "true", "requires the local-only Phase 18 RAG gate");

  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    const seeded = await seedPublishedEdition(userId);
    ({ workId, documentId, runId } = seeded);
    await db.insert(ragChunks).values({
      userId,
      workId,
      documentId,
      processingRunId: runId,
      textBlockId: seeded.bodyBlockId,
      researchResourceContentId: null,
      sourceType: "uploaded",
      sourceKey: `text-block:${seeded.bodyBlockId}`,
      chunkIndex: 0,
      content: "Vicious people act on decision, yet live according to passion. Vice remains a state on which one decides.",
      contentHash: "e2e-phase-18-body",
      anchor: { kind: "reader", href: `/works/${workId}/reader#block-${seeded.bodyBlockId}`, workId, processingRunId: runId, pageIndex: 0, textBlockId: seeded.bodyBlockId, blockOrder: 1, startOffset: 0, endOffset: 106 },
    });
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
    await expect(page.getByRole("button", { name: "Ask Library" })).toBeVisible();
  });

  test("is discoverable from the authenticated workspace navigation", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Ask Library" })).toBeVisible();
    await page.getByRole("link", { name: "Ask Library" }).click();
    await expect(page).toHaveURL("/ask-library");
    await expect(page.getByRole("heading", { name: "Ask your Library", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Library-grounded Socratic chat" })).toBeVisible();
    await expect(page.getByLabel("Ask a question about your Library")).toBeEnabled();
  });

  test("streams a source-linked answer and says not found when the Library lacks evidence", async ({ page }) => {
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("How does passion relate to decision?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();
    const citation = chat.getByRole("link", { name: /Vice and Reason.*page 1/i });
    await expect(citation).toHaveAttribute("href", new RegExp(`/works/${workId}/reader#block-`));

    await chat.getByLabel("Ask a question about your Library").fill("What does this say about astrophysical nebulae?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat).toContainText(/couldn't find support/i);
  });

  // D-22-9: the Reader's own contextual drawer had no aria-expanded/
  // aria-controls relationship to its trigger and no Escape/focus-restore
  // lifecycle at all, unlike every other reader-shell disclosure this
  // codebase already brought to that standard (D-19-18/19/20).
  test("supports Escape-to-close and trigger-focus restoration on the Reader's own contextual drawer", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Ask Library" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.focus();
    await trigger.click();

    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(chat.getByRole("button", { name: "Close chat" })).toBeFocused();
    await expect(chat.getByText("Scope: Current work")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(chat).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
