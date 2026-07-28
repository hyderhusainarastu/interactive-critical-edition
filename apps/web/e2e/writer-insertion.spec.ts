import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedDebateCluster, seedWorkWithGraphData } from "./helpers";

/**
 * Integration step "writer-insertion-dialogs" (charter §6 "Write":
 * context-preserving insertion from Reader and Knowledge Map — explicitly
 * deferred by stage6-write-spec.md §11 to this pass). Both entry points
 * store a real excerpt via `sessionStorage` (`insertionHandoff.ts`),
 * navigate to `/writer/[projectId]`, and `WriterEditor.tsx` consumes it
 * once on mount — this file drives both surfaces through the real UI.
 */

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Writer insertion from Reader and Knowledge Map (integration step writer-insertion-dialogs)", () => {
  const EMAIL = `e2e-writer-insertion-${Date.now()}@example.com`;
  const PASSWORD = "password123";
  let workId = "";
  let claimAId = "";

  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    const seeded = await seedWorkWithGraphData(userId, { title: `Insertion source work ${Date.now()}` });
    workId = seeded.workId;
    const debate = await seedDebateCluster(userId, workId);
    claimAId = debate.claimAId;
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("Knowledge Map: 'Insert into Writer' on a selected claim node creates a project, inserts the real claim text, and links back to the exact graph context", async ({ page }) => {
    await login(page, EMAIL, PASSWORD);
    await page.goto(`/graph?ctxKind=claim&ctxId=${claimAId}&view=list&focus=all`);
    await expect(page.getByTestId("knowledge-map-list-view")).toBeVisible();

    const claimRow = page.locator(`[data-graph-node="claim:${claimAId}"]`);
    await expect(claimRow).toBeVisible();
    await claimRow.click();
    const inspector = page.getByTestId("knowledge-map-inspector");
    await expect(inspector).toBeVisible();

    const insertButton = inspector.getByRole("button", { name: "Insert into Writer" });
    await expect(insertButton).toBeVisible();
    await insertButton.click();

    const dialog = page.getByRole("dialog", { name: "Insert into Writer" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("The soul is inseparable from the body it is the form of.");
    // No existing Writer projects yet for this fresh user — the dialog must
    // default straight to "a new project", not an empty/unusable select.
    const titleInput = dialog.getByRole("textbox");
    await titleInput.fill("Soul-body debate notes");
    await dialog.getByRole("button", { name: "Insert into Writer" }).click();

    await page.waitForURL("**/writer/*");
    // A `<textarea>`'s DOM `textContent` reflects its SSR-rendered default,
    // not the current controlled value React sets via the `value` prop —
    // `toHaveValue` (matching the actual input value) is the correct
    // assertion here, the same convention `writer-panels.spec.ts` already
    // uses for this exact element.
    const draft = page.getByLabel("Draft");
    await expect(draft).toHaveValue(/The soul is inseparable from the body it is the form of\./);
    await expect(draft).toHaveValue(/Claim, Knowledge Map/);
    await expect(page.getByText("Inserted from Knowledge Map.")).toBeVisible();

    // Reversible navigation (charter §16 journey 5): the notice's own link
    // returns to the exact graph context the excerpt came from.
    await page.getByRole("link", { name: "Return to source" }).click();
    await expect(page.getByTestId("knowledge-map-inspector")).toBeVisible();
    await expect(page.getByTestId("knowledge-map-inspector")).toContainText("The soul is inseparable from the body it is the form of.");
  });

  test("Reader Claims tab: 'Insert into Writer' inserts the claim's real supporting excerpt into an existing project", async ({ page }) => {
    test.skip(process.env.PHASE_25_READER_CLAIM_LAYER_ENABLED !== "true", "requires the local-only Phase 25 readerClaimLayer gate");
    await login(page, EMAIL, PASSWORD);

    // An existing Writer project so this run exercises the "pick an
    // existing project" branch, complementing the Knowledge Map test above
    // (which exercises "create a new project").
    await page.goto("/writer");
    page.once("dialog", (dialog) => dialog.accept("Reader insertion target project"));
    await page.getByRole("button", { name: "New project" }).click();
    await page.waitForURL("**/writer/*");
    const targetProjectId = new URL(page.url()).pathname.split("/").at(-1)!;

    await page.goto(`/works/${workId}/reader`);
    await page.getByRole("button", { name: /Claims/ }).click();
    // `seedDebateCluster` seeds TWO claims on this same work — scope to the
    // specific claim card (claimAId's own text), never `.first()`, so this
    // assertion can't silently pass against the wrong card.
    const claimCard = page.locator("li", { hasText: "The soul is inseparable from the body it is the form of." });
    await claimCard.getByRole("button", { name: "Evidence and details" }).click();

    const insertButton = claimCard.getByRole("button", { name: "Insert into Writer" });
    await expect(insertButton).toBeVisible();
    await insertButton.click();

    const dialog = page.getByRole("dialog", { name: "Insert into Writer" });
    await expect(dialog).toBeVisible();
    // Freshly created, most-recently-updated project sorts first
    // (`listWriterProjects`'s own `desc(updatedAt)` ordering) — the dialog's
    // "existing project" radio/select must default to it. `<option>` text
    // inside a closed native `<select>` isn't reliably "visible" to
    // Playwright, so this checks the select's own resolved value instead of
    // an option's visibility (the same `toHaveValue`-not-`toBeVisible`
    // reasoning `writer-panels.spec.ts` already applies to this component's
    // other native `<select>`s).
    await expect(dialog.getByRole("combobox")).toHaveValue(targetProjectId);
    await dialog.getByRole("button", { name: "Insert into Writer" }).click();

    await page.waitForURL("**/writer/*");
    expect(page.url()).toContain(targetProjectId);
    const draft = page.getByLabel("Draft");
    await expect(draft).toHaveValue(/The soul is inseparable from the body it is the form of\./);
    await expect(page.getByText("Inserted from Reader.")).toBeVisible();
  });
});
