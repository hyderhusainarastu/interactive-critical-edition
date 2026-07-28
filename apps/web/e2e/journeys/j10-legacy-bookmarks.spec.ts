import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "../helpers";

const email = `e2e-j10-bookmarks-${Date.now()}@example.com`; const password = "password123"; let userId = ""; let workId = "";
async function login(page: import("@playwright/test").Page) { await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Log in" }).click(); await page.waitForURL("**/dashboard"); }

/** Representative legacy graph bookmark.  The exhaustive codec/legacy table
 * remains covered by @ice/graph-display unit tests and knowledge-map.spec.ts. */
test.describe("Journey 10 — legacy bookmarks", () => {
  test.beforeAll(async () => { userId = await createVerifiedTestUser(email, password); ({ workId } = await seedWorkWithGraphData(userId, { title: "Journey 10 graph" })); }); test.afterAll(() => deleteTestUser(email));
  test("a legacy roadmap bookmark is translated to its canonical Roadmap route", async ({ page }) => {
    await login(page); await page.goto(`/graph?layout=roadmap&roadmapRoot=work:${workId}`);
    await expect(page).toHaveURL(new RegExp(`/works/${workId}/roadmap`));
    await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();
  });
});
