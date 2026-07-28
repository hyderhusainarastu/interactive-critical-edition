import { expect, request as pwRequest, test } from "@playwright/test";
import { listRecentPassageContexts } from "@/lib/passages";
import { createVerifiedTestUser, deleteTestUser, seedDebateCluster, seedPublishedEdition } from "./helpers";

/**
 * Owner-scoping coverage for the two Knowledge Map context-chooser endpoints
 * added alongside the graph-display rebuild (spec §2.1/§2.3):
 * `GET /api/passages/recent` (`apps/web/src/lib/passages.ts`) and
 * `GET /api/research/debates` (`apps/web/src/lib/research/debates.ts`'s
 * `listRecentDebateClusters`/`getDebateClusterById`). Both are cross-work/
 * cross-project *listing* endpoints scoped directly to the caller's own
 * `userId` rather than a single resource id in the URL, so the right test
 * shape isn't the work-scoped 404 matrix `security.spec.ts` already covers —
 * it's "user B's list never contains user A's rows" plus "user B's by-id
 * lookup for user A's id resolves to `null`/404, never the data", the same
 * posture each function's own doc comment documents.
 */
const OWNER = `e2e-passages-debates-owner-${Date.now()}@example.com`;
const OTHER = `e2e-passages-debates-other-${Date.now()}@example.com`;
const PASSWORD = "password123";

let ownerId = "";
let ownerPassageId = "";
let ownerClusterId = "";

async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/(dashboard|welcome)/);
}

test.describe("Knowledge Map context-chooser endpoints — owner scoping", () => {
  test.beforeAll(async () => {
    ownerId = await createVerifiedTestUser(OWNER, PASSWORD);
    await createVerifiedTestUser(OTHER, PASSWORD);

    // seedPublishedEdition seeds one real anchored passage_annotation (see
    // its own doc comment); read it back the same way the route itself
    // does rather than re-deriving the schema shape here.
    const edition = await seedPublishedEdition(ownerId);
    const [recent] = await listRecentPassageContexts(ownerId, 1);
    ownerPassageId = recent!.id;

    const cluster = await seedDebateCluster(ownerId, edition.workId);
    ownerClusterId = cluster.clusterId;
  });

  test.afterAll(async () => {
    await deleteTestUser(OWNER);
    await deleteTestUser(OTHER);
  });

  test("GET /api/passages/recent and /api/research/debates reject unauthenticated callers (401)", async ({ baseURL }) => {
    const anon = await pwRequest.newContext({ baseURL });
    for (const url of ["/api/passages/recent", "/api/research/debates"]) {
      const res = await anon.get(url);
      expect(res.status(), `anon GET ${url}`).toBe(401);
    }
    await anon.dispose();
  });

  test("a caller with no data of their own sees an empty list, never the other user's rows", async ({ page }) => {
    await loginAs(page, OTHER);

    const passagesRes = await page.request.get("/api/passages/recent");
    expect(passagesRes.ok()).toBeTruthy();
    const { passages } = (await passagesRes.json()) as { passages: { id: string }[] };
    expect(passages.find((p) => p.id === ownerPassageId)).toBeUndefined();

    const debatesRes = await page.request.get("/api/research/debates");
    expect(debatesRes.ok()).toBeTruthy();
    const { debates } = (await debatesRes.json()) as { debates: { id: string }[] };
    expect(debates.find((d) => d.id === ownerClusterId)).toBeUndefined();
  });

  test("by-id lookup for another user's passage/debate resolves to 404, never the data", async ({ page }) => {
    await loginAs(page, OTHER);

    const passageRes = await page.request.get(`/api/passages/recent?id=${ownerPassageId}`);
    expect(passageRes.status()).toBe(404);

    const debateRes = await page.request.get(`/api/research/debates?id=${ownerClusterId}`);
    expect(debateRes.status()).toBe(404);
  });

  test("the owner's own requests resolve their real rows", async ({ page }) => {
    await loginAs(page, OWNER);

    const passagesRes = await page.request.get("/api/passages/recent");
    const { passages } = (await passagesRes.json()) as { passages: { id: string }[] };
    expect(passages.some((p) => p.id === ownerPassageId)).toBe(true);

    const passageByIdRes = await page.request.get(`/api/passages/recent?id=${ownerPassageId}`);
    expect(passageByIdRes.ok()).toBeTruthy();

    const debatesRes = await page.request.get("/api/research/debates");
    const { debates } = (await debatesRes.json()) as { debates: { id: string }[] };
    expect(debates.some((d) => d.id === ownerClusterId)).toBe(true);

    const debateByIdRes = await page.request.get(`/api/research/debates?id=${ownerClusterId}`);
    expect(debateByIdRes.ok()).toBeTruthy();
  });
});
