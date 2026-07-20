import { db, readingRecords } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork, seedWorkWithLibraryItems } from "./helpers";

/**
 * Phase 9.6 E2E: the Curriculum / study guide page. `work_identity`/
 * `learning_resource`/`resource_role` are SEEDED rather than produced by a
 * real v3 run — same CI-safety reasoning as library.spec.ts/diagnostic.spec.ts
 * (no worker, no live model call). 9.6 has no new table and no new pipeline
 * stage: it's a read-time view over exactly what 9.5's Library already
 * writes, so what's under test is the reader-facing contract — stage
 * bucketing, the route filter, and completed items staying visible as
 * review-only rather than disappearing.
 */

const EMAIL = `e2e-curriculum-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Curriculum (Phase 9.6)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("buckets seeded items into their stages and the graduate route shows all of them", async ({ page }) => {
    const { workId } = await seedWorkWithLibraryItems(userId, "Vice and Reason", [
      { resourceTitle: "Prior Analytics", relationship: "prerequisite" },
      { resourceTitle: "The Republic", relationship: "conceptual_influence" },
      { resourceTitle: "A Commentary on the Ethics", relationship: "explicit_reference" },
      { resourceTitle: "Aristotle in Context", relationship: "historical_context" },
    ]);

    await login(page);
    await page.goto(`/works/${workId}/curriculum`);
    await expect(page.getByRole("heading", { name: "Curriculum" })).toBeVisible();

    // Graduate route (selected explicitly, since the default depends on the
    // reader's saved level) shows every seeded item across its stage.
    await page.getByLabel("Route").selectOption("graduate");
    await expect(page.getByText("Prior Analytics")).toBeVisible();
    await expect(page.getByText("The Republic")).toBeVisible();
    await expect(page.getByText("A Commentary on the Ethics")).toBeVisible();
    await expect(page.getByText("Aristotle in Context")).toBeVisible();

    // Prerequisites stage heading precedes Core engagement in document order
    // (STAGE_ORDER, plan §34.4 9.6's fixed pedagogical sequence).
    const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
    expect(headings.indexOf("Prerequisites")).toBeLessThan(headings.indexOf("Core engagement"));
  });

  test("the minimal route hides formative-context and interpretation-context items", async ({ page }) => {
    const { workId } = await seedWorkWithLibraryItems(userId, "A Narrower Work", [
      { resourceTitle: "Only Prereq", relationship: "prerequisite" },
      { resourceTitle: "Hidden In Minimal", relationship: "conceptual_influence" },
    ]);

    await login(page);
    await page.goto(`/works/${workId}/curriculum`);
    await page.getByLabel("Route").selectOption("minimal");

    await expect(page.getByText("Only Prereq")).toBeVisible();
    await expect(page.getByText("Hidden In Minimal")).not.toBeVisible();

    await page.getByLabel("Route").selectOption("graduate");
    await expect(page.getByText("Hidden In Minimal")).toBeVisible();
  });

  test("marking an item completed demotes it to review-only rather than removing it, and it survives reload", async ({ page }) => {
    const { workId, resourceIds } = await seedWorkWithLibraryItems(userId, "Reviewable Work", [
      { resourceTitle: "To Be Completed", relationship: "prerequisite" },
    ]);
    const resourceId = resourceIds[0];

    await login(page);
    await page.goto(`/works/${workId}/curriculum`);
    await page.getByLabel("Route").selectOption("graduate");

    const item = page.locator(`[data-curriculum-item="${resourceId}"]`);
    await expect(item).toBeVisible();
    await item.getByLabel(/Reading status of/).selectOption("completed");

    await expect
      .poll(async () => {
        const [record] = await db
          .select()
          .from(readingRecords)
          .where(and(eq(readingRecords.userId, userId), eq(readingRecords.learningResourceId, resourceId)));
        return record?.status;
      })
      .toBe("completed");

    // Still listed — completed items become review-only, never disappear.
    await expect(item).toBeVisible();
    await expect(item.getByText("review only")).toBeVisible();

    await page.reload();
    await page.getByLabel("Route").selectOption("graduate");
    await expect(page.locator(`[data-curriculum-item="${resourceId}"]`)).toBeVisible();
    await expect(page.locator(`[data-curriculum-item="${resourceId}"]`).getByText("review only")).toBeVisible();
  });

  test("a work with no v3 analysis shows an honest empty state, not a broken page", async ({ page }) => {
    const freshEmail = `e2e-curriculum-empty-${Date.now()}@example.com`;
    const freshUserId = await createVerifiedTestUser(freshEmail, PASSWORD);
    const { workId } = await seedOwnedWork(freshUserId); // v2-shaped, no work_identity

    await page.goto("/login");
    await page.getByLabel("Email").fill(freshEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto(`/works/${workId}/curriculum`);
    await expect(page.getByText(/only available once this work has been analyzed/)).toBeVisible();

    await deleteTestUser(freshEmail);
  });
});
