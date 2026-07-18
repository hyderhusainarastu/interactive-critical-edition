import { expect, request as pwRequest, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork } from "./helpers";

/**
 * Phase 7 security review: the authorization-bypass matrix (plan §21/§25
 * R5). User B, fully authenticated, tries to reach every resource-scoped
 * route for a work owned by user A — and must get 404 (not 403, not the
 * data) on all of them, so a resource's existence is never even revealed.
 * Unauthenticated access must be 401. This locks in the IDOR posture that
 * every prior phase built to.
 */
const OWNER = `e2e-sec-owner-${Date.now()}@example.com`;
const ATTACKER = `e2e-sec-attacker-${Date.now()}@example.com`;
const PASSWORD = "password123";

let owned: Awaited<ReturnType<typeof seedOwnedWork>>;

test.describe("Authorization / IDOR matrix (Phase 7)", () => {
  test.beforeAll(async () => {
    const ownerId = await createVerifiedTestUser(OWNER, PASSWORD);
    await createVerifiedTestUser(ATTACKER, PASSWORD);
    owned = await seedOwnedWork(ownerId);
  });
  test.afterAll(async () => {
    await deleteTestUser(OWNER);
    await deleteTestUser(ATTACKER);
  });

  test("another user cannot read or mutate an owner's resources (all 404)", async ({ page }) => {
    // Authenticate as the attacker via the real credentials flow.
    await page.goto("/login");
    await page.getByLabel("Email").fill(ATTACKER);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/(dashboard|welcome)/);

    const w = owned.workId;
    // Every one of these targets the OWNER's work while logged in as the
    // attacker. Expect 404 across the board.
    const reads = [
      `/api/works/${w}/status`,
      `/api/works/${w}/reader`,
      `/api/works/${w}/reader/annotations`,
      `/api/works/${w}/roadmap`,
      `/api/works/${w}/graph`,
    ];
    for (const url of reads) {
      const res = await page.request.get(url);
      expect(res.status(), `GET ${url}`).toBe(404);
    }

    const writes: { method: "post" | "patch" | "delete"; url: string; body?: object }[] = [
      { method: "post", url: `/api/works/${w}/confirm`, body: { title: "hijacked" } },
      { method: "post", url: `/api/works/${w}/analyze` },
      { method: "post", url: `/api/works/${w}/reader/highlights`, body: { anchor: { kind: "text", paragraphIndex: 0, quote: "x", prefix: "", suffix: "" }, color: "gold" } },
      { method: "post", url: `/api/works/${w}/reader/notes`, body: { body: "x" } },
      { method: "post", url: `/api/works/${w}/reader/bookmarks`, body: { position: { kind: "text", paragraphIndex: 0 } } },
      { method: "post", url: `/api/works/${w}/reader/position`, body: { kind: "text", paragraphIndex: 5 } },
      { method: "post", url: `/api/works/${w}/roadmap/item`, body: { bibId: "00000000-0000-0000-0000-000000000000", hidden: true } },
      { method: "patch", url: `/api/works/${w}/reader/annotations/${owned.annotationId}`, body: { verificationStatus: "rejected" } },
      { method: "delete", url: `/api/works/${w}/reader/highlights/${owned.highlightId}` },
      { method: "delete", url: `/api/works/${w}/reader/notes/${owned.noteId}` },
      { method: "delete", url: `/api/works/${w}/reader/bookmarks/${owned.bookmarkId}` },
    ];
    for (const op of writes) {
      const res = await page.request[op.method](op.url, op.body ? { data: op.body } : undefined);
      expect(res.status(), `${op.method.toUpperCase()} ${op.url}`).toBe(404);
    }
  });

  test("unauthenticated requests are rejected (401), never leaking data", async ({ baseURL }) => {
    const anon = await pwRequest.newContext({ baseURL });
    const w = owned.workId;
    for (const url of [
      `/api/works`,
      `/api/graph`,
      `/api/works/${w}/reader`,
      `/api/works/${w}/roadmap`,
      `/api/works/${w}/graph`,
    ]) {
      const res = await anon.get(url);
      expect(res.status(), `anon GET ${url}`).toBe(401);
    }
    await anon.dispose();
  });
});
