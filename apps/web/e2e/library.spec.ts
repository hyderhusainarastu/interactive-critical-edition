import { db, learningResources, readingRecords, users, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import {
  createVerifiedTestUser,
  deleteTestUser,
  seedOwnedWork,
  seedSearchableLibraryItem,
  seedWorkWithLibraryItem,
  seedWorkWithLibraryItems,
} from "./helpers";

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

  /**
   * Lane A live-issue fix: `getLibrary` explains WHY a score-less item has
   * no credibility instead of rendering the column blank. Class (a) is a
   * citation-projection stub (`resourceType` "unresolved-citation") never
   * sent to research by design; class (b) is a real resource whose
   * `normalizedKey` has no surviving assessed `research_resource` row
   * (neither item here has a `credibilityScore`, so neither seeds one).
   */
  test("explains credibility absence with the right reason for each score-less class", async ({ page }) => {
    const absenceEmail = `e2e-library-cred-absence-${Date.now()}@example.com`;
    const absenceUserId = await createVerifiedTestUser(absenceEmail, PASSWORD);
    const { workId } = await seedWorkWithLibraryItems(absenceUserId, "Absence focus", [
      { resourceTitle: "Cited stub without research", relationship: "explicit_reference", resourceType: "unresolved-citation" },
      { resourceTitle: "Orphaned durable source", relationship: "prerequisite", resourceType: "book" },
    ]);

    await page.goto("/login");
    await page.getByLabel("Email").fill(absenceEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto(`/library?focus=${workId}`);

    const libraryContent = page.locator("#main-content");
    const stubRow = libraryContent.locator("[data-library-item]").filter({ hasText: "Cited stub without research" });
    const orphanRow = libraryContent.locator("[data-library-item]").filter({ hasText: "Orphaned durable source" });
    await expect(stubRow.getByText("Cited in the text — not independently assessed")).toBeVisible();
    await expect(orphanRow.getByText(/No current assessment.*earlier analysis run/)).toBeVisible();
    await expect(libraryContent.getByText(/Only independently researched sources carry a credibility score/)).toBeVisible();

    await deleteTestUser(absenceEmail);
  });

  /**
   * Lane A live-issue fix: a top-level (non-attached) item whose
   * `workRole` is "review" labels itself "Book review" instead of the raw
   * `resourceType` label ("Article").
   */
  test("labels a standalone review item 'Book review' instead of its raw source type", async ({ page }) => {
    const reviewEmail = `e2e-library-review-label-${Date.now()}@example.com`;
    const reviewUserId = await createVerifiedTestUser(reviewEmail, PASSWORD);
    const { workId } = await seedWorkWithLibraryItems(reviewUserId, "Review label focus", [
      { resourceTitle: "A Review of the Text", relationship: "prerequisite", resourceType: "article", workRole: "review" },
    ]);

    await page.goto("/login");
    await page.getByLabel("Email").fill(reviewEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto(`/library?focus=${workId}`);

    const libraryContent = page.locator("#main-content");
    const row = libraryContent.locator("[data-library-item]").filter({ hasText: "A Review of the Text" });
    await expect(row.getByText("Book review", { exact: true })).toBeVisible();
    await expect(row.getByText("Article", { exact: true })).not.toBeVisible();

    await deleteTestUser(reviewEmail);
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

  /**
   * Phase 20.1: Library search. Server-authoritative — the debounced
   * client input calls `/api/library?q=...`, which re-runs the same
   * owner-scoped `getLibrary()` loader with a search filter, rather than
   * shipping the whole Library to the browser and filtering there.
   */
  test.describe("Library search (Phase 20.1)", () => {
    async function loginAs(page: import("@playwright/test").Page, email: string) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/dashboard");
    }

    test("title search narrows to the matching item", async ({ page }) => {
      const email = `e2e-library-search-title-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "The Structure of Scientific Revolutions" });
      await seedSearchableLibraryItem(userId, { resourceTitle: "An Essay Concerning Human Understanding" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      // These two items belong to two SEPARATE seeded works, so widen Focus
      // to "All works" first — the Library defaults Focus to the newest
      // upload, which would otherwise hide the other item regardless of
      // the search term (same pattern the pre-existing Focus-selector test
      // above uses).
      await content.getByLabel("Focus work", { exact: true }).selectOption("");
      await content.getByLabel("Search library").fill("Scientific Revolutions");
      await expect(content.getByRole("listitem").filter({ hasText: "The Structure of Scientific Revolutions" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "An Essay Concerning Human Understanding" })).not.toBeVisible();

      await deleteTestUser(email);
    });

    test("author search narrows to the matching item", async ({ page }) => {
      const email = `e2e-library-search-author-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "First Source", authors: ["Elizabeth Anscombe"] });
      await seedSearchableLibraryItem(userId, { resourceTitle: "Second Source", authors: ["Philippa Foot"] });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Focus work", { exact: true }).selectOption("");
      await content.getByLabel("Search library").fill("Anscombe");
      await expect(content.getByRole("listitem").filter({ hasText: "First Source" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "Second Source" })).not.toBeVisible();

      await deleteTestUser(email);
    });

    test("identifier search matches DOI and ISBN", async ({ page }) => {
      const email = `e2e-library-search-id-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "DOI Item", doi: "10.1234/abcd.5678" });
      await seedSearchableLibraryItem(userId, { resourceTitle: "ISBN Item", isbn: "978-0-14-044926-9" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Focus work", { exact: true }).selectOption("");

      await content.getByLabel("Search library").fill("10.1234/abcd.5678");
      await expect(content.getByRole("listitem").filter({ hasText: "DOI Item" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "ISBN Item" })).not.toBeVisible();

      await content.getByLabel("Search library").fill("978-0-14-044926-9");
      await expect(content.getByRole("listitem").filter({ hasText: "ISBN Item" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "DOI Item" })).not.toBeVisible();

      await deleteTestUser(email);
    });

    test("search normalizes diacritics and case", async ({ page }) => {
      const email = `e2e-library-search-diacritic-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "Épistémologie Générale" });
      await seedSearchableLibraryItem(userId, { resourceTitle: "Unrelated Other Title" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Focus work", { exact: true }).selectOption("");
      await content.getByLabel("Search library").fill("EPISTEMOLOGIE");
      await expect(content.getByRole("listitem").filter({ hasText: "Épistémologie Générale" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "Unrelated Other Title" })).not.toBeVisible();

      await deleteTestUser(email);
    });

    test("search combines correctly with Focus", async ({ page }) => {
      const email = `e2e-library-search-focus-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      const first = await seedSearchableLibraryItem(userId, { workTitle: "First Focus Work", resourceTitle: "Shared Term Alpha" });
      const second = await seedSearchableLibraryItem(userId, { workTitle: "Second Focus Work", resourceTitle: "Shared Term Beta" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Focus work", { exact: true }).selectOption("");
      await content.getByLabel("Search library").fill("Shared Term");
      await expect(content.getByRole("listitem").filter({ hasText: "Shared Term Alpha" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "Shared Term Beta" })).toBeVisible();

      await content.getByLabel("Focus work", { exact: true }).selectOption(first.workId);
      await expect(content.getByRole("listitem").filter({ hasText: "Shared Term Alpha" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "Shared Term Beta" })).not.toBeVisible();
      void second;

      await deleteTestUser(email);
    });

    test("search combines correctly with sort", async ({ page }) => {
      const email = `e2e-library-search-sort-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "Findable Zulu" });
      await seedSearchableLibraryItem(userId, { resourceTitle: "Findable Alpha" });
      await seedSearchableLibraryItem(userId, { resourceTitle: "Unrelated Item" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Focus work", { exact: true }).selectOption("");
      await content.getByLabel("Search library").fill("Findable");
      await expect(content.getByRole("listitem").filter({ hasText: "Findable Zulu" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "Unrelated Item" })).not.toBeVisible();

      await content.getByLabel("Sort").selectOption("title");
      const titles = await content.locator("[data-library-item]").evaluateAll((rows) => rows.map((row) => row.textContent?.trim() ?? ""));
      expect(titles[0]).toContain("Findable Alpha");
      expect(titles[1]).toContain("Findable Zulu");
      expect(titles.length).toBe(2);

      await deleteTestUser(email);
    });

    test("shows a deliberate no-results state naming the search term", async ({ page }) => {
      const email = `e2e-library-search-none-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "Something Findable" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Search library").fill("zzz-nonexistent-term-zzz");
      await expect(content.getByText(/No results for.*zzz-nonexistent-term-zzz/i)).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "Something Findable" })).not.toBeVisible();

      await deleteTestUser(email);
    });

    test("the result count is announced to assistive technology", async ({ page }) => {
      const email = `e2e-library-search-announce-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "Announced Result Item" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      const liveRegion = content.locator("[aria-live='polite']").first();
      await content.getByLabel("Search library").fill("Announced");
      await expect(liveRegion).toContainText(/1/);

      await deleteTestUser(email);
    });

    test("search input and clear button are keyboard-operable", async ({ page }) => {
      const email = `e2e-library-search-keyboard-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "Keyboard Findable Item" });
      await seedSearchableLibraryItem(userId, { resourceTitle: "Other Item" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Focus work", { exact: true }).selectOption("");
      const searchInput = content.getByLabel("Search library");
      await searchInput.focus();
      await page.keyboard.type("Keyboard Findable");
      await expect(content.getByRole("listitem").filter({ hasText: "Keyboard Findable Item" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "Other Item" })).not.toBeVisible();

      const clearButton = content.getByRole("button", { name: "Clear search" });
      await expect(clearButton).toBeVisible();
      await clearButton.focus();
      await page.keyboard.press("Enter");
      await expect(searchInput).toHaveValue("");
      await expect(content.getByRole("listitem").filter({ hasText: "Other Item" })).toBeVisible();

      await deleteTestUser(email);
    });

    test("preserves the search term in the URL", async ({ page }) => {
      const email = `e2e-library-search-url-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      await seedSearchableLibraryItem(userId, { resourceTitle: "URL Preserved Item" });

      await loginAs(page, email);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Search library").fill("URL Preserved");
      await expect(page).toHaveURL(/[?&]q=URL(\+|%20)Preserved/);

      // A deep link with the search term pre-applied works on first load too.
      await page.goto("/library?q=URL+Preserved");
      await expect(page.locator("#main-content").getByRole("listitem").filter({ hasText: "URL Preserved Item" })).toBeVisible();

      await deleteTestUser(email);
    });

    test("cross-account isolation: user A's search never returns user B's items", async ({ page }) => {
      const emailA = `e2e-library-search-isolation-a-${Date.now()}@example.com`;
      const emailB = `e2e-library-search-isolation-b-${Date.now()}@example.com`;
      const userIdA = await createVerifiedTestUser(emailA, PASSWORD);
      const userIdB = await createVerifiedTestUser(emailB, PASSWORD);
      await seedSearchableLibraryItem(userIdA, { resourceTitle: "Isolation Shared Keyword Alpha" });
      await seedSearchableLibraryItem(userIdB, { resourceTitle: "Isolation Shared Keyword Beta" });

      await loginAs(page, emailA);
      await page.goto("/library");
      const content = page.locator("#main-content");
      await content.getByLabel("Search library").fill("Isolation Shared Keyword");
      await expect(content.getByRole("listitem").filter({ hasText: "Isolation Shared Keyword Alpha" })).toBeVisible();
      await expect(content.getByRole("listitem").filter({ hasText: "Isolation Shared Keyword Beta" })).not.toBeVisible();

      await deleteTestUser(emailA);
      await deleteTestUser(emailB);
    });

    test("does not hide the active uploaded-work anchor when a search term is present", async ({ page }) => {
      const email = `e2e-library-search-anchor-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      const { workId } = await seedSearchableLibraryItem(userId, { workTitle: "Anchor Focus Work", resourceTitle: "Findable For Anchor Test" });

      await loginAs(page, email);
      await page.goto(`/library?focus=${workId}`);
      const content = page.locator("#main-content");
      await expect(content.locator(`[data-focus-work="${workId}"]`)).toContainText("Anchor Focus Work");
      await content.getByLabel("Search library").fill("zzz-matches-nothing-zzz");
      await expect(content.locator(`[data-focus-work="${workId}"]`)).toContainText("Anchor Focus Work");

      await deleteTestUser(email);
    });

    test("uploaded works page uses consistent 'Uploaded works' terminology (plan §20.2)", async ({ page }) => {
      const email = `e2e-library-terminology-${Date.now()}@example.com`;
      const userId = await createVerifiedTestUser(email, PASSWORD);
      const { workId } = await seedWorkWithLibraryItem(userId, { resourceTitle: "Terminology Test Item" });
      // Mark user as onboarded so /works doesn't redirect to /welcome
      await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));

      await loginAs(page, email);

      // The Works page should have "Uploaded works" as the title
      await page.goto("/works");
      await expect(page.getByRole("heading")).toContainText("Uploaded works");

      // Check Library page focuses on uploaded works with consistent terminology
      await page.goto(`/library?focus=${workId}`);
      const content = page.locator("#main-content");
      // The focus message should reference consistent terminology
      await expect(content).toContainText(/uploaded work|Uploaded work/i);

      await deleteTestUser(email);
    });
  });
});
