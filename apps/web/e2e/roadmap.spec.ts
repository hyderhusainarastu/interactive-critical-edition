import { expect, test } from "@playwright/test";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createVerifiedTestUser, deleteTestUser, uploadAndConfirmViaUI } from "./helpers";

/**
 * Phase 5 E2E: after analysis, a work's reading roadmap ranks its
 * references into tiers, marking one "known" updates it, and the knowledge
 * graph renders both as an accessible table and as the 3D view. The
 * ranking *correctness* (Kant/Husserl above Camus, etc.) is covered by the
 * @ice/roadmap unit tests; this proves the end-to-end wiring through the
 * real stack (upload → analysis → graph_edges → roadmap/graph APIs → UI).
 * Needs the full local stack running (web + worker + Postgres).
 */

const EMAIL = `e2e-roadmap-${Date.now()}@example.com`;
const PASSWORD = "password123";

// Well-separated paragraphs so the heuristic classifier reads each cue,
// and widely-indexed references that resolve reliably on Crossref/OpenAlex.
const FIXTURE = `On the Question of Being

The inquiry builds directly on Kant's transcendental method, which first cleared the ground for the question.

The analysis of intentionality is deeply indebted to Husserl's phenomenology.

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

test.describe("Roadmap & knowledge graph (Phase 5)", () => {
  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("roadmap ranks references and reflects a 'known' rating; graph renders as table and 3D", async ({ page }) => {
    // Generous: pipeline v2+ runs its whole research/classification pass
    // before this document is even confirmable (D-19-6), and this fixture
    // explicitly cites Kant and Husserl, giving the research pass real work.
    test.setTimeout(240_000);
    const filePath = join(tmpdir(), `e2e-roadmap-${Date.now()}.txt`);
    writeFileSync(filePath, FIXTURE);

    await login(page);

    // Upload + confirm (enqueues analysis). uploadAndConfirmViaUI tolerates
    // pipeline v2's auto-ready bypass (high-confidence title detection
    // skips the manual confirm form entirely — see D-19-6), which this
    // fixture's clean title-first-line routinely triggers.
    const workId = await uploadAndConfirmViaUI(page, filePath, "On the Question of Being");

    // Wait for analysis to finish (reader badge polls to "Complete").
    await page.goto(`/works/${workId}/reader`);
    await expect(page.getByText("Complete", { exact: true })).toBeVisible({ timeout: 60000 });

    // --- Roadmap ---
    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();
    const firstItem = page.locator("[data-roadmap-item]").first();
    await expect(firstItem).toBeVisible({ timeout: 15000 });

    // Mark the first item as fully understood → it becomes "review only".
    const slider = firstItem.getByRole("slider");
    await slider.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight"); // → 100
    await slider.dispatchEvent("mouseup");
    await expect(page.getByText("review only").first()).toBeVisible({ timeout: 10000 });

    // --- Visualization: accessible table (default) ---
    // Phase 11.8 renamed this surface from "Knowledge graph" to
    // "Visualization" everywhere (found stale during the Phase 19
    // accessibility sweep, D-19-8 — this assertion had never actually run
    // because the test failed earlier for the unrelated D-19-6 timing
    // reason every time).
    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    // The root work appears as its own node row in the table (exact, to
    // avoid matching the "← cites from On the Question…" connection cells).
    await expect(page.getByRole("cell", { name: "On the Question of Being", exact: true })).toBeVisible({
      timeout: 15000,
    });
    // A referenced reading is present too.
    await expect(page.getByText(/Critique of Pure Reason|Logical Investigations/).first()).toBeVisible();

    // --- Toggle to 3D: a WebGL canvas mounts ---
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15000 });
  });
});
