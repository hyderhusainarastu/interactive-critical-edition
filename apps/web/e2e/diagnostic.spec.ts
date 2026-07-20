import { conceptMastery, db } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork, seedWorkWithConcepts } from "./helpers";

/**
 * Phase 9.4 E2E: the optional per-work diagnostic. Concepts and their
 * work→concept graph edges are SEEDED rather than produced by the real v3
 * pipeline (no worker, no live model call — same CI-safety reasoning as
 * edition.spec.ts). What's under test is the reader-facing contract: the
 * seeded concepts render, answering writes concept_mastery with the right
 * score/source, and the precedence rule (explicit beats diagnostic) holds
 * even from the UI, not just the pure `shouldOverwriteMastery` unit tests.
 */

const EMAIL = `e2e-diagnostic-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Per-work diagnostic (Phase 9.4)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("renders seeded concepts, is fully skippable, and writes concept_mastery on submit", async ({ page }) => {
    const { workId, conceptIds } = await seedWorkWithConcepts(userId);

    await login(page);
    await page.goto(`/works/${workId}/diagnostic`);
    await expect(page.getByRole("heading", { name: "Concept check" })).toBeVisible();
    await expect(page.getByText("Akrasia", { exact: true })).toBeVisible();
    await expect(page.getByText("Sophrosyne", { exact: true })).toBeVisible();

    // Skippable: the escape hatch is always present, and it's a plain link,
    // never a submit that silently records an answer.
    await expect(page.getByRole("link", { name: "Skip for now" })).toBeVisible();

    // Answer only ONE of the two concepts — partial answers must be allowed.
    await page.getByRole("radio", { name: "Could explain it to someone else" }).first().check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved — 1 concept assessed.")).toBeVisible();

    const rows = await db.select().from(conceptMastery).where(eq(conceptMastery.conceptId, conceptIds[0]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "diagnostic", score: 85 });

    const untouched = await db.select().from(conceptMastery).where(eq(conceptMastery.conceptId, conceptIds[1]));
    expect(untouched).toHaveLength(0);
  });

  test("an explicit rating is never silently overwritten by a diagnostic answer", async ({ page }) => {
    const { workId, conceptIds } = await seedWorkWithConcepts(userId, {
      existingMastery: { conceptIndex: 0, score: 40, source: "explicit" },
    });

    await login(page);
    await page.goto(`/works/${workId}/diagnostic`);
    await expect(page.getByText("Akrasia", { exact: true })).toBeVisible();

    // The existing explicit score (40) maps to "Heard of it" in the UI's
    // score buckets, so that option should already be pre-selected.
    await expect(page.getByRole("radio", { name: "Heard of it" }).first()).toBeChecked();

    // Submit a DIFFERENT, higher self-assessment for the same concept.
    await page.getByRole("radio", { name: "Could explain it to someone else" }).first().check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved/)).toBeVisible();

    // The precedence rule holds: explicit still wins, unchanged.
    const [row] = await db.select().from(conceptMastery).where(eq(conceptMastery.conceptId, conceptIds[0]));
    expect(row).toMatchObject({ source: "explicit", score: 40 });
  });

  test("an empty concept catalog shows an honest empty state, not a broken quiz", async ({ page }) => {
    // A work with no work→concept edges at all (e.g. a v2-pipeline document).
    const { workId } = await seedOwnedWork(userId);

    await login(page);
    await page.goto(`/works/${workId}/diagnostic`);
    await expect(page.getByText(/No concepts have been extracted/i)).toBeVisible();
  });
});
