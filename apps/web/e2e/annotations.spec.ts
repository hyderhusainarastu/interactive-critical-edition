import { expect, test } from "@playwright/test";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 4 E2E: upload → confirm → the worker's scholarly-analysis job runs
 * → AI annotations appear in the reader with category coding, confidence,
 * and provenance → the user approves one → the decision survives a reload.
 *
 * Requires the full local stack running (web + worker + Postgres), same as
 * reader.spec.ts — the worker is what processes the analyze-work job. With
 * no AI key configured, classification uses the deterministic heuristic
 * fallback, which is exactly what this asserts on (the pipeline, not model
 * quality). Not CI-wired yet (see playwright.config.ts / docs/PROJECT-LOG.md).
 */

const EMAIL = `e2e-annot-${Date.now()}@example.com`;
const PASSWORD = "password123";

const FIXTURE = `On the Question of Being

Heidegger's inquiry reopens a question the tradition let fall dormant. Kant's
transcendental analysis first cleared the ground for it, and the whole project
remains deeply indebted to Husserl's phenomenological method.

References

Kant, Immanuel. Critique of Pure Reason. 1781.
Husserl, Edmund. Logical Investigations. 1900.
`;

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Scholarly analysis (Phase 4)", () => {
  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("analysis produces category-coded annotations the user can approve, and the approval persists", async ({
    page,
  }) => {
    const filePath = join(tmpdir(), `e2e-annot-${Date.now()}.txt`);
    writeFileSync(filePath, FIXTURE);

    await login(page);

    // Upload + confirm — confirming enqueues the analyze-work job.
    await page.goto("/upload");
    await page.locator('input[type="file"]').setInputFiles(filePath);
    await page.waitForURL(/\/works\/[a-f0-9-]+$/);
    // Generous: the single local worker also runs analysis jobs (with live
    // bibliographic lookups) from other specs, so the extract-text job can
    // queue behind them. Extraction itself is fast.
    await expect(page.getByText("Confirm or correct")).toBeVisible({ timeout: 45000 });
    await page.locator('input[name="title"]').fill("On the Question of Being");
    await page.getByRole("button", { name: "Confirm and add to library" }).click();
    await expect(page.getByRole("link", { name: "Open reader" })).toBeVisible({ timeout: 5000 });
    const workId = page.url().split("/works/")[1];

    // Open the reader; the analysis panel is visible by default.
    await page.goto(`/works/${workId}/reader`);
    await expect(page.getByRole("heading", { name: "Scholarly analysis" })).toBeVisible();

    // The worker processes the job; wait for it to complete (bibliographic
    // lookups hit live APIs, so allow generous time).
    await expect(page.getByText("Complete", { exact: true })).toBeVisible({ timeout: 60000 });

    // At least one annotation card rendered, with a confidence readout.
    const firstCard = page.locator("[data-annotation-card]").first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard.getByText(/%$/)).toBeVisible(); // "…· 60%"

    // The disclaimer is present (plan §12).
    await expect(page.getByText(/AI-assisted research aid/)).toBeVisible();

    // Capture the card's id so we can find the *same* annotation after a
    // reload (order is stable, but assert on identity, not position).
    const cardId = await firstCard.getAttribute("data-annotation-card");

    // Approve it, then confirm the decision persists across a reload.
    await firstCard.getByRole("button", { name: "Verify" }).click();
    await expect(firstCard.getByText("Verified by you")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Complete", { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.locator(`[data-annotation-card="${cardId}"]`).getByText("Verified by you")).toBeVisible();
  });
});
