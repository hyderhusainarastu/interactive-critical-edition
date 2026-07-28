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

  // Stage 4 read spec §4.2: exactly one right-side surface — the merged
  // notes/analysis drawer, or Ask Library — is ever mounted at once, the
  // reader-local half of "exactly one mounted assistant/conversation
  // controller at a time." Opening one closes the other.
  test("opening Ask Library closes the notes drawer, and reopening the notes drawer closes Ask Library", async ({ page }) => {
    const notesToggle = page.getByRole("button", { name: /^(Notes|Hide notes)/ });
    const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
    // The drawer defaults open at this (wide) viewport.
    await expect(sidebar).toBeVisible();

    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await expect(sidebar).toHaveCount(0);
    await expect(notesToggle).toHaveAttribute("aria-pressed", "false");

    await notesToggle.click();
    await expect(sidebar).toBeVisible();
    await expect(chat).toHaveCount(0);
  });

  // Workstream E (plan §1): the greeting card is client-side-only and never
  // persisted — it's the very first thing a reader sees in a fresh
  // conversation and disappears the moment a real message exists.
  test("shows a greeting with suggested questions that fill the textarea on click", async ({ page }) => {
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await expect(chat.getByText("Reading companion")).toBeVisible();

    const chip = chat.getByRole("button", { name: "What should I read next to understand this?" });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chat.getByLabel("Ask a question about your Library")).toHaveValue("What should I read next to understand this?");

    // Once a real turn exists, the greeting is gone — it never persists
    // alongside actual conversation history.
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();
    await expect(chat.getByText("Reading companion")).toBeHidden();
  });

  // Workstream E (plan §4): the conversation switcher over
  // `GET /api/rag/conversations` — previously nothing consumed that list.
  // Deliberately unique question wording (unlike the other tests in this
  // file, which all share a fixed user across the whole describe block and
  // never clean up conversations between tests) — colliding on the same
  // question text elsewhere would give two conversations the same derived
  // title and break this test's own name-based lookups.
  test("lists earlier conversations and switches the active one", async ({ page }) => {
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();

    await chat.getByLabel("Ask a question about your Library").fill("What role does decision play in vice, on this account?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();

    await chat.getByRole("button", { name: "New conversation" }).click();
    await expect(chat.getByText("Reading companion")).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("Does this passage discuss orbital mechanics of comets?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat).toContainText(/couldn't find support/i);

    await chat.getByRole("button", { name: "Conversation history" }).click();
    const history = chat.getByRole("dialog", { name: "Conversation history" });
    await expect(history).toBeVisible();
    await expect(history.getByRole("button", { name: /orbital mechanics of comets/i })).toBeVisible();
    const firstConversation = history.getByRole("button", { name: /decision play in vice/i });
    await expect(firstConversation).toBeVisible();

    await firstConversation.click();
    await expect(history).toBeHidden();
    await expect(chat.getByText("What role does decision play in vice, on this account?")).toBeVisible();
    await expect(chat).not.toContainText(/orbital mechanics of comets/i);
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

  // Live-issue fix lane (2026-07-25): the conversation-history trigger
  // inside the chat panel moved to the same open-only-pointer-click +
  // outside-pointerdown design as `AppShell.tsx`'s profile/preferences
  // menus (see `workspace-shell.spec.ts`'s equivalent tests for the full
  // design rationale) — this is the third of the three menus the redesign
  // applies to. 600ms is comfortably past the old `useReopenGuard(250)`
  // window, which the pre-fix tree would have genuinely closed on.
  test("the conversation history menu survives a switch-bounce double-fire well past the old 250ms guard window, and closes on outside click without stealing focus", async ({ page }) => {
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();

    // `exact` avoids matching the panel's own "Close conversation history"
    // button, whose accessible name otherwise substring-contains this one
    // once the panel is open (the same ambiguity class D-19-1 fixed once
    // already for "Theme").
    const historyTrigger = chat.getByRole("button", { name: "Conversation history", exact: true });
    const box = await historyTrigger.boundingBox();
    if (!box) throw new Error("history trigger has no layout box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(600);
    await page.mouse.down();
    await page.mouse.up();

    const history = chat.getByRole("dialog", { name: "Conversation history" });
    await expect(history).toBeVisible();
    await page.waitForTimeout(300);
    await expect(history).toBeVisible();

    // Outside click — the chat panel's own heading, outside both the
    // history trigger and its panel — closes it. No focus-return to the
    // trigger, unlike Escape/explicit-close (see `useOutsideMenuClose`'s
    // doc comment).
    await chat.getByRole("heading", { name: "Ask your Library" }).click();
    await expect(history).toBeHidden();
    await expect(historyTrigger).not.toBeFocused();
  });

  // Owner-requested UX change: standard chat Enter-to-send on the question
  // textarea, matching the Ask button's own submit path exactly.
  test.describe("Enter-to-send on the question textarea", () => {
    test("Enter sends the question, same as clicking Ask", async ({ page }) => {
      await page.getByRole("button", { name: "Ask Library" }).click();
      const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
      await expect(chat).toBeVisible();

      const input = chat.getByLabel("Ask a question about your Library");
      await input.fill("Does virtue also involve decision, on this account?");
      await input.press("Enter");

      await expect(chat.getByText("Library companion").last()).toBeVisible();
      await expect(input).toHaveValue("");
    });

    test("Shift+Enter inserts a newline instead of sending", async ({ page }) => {
      await page.getByRole("button", { name: "Ask Library" }).click();
      const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
      await expect(chat).toBeVisible();

      const input = chat.getByLabel("Ask a question about your Library");
      await input.fill("First line");
      await input.press("Shift+Enter");
      await input.pressSequentially("second line");

      await expect(input).toHaveValue("First line\nsecond line");
      // Nothing was sent — the greeting card (client-only, disappears the
      // moment a real turn exists) is still showing.
      await expect(chat.getByText("Reading companion")).toBeVisible();
    });

    test("Enter on an empty textarea does nothing", async ({ page }) => {
      await page.getByRole("button", { name: "Ask Library" }).click();
      const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
      await expect(chat).toBeVisible();

      const input = chat.getByLabel("Ask a question about your Library");
      // The textarea starts disabled until the mount-time conversation
      // fetch resolves (`disabled={!conversationId || ...}`); `.focus()`
      // silently no-ops on a disabled element (unlike `.fill()`, it carries
      // no actionability wait), which would otherwise leave focus sitting
      // on the panel's own Close button — and Enter activates a focused
      // button natively, closing the panel and making this test fail for a
      // reason that has nothing to do with the textarea's own Enter
      // handling. Waiting for enabled first is what every other test in
      // this file gets for free through `.fill()`'s own actionability wait.
      await expect(input).toBeEnabled();
      await input.focus();
      await page.keyboard.press("Enter");

      await expect(chat.getByText("Reading companion")).toBeVisible();
      await expect(chat.getByText("Library companion")).toHaveCount(0);
    });

    // `pending` (the streamed-answer accumulator) stays "" — and so the Ask
    // button/textarea's own `disabled` condition stays false — for the
    // whole gap between send and the first streamed token, so a live
    // request's real network latency is exactly the window a fast typist
    // could otherwise slip a second Enter through. A mocked, artificially
    // delayed SSE response makes that gap wide and deterministic instead of
    // racing real OpenAI latency; `handleQuestionKeyDown`'s explicit
    // `streaming` check (not just `pending`) is what actually closes it.
    test("Enter while a response is streaming does nothing", async ({ page }) => {
      await page.getByRole("button", { name: "Ask Library" }).click();
      const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
      await expect(chat).toBeVisible();

      await page.route("**/api/rag/conversations/*", async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const now = new Date().toISOString();
        const body = [
          `event: user\ndata: ${JSON.stringify({ id: "mock-user-1", role: "user", content: "Does courage also involve a settled state of character?", citations: [], claimCitations: [], createdAt: now, latencyMs: null })}`,
          `event: delta\ndata: ${JSON.stringify({ text: "Courage is treated as a settled disposition, not a momentary act." })}`,
          `event: done\ndata: ${JSON.stringify({ message: { id: "mock-assistant-1", role: "assistant", content: "Courage is treated as a settled disposition, not a momentary act.", citations: [], claimCitations: [], createdAt: now, latencyMs: 5 }, notFound: true })}`,
        ].join("\n\n") + "\n\n";
        await route.fulfill({ status: 200, contentType: "text/event-stream", body });
      });

      const input = chat.getByLabel("Ask a question about your Library");
      const askButton = chat.getByRole("button", { name: "Ask" });
      await input.fill("Does courage also involve a settled state of character?");
      await askButton.click();
      // Act inside the pre-first-token gap, well before the mocked 1s delay
      // elapses: the input is still enabled here (`pending` is still ""),
      // so only the keydown handler's own `streaming` check can be
      // stopping this from sending.
      await input.fill("A second question typed mid-stream");
      await page.keyboard.press("Enter");
      // Nothing was sent — the typed text is untouched (a genuine send
      // clears the draft), and still only the one exchange completes.
      await expect(input).toHaveValue("A second question typed mid-stream");
      await expect(chat.getByText("Library companion").last()).toBeVisible({ timeout: 5_000 });
      await expect(chat.getByText("Library companion")).toHaveCount(1);
    });

    test("Enter during IME composition does not send", async ({ page }) => {
      await page.getByRole("button", { name: "Ask Library" }).click();
      const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
      await expect(chat).toBeVisible();

      const input = chat.getByLabel("Ask a question about your Library");
      // See the "empty textarea" test above for why this wait matters:
      // `.focus()` no-ops on a still-disabled textarea, which would
      // otherwise leave the composition events and the Enter dispatch
      // below landing nowhere meaningful.
      await expect(input).toBeEnabled();
      await input.focus();
      // Simulate a CJK IME composing session: the candidate-committing
      // Enter must not be read as "send" — `isComposing` is what
      // `handleQuestionKeyDown` checks to tell the two apart.
      await input.dispatchEvent("compositionstart", { bubbles: true, cancelable: true });
      await page.keyboard.insertText("日本語");
      await input.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
      await input.dispatchEvent("compositionend", { bubbles: true, cancelable: true });

      await expect(input).toHaveValue("日本語");
      await expect(chat.getByText("Reading companion")).toBeVisible();
    });
  });

  test("keyboard Enter toggles the conversation history menu open, then closed", async ({ page }) => {
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();

    // `exact` avoids matching the panel's own "Close conversation history"
    // button, whose accessible name otherwise substring-contains this one
    // once the panel is open (the same ambiguity class D-19-1 fixed once
    // already for "Theme").
    const historyTrigger = chat.getByRole("button", { name: "Conversation history", exact: true });
    await historyTrigger.focus();
    await expect(historyTrigger).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    const history = chat.getByRole("dialog", { name: "Conversation history" });
    await expect(history).toBeVisible();
    await expect(historyTrigger).toHaveAttribute("aria-expanded", "true");

    // Opening moves focus into the panel (its own close button) — refocus
    // the trigger to simulate a keyboard user tabbing back to it, which is
    // what exercises the trigger's own toggle-to-close path.
    await historyTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(history).toBeHidden();
    await expect(historyTrigger).toHaveAttribute("aria-expanded", "false");
  });
});
