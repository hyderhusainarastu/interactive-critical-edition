import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";
import { clearLastPosition, loginAs, markOnboarded, seedResumableWork } from "./stage4VerifyHelpers";

/**
 * Stage 4 read spec §1: the evidence-backed Home surface
 * (`(app)/dashboard/page.tsx`) — a real "Continue reading" card only when a
 * saved reading position exists, and an honest empty state (never a
 * placeholder card) when it doesn't. All data is SEEDED directly
 * (`seedResumableWork`/`clearLastPosition`), no worker/live-API dependency.
 */

const EMAIL = `e2e-stage4-home-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

test.describe("Home next-work surface (Stage 4 read spec §1)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("a real saved position renders a 'Continue reading' card linking straight to the reader", async ({ page }) => {
    const { workId, documentId } = await seedResumableWork(userId, { title: "Home Resume Fixture" });

    await loginAs(page, EMAIL, PASSWORD);
    await expect(page.getByText("Continue reading")).toBeVisible();
    const resumeCard = page.getByRole("link", { name: /Continue reading[\s\S]*Home Resume Fixture/ });
    await expect(resumeCard).toBeVisible();
    await expect(resumeCard).toHaveAttribute("href", `/works/${workId}/reader`);

    // The card's own presence is the honest empty-state discipline the spec
    // requires — no separate "0 items" tile ever renders alongside it.
    await expect(page.getByText(/Nothing to resume yet/)).toHaveCount(0);

    await clearLastPosition(documentId);
  });

  test("a brand-new account with no saved position sees an honest empty state, not a placeholder card", async ({ page }) => {
    const emptyEmail = `e2e-stage4-home-empty-${Date.now()}@example.com`;
    const emptyUserId = await createVerifiedTestUser(emptyEmail, PASSWORD);
    await markOnboarded(emptyUserId);

    await loginAs(page, emptyEmail, PASSWORD);
    await expect(page.getByText(/Nothing to resume yet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "upload a work", exact: true })).toHaveAttribute("href", "/upload");
    await expect(page.getByText("Continue reading")).toHaveCount(0);

    await deleteTestUser(emptyEmail);
  });
});
