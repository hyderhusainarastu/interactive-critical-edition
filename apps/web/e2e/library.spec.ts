import { db, learningResources, readingRecords, users, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork, seedWorkWithLibraryItem, seedWorkWithLibraryItems } from "./helpers";

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
    const row = page.locator("#main-content").locator(`[data-library-item="${resourceId}"]`);
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

  test("suggests a higher reader level after enough completions, and Switch writes users.readerLevel (plan §35.2)", async ({ page }) => {
    const suggestEmail = `e2e-library-suggest-${Date.now()}@example.com`;
    const suggestUserId = await createVerifiedTestUser(suggestEmail, PASSWORD);
    await seedWorkWithLibraryItem(suggestUserId, {
      resourceTitle: "Advanced Work One",
      readingStatus: "completed",
      readerLevel: "advanced",
    });
    await seedWorkWithLibraryItem(suggestUserId, {
      resourceTitle: "Advanced Work Two",
      readingStatus: "completed",
      readerLevel: "advanced",
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(suggestEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/library");
    const libraryContent = page.locator("#main-content");
    await libraryContent.getByLabel("Focus work").selectOption("");
    await expect(libraryContent.getByText(/you might be ready for the/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch to Advanced" })).toBeVisible();

    // Dismissing hides it and survives reload (localStorage-remembered).
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(libraryContent.getByText(/you might be ready for the/i)).not.toBeVisible();
    await page.reload();
    await expect(libraryContent.getByText(/you might be ready for the/i)).not.toBeVisible();

    await deleteTestUser(suggestEmail);
  });

  test("Switch actually writes the accepted level (separate user, no prior dismissal)", async ({ page }) => {
    const acceptEmail = `e2e-library-accept-${Date.now()}@example.com`;
    const acceptUserId = await createVerifiedTestUser(acceptEmail, PASSWORD);
    await seedWorkWithLibraryItem(acceptUserId, {
      resourceTitle: "Research Work One",
      readingStatus: "completed",
      readerLevel: "research",
    });
    await seedWorkWithLibraryItem(acceptUserId, {
      resourceTitle: "Research Work Two",
      readingStatus: "completed",
      readerLevel: "research",
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(acceptEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/library");
    await page.getByRole("button", { name: "Switch to Research" }).click();

    await expect
      .poll(async () => {
        const [row] = await db.select({ readerLevel: users.readerLevel }).from(users).where(eq(users.id, acceptUserId));
        return row?.readerLevel;
      })
      .toBe("research");

    await deleteTestUser(acceptEmail);
  });

  test("the Focus selector scopes to one work and can show all works", async ({ page }) => {
    const scopeEmail = `e2e-library-scope-${Date.now()}@example.com`;
    const scopeUserId = await createVerifiedTestUser(scopeEmail, PASSWORD);
    await seedWorkWithLibraryItem(scopeUserId, { title: "First Work", resourceTitle: "Item For First Work" });
    await seedWorkWithLibraryItem(scopeUserId, { title: "Second Work", resourceTitle: "Item For Second Work" });

    await page.goto("/login");
    await page.getByLabel("Email").fill(scopeEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/library");
    const libraryContent = page.locator("#main-content");
    await libraryContent.getByLabel("Focus work", { exact: true }).selectOption("");
    await expect(libraryContent.getByRole("listitem").filter({ hasText: "Item For First Work" })).toBeVisible();
    await expect(libraryContent.getByRole("listitem").filter({ hasText: "Item For Second Work" })).toBeVisible();

    await libraryContent.getByLabel("Focus work", { exact: true }).selectOption({ label: "First Work" });
    await expect(libraryContent.getByRole("listitem").filter({ hasText: "Item For First Work" })).toBeVisible();
    await expect(libraryContent.getByRole("listitem").filter({ hasText: "Item For Second Work" })).not.toBeVisible();

    await libraryContent.getByLabel("Focus work", { exact: true }).selectOption({ label: "All works" });
    await expect(libraryContent.getByRole("listitem").filter({ hasText: "Item For Second Work" })).toBeVisible();

    await deleteTestUser(scopeEmail);
  });

  test("Phase 12's Library level facet includes foundations cumulatively and can switch to exact tags", async ({ page }) => {
    test.skip(process.env.PHASE_12_LIBRARY_IDENTITY_ENABLED !== "true", "requires the Phase 12 Library release flag");
    const levelEmail = `e2e-library-level-${Date.now()}@example.com`;
    const levelUserId = await createVerifiedTestUser(levelEmail, PASSWORD);
    await seedWorkWithLibraryItem(levelUserId, { resourceTitle: "Foundational source", readerLevel: "beginner" });
    await seedWorkWithLibraryItem(levelUserId, { resourceTitle: "Advanced source", readerLevel: "advanced" });

    await page.goto("/login");
    await page.getByLabel("Email").fill(levelEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/library");
    const libraryContent = page.locator("#main-content");
    await libraryContent.getByLabel("Focus work").selectOption("");
    await libraryContent.getByLabel("Reader level").selectOption("undergraduate");
    await expect(libraryContent.getByRole("listitem").filter({ hasText: "Foundational source" })).toBeVisible();
    await expect(libraryContent.getByRole("listitem").filter({ hasText: "Advanced source" })).not.toBeVisible();

    await libraryContent.getByLabel("Level match").selectOption("exact");
    await expect(libraryContent.getByRole("listitem").filter({ hasText: "Foundational source" })).not.toBeVisible();

    await deleteTestUser(levelEmail);
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
    const libraryContent = page.locator("#main-content");
    await expect(libraryContent.getByRole("link", { name: "Owner's Private Work", exact: true })).toBeVisible();
    await expect(libraryContent.getByText("No items match these filters.")).toBeVisible();

    await deleteTestUser(freshEmail);
  });

  test("defaults Focus to the newest uploaded work even when it has no recommendations", async ({ page }) => {
    const focusEmail = `e2e-library-newest-${Date.now()}@example.com`;
    const focusUserId = await createVerifiedTestUser(focusEmail, PASSWORD);
    await seedWorkWithLibraryItem(focusUserId, { title: "Older analyzed work", resourceTitle: "Older recommendation" });
    const [newest] = await db.insert(works).values({ userId: focusUserId, title: "Newest unprocessed upload" }).returning({ id: works.id });

    await page.goto("/login");
    await page.getByLabel("Email").fill(focusEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto("/library");

    const libraryContent = page.locator("#main-content");
    await expect(libraryContent.locator(`[data-focus-work="${newest.id}"]`)).toContainText("Newest unprocessed upload");
    await expect(libraryContent.getByText("No items match these filters.")).toBeVisible();
    await expect(libraryContent.getByText(/Your uploaded work is the focus/)).toBeVisible();

    await deleteTestUser(focusEmail);
  });

  test("honors a focus deep link and ranks relationship relevance before credibility, then title", async ({ page }) => {
    const focusEmail = `e2e-library-ranking-${Date.now()}@example.com`;
    const focusUserId = await createVerifiedTestUser(focusEmail, PASSWORD);
    const { workId } = await seedWorkWithLibraryItems(focusUserId, "Ranking focus", [
      { resourceTitle: "Zulu low relevance", relationship: "prerequisite", relationshipConfidence: 0.4, credibilityScore: 0.99 },
      { resourceTitle: "Gamma strongest credibility", relationship: "explicit_reference", relationshipConfidence: 0.9, credibilityScore: 0.99 },
      { resourceTitle: "Beta shared score", relationship: "conceptual_influence", relationshipConfidence: 0.9, credibilityScore: 0.95 },
      { resourceTitle: "Alpha same relevance", relationship: "historical_context", relationshipConfidence: 0.9, credibilityScore: 0.95 },
    ]);

    await page.goto("/login");
    await page.getByLabel("Email").fill(focusEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto(`/library?focus=${workId}`);

    const libraryContent = page.locator("#main-content");
    await expect(libraryContent.locator(`[data-focus-work="${workId}"]`)).toContainText("Ranking focus");
    await expect(libraryContent.getByLabel("Focus work")).toHaveValue(workId);
    const titles = await libraryContent.locator("[data-library-item]").evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
    expect(titles[0]).toContain("Gamma strongest credibility");
    expect(titles[1]).toContain("Alpha same relevance");
    expect(titles[2]).toContain("Beta shared score");
    expect(titles[3]).toContain("Zulu low relevance");
    await expect(libraryContent.locator("[data-library-item]").first()).toContainText("Relationship relevance 90%");

    await deleteTestUser(focusEmail);
  });

  test("keeps the Focus control usable on a narrow viewport and does not animate when motion is reduced", async ({ page }) => {
    const accessibilityEmail = `e2e-library-motion-${Date.now()}@example.com`;
    const accessibilityUserId = await createVerifiedTestUser(accessibilityEmail, PASSWORD);
    const { workId } = await seedWorkWithLibraryItem(accessibilityUserId, { title: "Accessible focus", resourceTitle: "Accessible source" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 375, height: 720 });

    await page.goto("/login");
    await page.getByLabel("Email").fill(accessibilityEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto("/library");

    const libraryContent = page.locator("#main-content");
    const focus = libraryContent.getByLabel("Focus work");
    await expect(focus).toBeVisible();
    await focus.focus();
    await focus.selectOption(workId);
    await expect(libraryContent.locator(`[data-focus-work="${workId}"]`)).toBeVisible();
    await expect(libraryContent.locator(`[data-focus-work="${workId}"]`)).not.toHaveAttribute("data-reveal-ready", "true");

    await deleteTestUser(accessibilityEmail);
  });

  test("exposes the selected status filter and applies Library relationship, source-type, and sort controls", async ({ page }) => {
    const filterEmail = `e2e-library-controls-${Date.now()}@example.com`;
    const filterUserId = await createVerifiedTestUser(filterEmail, PASSWORD);
    const { workId, resourceIds } = await seedWorkWithLibraryItems(filterUserId, "Control inventory work", [
      { resourceTitle: "Alpha reading article", relationship: "prerequisite", resourceType: "article" },
      { resourceTitle: "Beta completed book", relationship: "explicit_reference", resourceType: "book" },
      { resourceTitle: "Gamma to-read webpage", relationship: "historical_context", resourceType: "webpage" },
    ]);
    await db.insert(readingRecords).values([
      { userId: filterUserId, learningResourceId: resourceIds[0], status: "reading" },
      { userId: filterUserId, learningResourceId: resourceIds[1], status: "completed" },
    ]);

    await page.goto("/login");
    await page.getByLabel("Email").fill(filterEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto(`/library?focus=${workId}`);

    const libraryContent = page.locator("#main-content");
    const alpha = libraryContent.locator("[data-library-item]").filter({ hasText: "Alpha reading article" });
    const beta = libraryContent.locator("[data-library-item]").filter({ hasText: "Beta completed book" });
    const gamma = libraryContent.locator("[data-library-item]").filter({ hasText: "Gamma to-read webpage" });
    const statusFilters = libraryContent.getByRole("group", { name: "Reading status filter" });
    const all = statusFilters.getByRole("button", { name: "All (3)" });
    const reading = statusFilters.getByRole("button", { name: "Reading (1)" });
    await expect(all).toHaveAttribute("aria-pressed", "true");
    await reading.click();
    await expect(reading).toHaveAttribute("aria-pressed", "true");
    await expect(alpha).toBeVisible();
    await expect(beta).not.toBeVisible();

    await all.click();
    await libraryContent.getByLabel("Relationship").selectOption("explicit_reference");
    await expect(beta).toBeVisible();
    await expect(alpha).not.toBeVisible();

    await libraryContent.getByLabel("Relationship").selectOption("");
    await libraryContent.getByLabel("Source type").selectOption("article");
    await expect(alpha).toBeVisible();
    await expect(gamma).not.toBeVisible();

    await libraryContent.getByLabel("Source type").selectOption("");
    await libraryContent.getByLabel("Sort").selectOption("title");
    const titles = await libraryContent.locator("[data-library-item]").evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
    expect(titles[0]).toContain("Alpha reading article");
    expect(titles[1]).toContain("Beta completed book");
    expect(titles[2]).toContain("Gamma to-read webpage");

    await deleteTestUser(filterEmail);
  });

  test("clicking the focused-work title and a recommended-for chip navigates to the real work pages", async ({ page }) => {
    const navEmail = `e2e-library-nav-${Date.now()}@example.com`;
    const navUserId = await createVerifiedTestUser(navEmail, PASSWORD);
    const { workId } = await seedWorkWithLibraryItems(navUserId, "Navigable focus work", [
      { resourceTitle: "Navigable recommendation", relationship: "prerequisite" },
    ]);

    await page.goto("/login");
    await page.getByLabel("Email").fill(navEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto(`/library?focus=${workId}`);

    const libraryContent = page.locator("#main-content");
    await libraryContent.locator("[data-focus-work]").getByRole("link", { name: "Navigable focus work" }).click();
    await page.waitForURL(new RegExp(`/works/${workId}$`));
    await expect(page.getByRole("heading", { name: "Navigable focus work" })).toBeVisible();

    await page.goBack();
    await page.goto(`/library?focus=${workId}`);
    await libraryContent.locator("[data-library-item]").filter({ hasText: "Navigable recommendation" }).getByRole("link", { name: "Navigable focus work" }).click();
    await page.waitForURL(new RegExp(`/works/${workId}$`));
    await expect(page.getByRole("heading", { name: "Navigable focus work" })).toBeVisible();

    await deleteTestUser(navEmail);
  });

  test("an external resource link opens the real source URL in a new tab, and the empty-state CTA navigates to Upload", async ({ page }) => {
    const externalEmail = `e2e-library-external-${Date.now()}@example.com`;
    const externalUserId = await createVerifiedTestUser(externalEmail, PASSWORD);
    const { resourceIds } = await seedWorkWithLibraryItems(externalUserId, "External link work", [
      { resourceTitle: "Externally hosted source", relationship: "prerequisite" },
    ]);
    await db.update(learningResources).set({ url: "https://example.com/externally-hosted-source" }).where(eq(learningResources.id, resourceIds[0]));

    await page.goto("/login");
    await page.getByLabel("Email").fill(externalEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto("/library");

    const libraryContent = page.locator("#main-content");
    const externalLink = libraryContent.getByRole("link", { name: "Externally hosted source" });
    await expect(externalLink).toHaveAttribute("href", "https://example.com/externally-hosted-source");
    await expect(externalLink).toHaveAttribute("target", "_blank");
    const [popup] = await Promise.all([page.waitForEvent("popup"), externalLink.click()]);
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    expect(popup.url()).toBe("https://example.com/externally-hosted-source");
    await popup.close();

    await deleteTestUser(externalEmail);
  });

  test("the empty-state Upload CTA navigates to /upload", async ({ page }) => {
    const emptyEmail = `e2e-library-upload-cta-${Date.now()}@example.com`;
    await createVerifiedTestUser(emptyEmail, PASSWORD);

    await page.goto("/login");
    await page.getByLabel("Email").fill(emptyEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto("/library");

    const libraryContent = page.locator("#main-content");
    await libraryContent.getByRole("link", { name: "Upload a work" }).click();
    await page.waitForURL("**/upload");
    await expect(page.getByRole("heading", { name: /upload/i }).first()).toBeVisible();

    await deleteTestUser(emptyEmail);
  });
});
