import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "../helpers";

const email = `e2e-j05-reading-writing-${Date.now()}@example.com`;
const password = "password123";
let userId = "";
let workId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click(); await page.waitForURL("**/dashboard");
}

/** Charter §16 journey 5.  The Writer insertion handoff itself is asserted in
 * writer-insertion.spec.ts; this matrix test proves the real route chain. */
test.describe("Journey 5 — reading to graph/roadmap to Writer", () => {
  test.beforeAll(async () => { userId = await createVerifiedTestUser(email, password); ({ workId } = await seedWorkWithGraphData(userId, { title: "Journey 5 work" })); });
  test.afterAll(async () => deleteTestUser(email));
  test("Reader, Knowledge Map, Roadmap, Curriculum and Writer routes remain reversible", async ({ page }) => {
    await login(page);
    await page.goto(`/works/${workId}/reader`); await expect(page.getByRole("region", { name: /Interactive reader/i })).toBeVisible();
    await page.goto(`/works/${workId}/graph?view=list`); await expect(page.locator("#main-content")).toContainText(/Knowledge Map/i);
    await page.goto(`/works/${workId}/roadmap`); await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();
    await page.goto(`/works/${workId}/curriculum`); await expect(page.locator("#main-content")).toContainText(/Curriculum/i);
    await page.goto("/writer"); await expect(page.getByRole("heading", { name: "Writer" })).toBeVisible();
  });
});
