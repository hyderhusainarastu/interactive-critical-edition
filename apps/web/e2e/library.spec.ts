import { db, readingRecords } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork, seedWorkWithLibraryItem } from "./helpers";

/**
 * Phase 9.5 E2E: the Library page. `work_identity`/`learning_resource`/
 * `resource_role` are SEEDED rather than produced by the real v3 pipeline
 * (no worker, no live model call — same CI-safety reasoning as
 * edition.spec.ts/diagnostic.spec.ts). What's under test is the
 * reader-facing contract: seeded items render with their tabs/filters, and
 * the reading-state control actually writes `reading_record` scoped by
 * `learning_resource_id` through the real UI, not just the route in
 * isolation.
 */

const EMAIL = `e2e-library-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Library (Phase 9.5)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("renders a seeded item with its relationship, recommended-for chip, and tab counts", async ({ page }) => {
    const { workId } = await seedWorkWithLibraryItem(userId, {
      title: "Vice and Reason",
      resourceTitle: "Nicomachean Ethics",
      relationship: "prerequisite",
    });

    await login(page);
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    const item = page.getByRole("listitem").filter({ hasText: "Nicomachean Ethics" });
    await expect(item).toBeVisible();
    await expect(item.getByText("Prerequisite", { exact: true })).toBeVisible();
    await expect(item.getByRole("link", { name: "Vice and Reason" })).toBeVisible();

    // Unset reading status defaults to the "To read" tab.
    await expect(page.getByRole("button", { name: /To read \(\d+\)/ })).toBeVisible();

    await page.goto(`/works/${workId}`); // sanity: the chip actually links to the real work
    await expect(page).toHaveURL(new RegExp(`/works/${workId}$`));
  });

  test("the reading-status control writes reading_record scoped by learning_resource_id", async ({ page }) => {
    const { resourceId } = await seedWorkWithLibraryItem(userId, { resourceTitle: "Politics" });

    await login(page);
    await page.goto("/library");
    const row = page.locator(`[data-library-item="${resourceId}"]`);
    await expect(row).toBeVisible();
    await row.getByLabel(/Reading status of/).selectOption("reading");

    await expect
      .poll(async () => {
        const [record] = await db
          .select()
          .from(readingRecords)
          .where(and(eq(readingRecords.userId, userId), eq(readingRecords.learningResourceId, resourceId)));
        return record?.status;
      })
      .toBe("reading");

    // Survives reload — reads back from the DB, not just component state.
    await page.reload();
    await expect(row.getByLabel(/Reading status of/)).toHaveValue("reading");
  });

  test("a user with no v3-analyzed work sees an honest empty state, not a broken page", async ({ page }) => {
    const freshEmail = `e2e-library-empty-${Date.now()}@example.com`;
    const freshUserId = await createVerifiedTestUser(freshEmail, PASSWORD);
    await seedOwnedWork(freshUserId); // a v2-shaped work with no work_identity at all

    await page.goto("/login");
    await page.getByLabel("Email").fill(freshEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/library");
    await expect(page.getByText(/Nothing here yet/)).toBeVisible();

    await deleteTestUser(freshEmail);
  });
});
