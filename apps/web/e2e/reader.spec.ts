import { expect, test } from "@playwright/test";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createVerifiedTestUser, deleteTestUser, uploadAndConfirmViaUI, uploadOneFileViaUI } from "./helpers";

const EMAIL = `e2e-reader-${Date.now()}@example.com`;
const PASSWORD = "password123";

const TEXT_FIXTURE = `Being and Time

The question of the meaning of Being must be raised anew [1]. It has today been forgotten, even though our own time considers itself progressive.

Every inquiry is a seeking. Every seeking gets guided beforehand by what is sought [2].

Dasein is an entity which does not just occur among other entities.

Notes

1. Plato, Sophist, 244a.
2. This formulation echoes the hermeneutic circle.
`;

/** A minimal, valid text-layer PDF generated in-process so the upload suite
 * covers the direct-to-Storage PDF path without carrying a binary fixture. */
function createPdf(text: string) {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const content = `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Title (Direct Upload PDF) /Author (E2E) >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function uploadAndConfirm(page: import("@playwright/test").Page, filePath: string, title: string) {
  // Generous timeout: since Phase 4, confirming a work also enqueues an
  // analysis job, so the single local worker can be busy with live
  // bibliographic lookups and the extract-text job may queue behind them.
  // uploadAndConfirmViaUI also tolerates pipeline v2's auto-ready bypass
  // (high-confidence title detection skips the manual confirm form
  // entirely — see D-19-6), which a fixture with a clean title-first-line
  // like these routinely triggers.
  const workId = await uploadAndConfirmViaUI(page, filePath, title);
  return workId;
}

test.describe("Reader (Phase 3)", () => {
  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("upload, highlight, note, and resume reading position", async ({ page }) => {
    // Generous: pipeline v2+ runs its whole research/classification pass
    // before this document is even confirmable (D-19-6).
    test.setTimeout(240_000);
    const filePath = join(tmpdir(), `e2e-reader-${Date.now()}.txt`);
    writeFileSync(filePath, TEXT_FIXTURE);

    await login(page);
    const workId = await uploadAndConfirm(page, filePath, "Being and Time");

    await page.goto(`/works/${workId}/reader`);
    // Phase 11.5 made "Published edition" the default view whenever an
    // edition exists (pipeline v2+); this test exercises the processed
    // paragraph view, so switch to it if the toggle is present. No toggle
    // at all means no edition was published (e.g. pipeline v1), in which
    // case the processed view is already what's shown.
    const interactiveToggle = page.getByRole("button", { name: "Interactive reader" });
    if (await interactiveToggle.isVisible().catch(() => false)) await interactiveToggle.click();
    const paragraph = page.locator('[data-paragraph-index="0"]');
    await expect(paragraph).toBeVisible();

    // Footnote marker renders and is clickable, distinct from user notes.
    // The modal is a real keyboard dialog (Phase 19 D-19 audit, same
    // disclosure standard as D-19-18/19/20): it names itself, moves focus to
    // its close control, Escape dismisses it, and focus returns to the
    // marker that opened it — checked both via Escape and via the visible
    // Close button, since either is a real user path.
    const firstFootnoteMarker = page.locator(".reader-footnote-marker").first();
    await firstFootnoteMarker.click();
    const footnoteDialog = page.getByRole("dialog", { name: "Original note [1]" });
    await expect(footnoteDialog).toBeVisible();
    await expect(footnoteDialog.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(footnoteDialog).toHaveCount(0);
    await expect(firstFootnoteMarker).toBeFocused();

    await firstFootnoteMarker.click();
    await expect(page.getByText("Original note [1]")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(firstFootnoteMarker).toBeFocused();

    // --- Annotation-position accuracy: select text, highlight it, and
    // confirm it survives a fresh render (reload), not just the
    // in-memory state right after creation (plan §25 risk R3).
    // Paragraph 0 is the title line ("Being and Time"); paragraph 1 is
    // the first real body paragraph, which is what gets highlighted.
    const contentParagraph = page.locator('[data-paragraph-index="1"]');
    await page.evaluate(() => {
      const el = document.querySelector('[data-paragraph-index="1"]')!;
      const textNode = el.childNodes[0];
      const range = document.createRange();
      range.setStart(textNode, 4);
      range.setEnd(textNode, 21); // "question of the meani"
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await contentParagraph.dispatchEvent("mouseup");
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    await expect(contentParagraph.locator("mark[data-highlight-id]")).toBeVisible();

    // Add a standalone note via the sidebar.
    await page.getByPlaceholder("Write a note about this work…").fill("Test note from Playwright");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Test note from Playwright")).toBeVisible();

    // Bookmark the current position — no scrolling has happened yet, so
    // the observer still reports paragraph 0 (the title) as in view.
    await page.getByRole("button", { name: "+ Bookmark" }).click();
    await expect(page.getByText("Paragraph 1")).toBeVisible();

    // Scroll to a later paragraph so reading position moves past paragraph 1.
    await page.locator('[data-paragraph-index="3"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200); // debounced position save (800ms) + margin

    // --- Reading-position persistence: reload (simulating "close the
    // tab, reopen the work") and confirm it resumes near paragraph 3,
    // not back at the top.
    await page.reload();
    await expect(page.locator('[data-paragraph-index="3"]')).toBeInViewport({ timeout: 5000 });

    // Highlight is still there after the reload too (re-anchored by quote, not by transient state).
    await expect(page.locator('[data-paragraph-index="1"] mark[data-highlight-id]')).toBeVisible();
  });

  test("a PDF reaches a terminal processing state", async ({ page }) => {
    const filePath = join(tmpdir(), `e2e-direct-upload-${Date.now()}.pdf`);
    writeFileSync(filePath, createPdf("Direct upload PDF verification"));

    await login(page);
    await uploadOneFileViaUI(page, filePath);
    await expect(page.getByText(/Confirm or correct the detected metadata before this work is added to your library\.|Ready/)).toBeVisible({ timeout: 45000 });
    await expect(page.getByText("Processing failed")).toHaveCount(0);
  });

  test("upload falls back to JSON when both raw file transports are blocked", async ({ page }) => {
    const filePath = join(tmpdir(), `e2e-json-upload-${Date.now()}.txt`);
    writeFileSync(filePath, "JSON Upload Fallback\n\nThe browser blocked File bodies, but JSON remains available.");

    let blockedDirect = false;
    let blockedRawProxy = false;
    let sawJsonProxy = false;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const contentType = request.headers()["content-type"] ?? "";
      if (request.method() === "PUT" && request.url().includes("supabase")) {
        blockedDirect = true;
        await route.abort("connectionfailed");
        return;
      }
      if (request.url().includes("/api/works/upload/proxy")) {
        if (contentType.startsWith("application/json")) {
          sawJsonProxy = true;
        } else {
          blockedRawProxy = true;
          await route.abort("connectionfailed");
          return;
        }
      }
      await route.continue();
    });

    await login(page);
    await uploadOneFileViaUI(page, filePath);
    await expect(page.getByText(/Confirm or correct|Ready/)).toBeVisible({ timeout: 45_000 });
    expect(blockedDirect).toBe(true);
    expect(blockedRawProxy).toBe(true);
    expect(sawJsonProxy).toBe(true);
  });

  test("split view opens a second work alongside the first", async ({ page }) => {
    // Generous: two sequential real uploads, each subject to D-19-6's
    // pipeline-v2 timing.
    test.setTimeout(360_000);
    const fileA = join(tmpdir(), `e2e-split-a-${Date.now()}.txt`);
    const fileB = join(tmpdir(), `e2e-split-b-${Date.now()}.txt`);
    writeFileSync(fileA, "First Work\n\nSome opening text for the first work.");
    writeFileSync(fileB, "Second Work\n\nSome opening text for the second work.");

    await login(page);
    await uploadAndConfirm(page, fileA, "First Work");
    const workIdB = await uploadAndConfirm(page, fileB, "Second Work");

    await page.goto(`/works/${workIdB}/reader`);
    const splitViewTrigger = page.getByRole("button", { name: "Split view" });
    await expect(splitViewTrigger).toHaveAttribute("aria-expanded", "false");
    await splitViewTrigger.click();
    await expect(splitViewTrigger).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("group", { name: "Choose a work for split view" }).getByRole("button", { name: "First Work" }).click();

    // Selecting a real work closes the chooser disclosure (D-19-18's picker
    // is replaced by the "Exit split view" control once a pane is active)
    // and both readers' titles are visible at once — the non-empty
    // selection path the D-19-18 fix's own regression left pending.
    await expect(page.getByRole("group", { name: "Choose a work for split view" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Exit split view" })).toBeVisible();
    await expect(page.getByText("Second Work").first()).toBeVisible();
    await expect(page.getByText("First Work").first()).toBeVisible();

    await page.getByRole("button", { name: "Close split" }).click();
    await expect(page.getByText("First Work")).toHaveCount(0);
  });

  test("published edition is available without replacing the interactive reader", async ({ page }) => {
    // Generous: pipeline v2+ runs its whole research/classification pass
    // before this document is even confirmable (D-19-6). This fixture
    // explicitly cites Kant, so the research pass has real work to do.
    test.setTimeout(240_000);
    const filePath = join(tmpdir(), `e2e-edition-${Date.now()}.txt`);
    writeFileSync(filePath, "Edition Test\n\nA source text that cites Kant, Critique of Pure Reason, 1781.");
    await login(page);
    const workId = await uploadAndConfirm(page, filePath, "Edition Test");
    await page.goto(`/works/${workId}/reader`);
    // Phase 11.5 made "Published edition" (the immutable original source)
    // the default view whenever an edition exists — the reverse of this
    // test's original assumption that the processed/paragraph view came
    // first. Assert the real default, then round-trip the toggle both ways
    // to confirm neither view destroys the other.
    await expect(page.getByRole("region", { name: "Published edition — original source text" })).toBeVisible();
    await page.getByRole("button", { name: "Interactive reader" }).click();
    await expect(page.locator('[data-paragraph-index="0"]')).toBeVisible();
    await page.getByRole("button", { name: "Published edition" }).click();
    await expect(page.getByRole("region", { name: "Published edition — original source text" })).toBeVisible();
  });

});
