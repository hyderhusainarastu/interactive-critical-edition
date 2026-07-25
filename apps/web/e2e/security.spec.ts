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
      `/api/works/${w}/curriculum`,
      // Phase 19 audit (§19.7 IDOR matrix completeness check): these three
      // shared `getOwnedDocument()` with everything above but had never
      // actually been hit by the matrix.
      `/api/works/${w}/edition`,
      `/api/works/${w}/diagnostic`,
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
      // Phase 19 audit (§19.7 IDOR matrix completeness check): the
      // diagnostic submission, the term-approval sub-route, and attaching
      // a note to a highlight all share the same `getOwnedDocument()` gate
      // as the routes above but had no direct matrix entry of their own.
      // (`/reprocess` is deliberately NOT added here: it checks
      // `isEditionPipeline()` before ownership, so an environment running
      // the legacy v1 pipeline returns 409 there for ANY authenticated
      // caller — a real config-dependent status difference, not a uniform
      // 404, so it doesn't fit this bulk assertion. No data is disclosed
      // either way; tracked as a note, not a defect.)
      { method: "post", url: `/api/works/${w}/diagnostic`, body: { answers: [] } },
      { method: "patch", url: `/api/works/${w}/reader/terms/${owned.termId}`, body: { action: "approve" } },
      { method: "post", url: `/api/works/${w}/reader/notes/${owned.noteId}/highlights`, body: { highlightId: owned.highlightId } },
      // Phase 9.7 trash routes — must 404 the same as every other
      // resource-scoped route, not silently trash/restore/purge another
      // user's work.
      { method: "delete", url: `/api/works/${w}` },
      { method: "post", url: `/api/works/${w}/restore` },
      { method: "post", url: `/api/works/${w}/purge` },
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
      `/api/works/trash`,
      `/api/graph`,
      `/api/works/${w}/reader`,
      `/api/works/${w}/roadmap`,
      `/api/works/${w}/graph`,
    ]) {
      const res = await anon.get(url);
      expect(res.status(), `anon GET ${url}`).toBe(401);
    }
    // /api/library/[resourceId]/status (plan §34.4 9.5) — auth is checked
    // before the resource itself is looked up, so a placeholder id proves
    // the 401 without needing a real learning_resource seeded here.
    const libraryRes = await anon.post(`/api/library/00000000-0000-0000-0000-000000000000/status`, {
      data: { readingStatus: "reading" },
    });
    expect(libraryRes.status(), "anon POST /api/library/:id/status").toBe(401);
    await anon.dispose();
  });

  // Workstream G (v.5): /account/* has no auth check of its own — it
  // inherits `requireSession()` from `(app)/layout.tsx`, same as every
  // other route under `(app)`. This proves that inheritance actually holds
  // for the new route tree, using a fresh (unauthenticated) browser
  // context so the redirect is followed exactly as a real signed-out
  // visitor would experience it.
  test("/account and its subpages redirect an unauthenticated visitor to login", async ({ page }) => {
    for (const path of ["/account", "/account/profile", "/account/usage", "/account/plan"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 10000 });
    }
  });

  // Workstream H (v.5): /admin-dash is a SEPARATE credential-gated area,
  // entirely independent of the normal user session and `requireSession()`
  // above — a caller with no `admin_dash` cookie at all (never mind no
  // Palimnote account) must get 404, never a login redirect that would
  // reveal the area exists, on every guarded page. Only the login page
  // itself is intentionally reachable unauthenticated (200) — that IS the
  // design, not a leak, since it carries no admin content.
  test("/admin-dash's guarded pages 404 for a caller with no admin-dash session, while its login page stays reachable", async ({ page }) => {
    for (const path of ["/admin-dash", "/admin-dash/users", "/admin-dash/users/00000000-0000-0000-0000-000000000000", "/admin-dash/feedback"]) {
      const res = await page.request.get(path);
      expect(res.status(), `GET ${path}`).toBe(404);
    }

    const loginPage = await page.request.get("/admin-dash/login");
    expect(loginPage.status()).toBe(200);
  });

  test("a bad admin-dash login attempt never leaks whether the username or password was wrong", async ({ page }) => {
    const res = await page.request.post("/api/admin-dash/login", {
      form: { username: "not-a-real-admin", password: "not-a-real-password" },
      maxRedirects: 0,
    });
    expect([302, 303]).toContain(res.status());
    const location = res.headers()["location"] ?? "";
    expect(location).toContain("/admin-dash/login");
    expect(location).toContain("error=1");

    // Still no session was granted — the guarded tree stays 404.
    const overview = await page.request.get("/admin-dash");
    expect(overview.status()).toBe(404);
  });
});
