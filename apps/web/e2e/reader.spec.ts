import { expect, test } from "@playwright/test";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

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

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function uploadAndConfirm(page: import("@playwright/test").Page, filePath: string, title: string) {
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.waitForURL(/\/works\/[a-f0-9-]+$/);
  await expect(page.getByText("Confirm or correct")).toBeVisible({ timeout: 15000 });
  const titleInput = page.locator('input[name="title"]');
  await titleInput.fill(title);
  await page.getByRole("button", { name: "Confirm and add to library" }).click();
  await expect(page.getByRole("link", { name: "Open reader" })).toBeVisible({ timeout: 5000 });
  const workId = page.url().split("/works/")[1];
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
    const filePath = join(tmpdir(), `e2e-reader-${Date.now()}.txt`);
    writeFileSync(filePath, TEXT_FIXTURE);

    await login(page);
    const workId = await uploadAndConfirm(page, filePath, "Being and Time");

    await page.goto(`/works/${workId}/reader`);
    const paragraph = page.locator('[data-paragraph-index="0"]');
    await expect(paragraph).toBeVisible();

    // Footnote marker renders and is clickable, distinct from user notes.
    await page.locator(".reader-footnote-marker").first().click();
    await expect(page.getByText("Original note [1]")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

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

  test("split view opens a second work alongside the first", async ({ page }) => {
    const fileA = join(tmpdir(), `e2e-split-a-${Date.now()}.txt`);
    const fileB = join(tmpdir(), `e2e-split-b-${Date.now()}.txt`);
    writeFileSync(fileA, "First Work\n\nSome opening text for the first work.");
    writeFileSync(fileB, "Second Work\n\nSome opening text for the second work.");

    await login(page);
    await uploadAndConfirm(page, fileA, "First Work");
    const workIdB = await uploadAndConfirm(page, fileB, "Second Work");

    await page.goto(`/works/${workIdB}/reader`);
    await page.getByRole("button", { name: "Split view" }).click();
    await page.getByRole("button", { name: "First Work" }).click();

    // Both readers' titles are visible at once.
    await expect(page.getByText("Second Work").first()).toBeVisible();
    await expect(page.getByText("First Work").first()).toBeVisible();

    await page.getByRole("button", { name: "Close split" }).click();
    await expect(page.getByText("First Work")).toHaveCount(0);
  });
});
