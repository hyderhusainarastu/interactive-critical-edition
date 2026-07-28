import { db, documents, pages, processingRuns, researchClaims, researchProjectMembers, textBlocks, users, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Stage 5 "claims-dialogs" step: `CreateResearchProjectDialog` (replacing
 * `ResearchProjectsView.tsx`'s `window.prompt`, spec §5.1) and
 * `ResearchClaimsTable`'s responsive card/table dual render (spec §7).
 * CI-safe in spirit — seeded directly against Postgres, no worker/live
 * model call — but run as a manual full-stack file like the rest of the
 * research suite (shares the default dev server on :3000, no dedicated
 * spawned port needed since nothing here depends on a feature flag being
 * off).
 *
 * Same `#main-content` scoping precedent as `research.spec.ts` (D-19-36:
 * Next's hidden streaming-SSR holder can otherwise double-match a bare
 * `page.getByText`).
 */
function main(page: Page) {
  return page.locator("#main-content");
}

const EMAIL = `e2e-research-dialogs-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function markOnboarded(id: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, id));
}

async function createProjectViaApi(page: Page, title: string): Promise<string> {
  const response = await page.request.post("/api/research/projects", { data: { title } });
  const body = await response.json();
  return body.project.id as string;
}

/** One minimal anchored claim on a published work — just enough for the
 *  claims table's table/card dual render, not the full fixture
 *  `research.spec.ts`'s own tests need (scores/loci/job requests). */
async function seedOneClaim(ownerId: string, workTitle: string) {
  const bodyText = "The account of practical wisdom in Book VI grounds the whole discussion of virtue.";
  const [work] = await db.insert(works).values({ userId: ownerId, title: workTitle, authorName: "Test Author" }).returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId: ownerId,
      workId: work.id,
      storagePath: `${ownerId}/${work.id}/edition.txt`,
      originalFilename: "edition.txt",
      mimeType: "text/plain",
      fileSize: 200,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: bodyText,
    })
    .returning({ id: documents.id });
  const [run] = await db
    .insert(processingRuns)
    .values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true, degraded: false })
    .returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text: bodyText }).returning({ id: pages.id });
  const [bodyBlock] = await db
    .insert(textBlocks)
    .values({ pageId: page.id, blockOrder: 0, kind: "body", text: bodyText })
    .returning({ id: textBlocks.id });
  await db.insert(researchClaims).values({
    userId: ownerId,
    workId: work.id,
    processingRunId: run.id,
    textBlockId: bodyBlock.id,
    quote: "practical wisdom in Book VI",
    prefix: "The account of ",
    suffix: " grounds",
    anchorState: "anchored",
    claimText: "The account of practical wisdom in Book VI grounds the whole discussion of virtue.",
    claimNature: "interpretive",
    confidence: "high",
    section: "",
    sourceScope: "full_text",
    supportingExcerpt: "The account of practical wisdom in Book VI grounds",
    excerptVerified: true,
    contentHash: `e2e-research-dialogs-${work.id}`,
    promptVersion: "claim-extraction-v1",
    status: "active",
    verificationStatus: "unreviewed",
  });
  return { workId: work.id };
}

test.describe("Research claims/dialogs responsiveness (Stage 5 claims-dialogs)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("CreateResearchProjectDialog: Escape closes it and restores focus to the trigger", async ({ page }) => {
    await login(page);
    await page.goto("/research");
    const trigger = main(page).getByRole("button", { name: "New project" });
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: /New research project/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Project title")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("CreateResearchProjectDialog: Tab cycles only within the dialog", async ({ page }) => {
    await login(page);
    await page.goto("/research");
    await main(page).getByRole("button", { name: "New project" }).click();

    const dialog = page.getByRole("dialog", { name: /New research project/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Project title")).toBeFocused();

    // Same "Shift+Tab from the first focusable wraps within the surface"
    // precedent `workspace-shell.spec.ts` already applies to the command
    // palette and workspace-preferences dialogs.
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
  });

  test("CreateResearchProjectDialog: Create stays disabled for an empty or whitespace-only title", async ({ page }) => {
    await login(page);
    await page.goto("/research");
    await main(page).getByRole("button", { name: "New project" }).click();

    const dialog = page.getByRole("dialog", { name: /New research project/i });
    const titleField = dialog.getByLabel("Project title");
    const createButton = dialog.getByRole("button", { name: "Create" });

    // The default-filled title starts non-empty, so Create starts enabled.
    await expect(createButton).toBeEnabled();

    await titleField.fill("");
    await expect(createButton).toBeDisabled();

    await titleField.fill("   ");
    await expect(createButton).toBeDisabled();

    await titleField.fill("A real title");
    await expect(createButton).toBeEnabled();
  });

  test("CreateResearchProjectDialog: a simulated API failure shows the inline error with the dialog still open and the typed title preserved", async ({ page }) => {
    await login(page);
    await page.goto("/research");

    await page.route("**/api/research/projects", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated project-creation failure." }) });
        return;
      }
      await route.continue();
    });

    await main(page).getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: /New research project/i });
    const titleField = dialog.getByLabel("Project title");
    await titleField.fill("Doomed project");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog.getByText("Simulated project-creation failure.")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(titleField).toHaveValue("Doomed project");
  });

  test("responsive claims: renders as cards below 768px and as a table at or above it", async ({ page }) => {
    const fixture = await seedOneClaim(userId, "Responsive claims work");
    await login(page);
    const projectId = await createProjectViaApi(page, "Responsive claims project");
    await db.insert(researchProjectMembers).values({ projectId, memberType: "work", workId: fixture.workId, role: "central" });

    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto(`/research/${projectId}/claims`);
    await expect(main(page).getByRole("heading", { name: "Claims" })).toBeVisible();
    // Below 768px the table's wrapper is `hidden` (`display: none`), which
    // removes it from the accessibility tree — `getByRole` (unlike a plain
    // CSS locator) excludes it, so `toHaveCount(0)` here proves it is truly
    // absent to assistive tech, not merely visually hidden.
    await expect(main(page).getByRole("table")).toHaveCount(0);
    const cardList = main(page).getByRole("list", { name: `Claims for Responsive claims project` });
    await expect(cardList).toBeVisible();
    await expect(cardList.getByRole("link", { name: /The account of practical wisdom/ })).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await expect(main(page).getByRole("heading", { name: "Claims" })).toBeVisible();
    await expect(main(page).getByRole("table")).toBeVisible();
    await expect(main(page).getByRole("list", { name: `Claims for Responsive claims project` })).toHaveCount(0);
  });
});
