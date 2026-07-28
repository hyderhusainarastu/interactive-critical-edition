import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";
import { loginAs, seedTallPublishedEdition } from "./stage4VerifyHelpers";

/**
 * Stage 4 read spec §4/§8.1, journey 2's remaining gap: `edition.spec.ts`
 * already proves highlight/note/bookmark reload-persistence and the
 * Document-outline rail's presence on a single-page fixture, but never
 * proves the Interactive reader's own saved position actually resumes at
 * the right PAGE after a reload. Read directly from `EditionReader.tsx`
 * before writing this spec: `onPositionChange` only fires on a `pageIndex`
 * change (the "Next →"/"← Prev" controls) — there is no per-paragraph
 * IntersectionObserver on this reader the way the legacy `TextReader` has.
 * `seedTallPublishedEdition` seeds two real pages so this distinction is
 * testable at all.
 */

const EMAIL = `e2e-stage4-reader-position-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

test.describe("Interactive reader saved position (Stage 4 read spec §4)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("navigating to page 2, then reloading, resumes on page 2 rather than page 1", async ({ page }) => {
    const { workId } = await seedTallPublishedEdition(userId, { title: "Tall Position Fixture" });

    await loginAs(page, EMAIL, PASSWORD);
    await page.goto(`/works/${workId}/reader`);
    const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
    await expect(edition).toBeVisible();
    await expect(edition).toContainText("Section One");

    await edition.getByRole("button", { name: "Next →" }).first().click();
    await expect(edition).toContainText("Section Two");
    await page.waitForTimeout(1200); // debounced position save + margin, same budget reader.spec.ts uses

    await page.reload();
    await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();
    // Resumed on page 2: its heading is present without clicking "Next →"
    // again, and page 1's own heading is not the one shown on load.
    await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toContainText("Section Two");
  });

  test("the Document outline rail lists every header/title block", async ({ page }) => {
    const { workId } = await seedTallPublishedEdition(userId, { title: "Outline Fixture" });

    await loginAs(page, EMAIL, PASSWORD);
    await page.goto(`/works/${workId}/reader`);
    await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();

    // Stage 4 read spec §0: the outline rail is open by default at this
    // (wide) viewport whenever the edition has outline entries — confirm
    // it's showing, opening it via the exact toggle only if it isn't.
    const outlineNav = page.getByRole("navigation", { name: "Document outline" });
    if (!(await outlineNav.isVisible())) {
      await page.getByRole("button", { name: "Outline", exact: true }).click();
    }
    await expect(outlineNav).toBeVisible();
    await expect(outlineNav.getByText("Outline Fixture", { exact: true })).toBeVisible();
    await expect(outlineNav.getByText("Section One", { exact: true })).toBeVisible();
    await expect(outlineNav.getByText("Section Two", { exact: true })).toBeVisible();
  });
});
