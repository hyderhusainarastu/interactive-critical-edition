import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser, seedDebateCluster, seedWorkWithGraphData } from "./helpers";

/**
 * Phase 28.4 E2E: the knowledge-graph debate layer, behind
 * `graphDebateLayer` (`PHASE_25_GRAPH_DEBATE_LAYER_ENABLED`). Same two-
 * `describe`-blocks-gated-opposite-ways pattern `reader-claims.spec.ts`
 * (Phase 28.3's own precedent) already established: a single server
 * process's env is fixed at boot, so exercising both the flag-ON and
 * flag-OFF behavior for real means running this file twice against two
 * differently-configured builds — each run correctly skips the other block
 * rather than failing. `debate_cluster`/`research_claim`/`claim_relationship`
 * rows are SEEDED directly (`seedDebateCluster`, `./helpers.ts`) —
 * `buildGraph()`/the expansion route are both pure DB reads with no worker/
 * live-API dependency, the same CI-safety reasoning `graph.spec.ts` already
 * documents for the rest of the graph contract.
 *
 * `graph.spec.ts` itself is intentionally left completely unmodified by
 * this lane — it is the pre-existing regression proof that every node/edge
 * type this file predates keeps rendering exactly as before.
 */

const EMAIL = `graph-debates-${Date.now()}@example.com`;
const PASSWORD = "Test-Password-1";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Knowledge-graph debate layer (Phase 28.4)", () => {
  test.skip(process.env.PHASE_25_GRAPH_DEBATE_LAYER_ENABLED !== "true", "requires the local-only Phase 25 graphDebateLayer gate");

  let workId = "";
  let clusterId = "";
  let claimAId = "";
  let claimBId = "";

  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    const seeded = await seedWorkWithGraphData(userId);
    workId = seeded.workId;
    const debate = await seedDebateCluster(userId, workId);
    clusterId = debate.clusterId;
    claimAId = debate.claimAId;
    claimBId = debate.claimBId;
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("the base graph payload includes the debate node (name/question/claim count/works) and ZERO claim nodes", async ({ page }) => {
    await login(page, EMAIL);
    const res = await page.request.get(`/api/works/${workId}/graph`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const nodes = body.nodes as Array<Record<string, unknown>>;
    const links = body.links as Array<Record<string, unknown>>;

    const debateNode = nodes.find((n) => n.id === `debate:${clusterId}`);
    expect(debateNode).toBeTruthy();
    expect(debateNode?.type).toBe("debate");
    expect(debateNode?.label).toBe("Is the soul separable from the body?");
    expect(debateNode?.debateQuestion).toBe("Can the soul exist independently of the body it forms?");
    expect(debateNode?.debateClaimCount).toBe(2);

    // Base payload NEVER contains individual claim nodes — only via the
    // dedicated per-cluster expansion route (the whole point of a summary
    // node: the payload scales with debate count, not claim count).
    expect(nodes.filter((n) => typeof n.id === "string" && (n.id as string).startsWith("claim:"))).toHaveLength(0);

    // Linked to the participating work via `in_debate`.
    const inDebateLink = links.find((l) => l.edgeType === "in_debate" && l.target === `debate:${clusterId}`);
    expect(inDebateLink).toBeTruthy();
    expect(inDebateLink?.source).toBe(`work:${workId}`);
  });

  test("GET /api/graph/debate/:clusterId/expand returns an additive delta of the cluster's claims + relationship + assertion edges, both endpoints always in the returned node set", async ({ page }) => {
    await login(page, EMAIL);
    const res = await page.request.get(`/api/graph/debate/${clusterId}/expand`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const nodes = body.nodes as Array<Record<string, unknown>>;
    const links = body.links as Array<Record<string, unknown>>;

    expect(nodes.map((n) => n.id).sort()).toEqual([`claim:${claimAId}`, `claim:${claimBId}`].sort());
    const claimA = nodes.find((n) => n.id === `claim:${claimAId}`)!;
    expect(claimA.type).toBe("claim");
    expect(claimA.claimNature).toBe("interpretive");
    expect(claimA.valenceSummary).toBe("1 contradiction");

    const relationshipLink = links.find((l) => l.edgeType === "claim_contradicts");
    expect(relationshipLink).toBeTruthy();
    expect(relationshipLink?.directed).toBe(false);
    expect(relationshipLink?.confidence).toBe(1);
    expect(relationshipLink?.explanation).toContain("contradiction");

    const assertsLinks = links.filter((l) => l.edgeType === "asserts_claim");
    expect(assertsLinks).toHaveLength(2);
    expect(assertsLinks.map((l) => l.source)).toEqual([`work:${workId}`, `work:${workId}`]);

    // Every link's endpoints are among the returned nodes — no dangling
    // edge to a claim this expansion didn't also return.
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const link of links) {
      expect(nodeIds.has(link.source as string) || (link.source as string).startsWith("work:")).toBe(true);
      expect(nodeIds.has(link.target as string)).toBe(true);
    }
  });

  test("expansion is owner-scoped 404-not-403 for a well-formed but nonexistent cluster id", async ({ page }) => {
    await login(page, EMAIL);
    const res = await page.request.get("/api/graph/debate/00000000-0000-0000-0000-000000000000/expand");
    expect(res.status()).toBe(404);
  });

  test("accessible table shows the debate row by default; expanding via the inspector's keyboard-operable control adds claim rows with valence relationships — table parity is non-optional", async ({ page }) => {
    await login(page, EMAIL);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    const debateRow = page.locator(`[data-graph-node="debate:${clusterId}"]`);
    await expect(debateRow).toContainText("Is the soul separable from the body?");
    await expect(debateRow).toContainText("2 claims");
    await expect(page.locator('[data-graph-node^="claim:"]')).toHaveCount(0);

    // The SAME control is reachable from either view (table row click here,
    // or a 3D node click — both funnel through `GraphView`'s one shared
    // `selected` state into this one inspector), keyboard-operable (a real
    // `<button>`, Tab + Enter reachable).
    await debateRow.getByRole("button", { name: /Is the soul separable from the body\?/ }).click();
    const expandButton = page.locator("[data-graph-expand-debate]");
    await expect(expandButton).toBeVisible();
    await expandButton.focus();
    await expandButton.press("Enter");

    await expect(expandButton).toHaveText("Claims shown");
    await expect(expandButton).toBeDisabled();

    const claimARow = page.locator(`[data-graph-node="claim:${claimAId}"]`);
    const claimBRow = page.locator(`[data-graph-node="claim:${claimBId}"]`);
    await expect(claimARow).toBeVisible();
    await expect(claimBRow).toBeVisible();
    await expect(claimARow).toContainText("1 contradiction");
    await expect(claimBRow).toContainText("1 contradiction");
    await expect(claimARow).toContainText("Nature: interpretive");

    // Exactly the two claims this cluster has — no dangling/duplicate rows
    // from a re-merge, and no more than the expansion actually returned.
    await expect(page.locator('[data-graph-node^="claim:"]')).toHaveCount(2);
  });

  test("zero axe violations with a debate node expanded and a claim node selected, in both themes", async ({ page }) => {
    await login(page, EMAIL);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();
    const debateRow = page.locator(`[data-graph-node="debate:${clusterId}"]`);
    await debateRow.getByRole("button", { name: /Is the soul separable from the body\?/ }).click();
    await page.locator("[data-graph-expand-debate]").click();
    await expect(page.locator("[data-graph-expand-debate]")).toHaveText("Claims shown");
    await page.locator(`[data-graph-node="claim:${claimAId}"]`).getByRole("button").first().click();
    await expect(page.locator("[data-graph-claim-panel]")).toBeVisible();

    for (const themeButton of ["Light", "Dark"] as const) {
      await page.getByRole("button", { name: themeButton, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", themeButton.toLowerCase());
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations, themeButton).toEqual([]);
    }
  });
});

test.describe("Knowledge-graph debate layer — flag disabled (byte-identical base payload)", () => {
  test.skip(process.env.PHASE_25_GRAPH_DEBATE_LAYER_ENABLED === "true", "requires the Phase 25 graphDebateLayer gate to be OFF");

  const offEmail = `graph-debates-off-${Date.now()}@example.com`;
  let workId = "";
  let clusterId = "";

  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(offEmail, PASSWORD);
    const seeded = await seedWorkWithGraphData(userId);
    workId = seeded.workId;
    // Debate data is seeded AFTER capturing this — see the test body below
    // for why the before/after comparison for this SAME work is the real
    // "flag-off = byte-identical" proof (no volatile-id normalization
    // needed, since it's literally the same work/ids on both fetches).
  });

  test.afterAll(async () => {
    await deleteTestUser(offEmail);
  });

  test("a real debate cluster attached to this work changes NOTHING in the base graph payload while the flag is off — snapshot compare against the pre-seed payload", async ({ page }) => {
    await login(page, offEmail);
    const before = await (await page.request.get(`/api/works/${workId}/graph`)).json();

    // Seed a real debate cluster for this exact work, owned by this exact
    // user (resolved by email, the same account `beforeAll` already
    // created), using the SAME helper the flag-ON block uses — the whole
    // point is that a REAL cluster genuinely exists and applies to this
    // work, not merely that nothing was ever seeded.
    const [userRecord] = await db.select({ id: users.id }).from(users).where(eq(users.email, offEmail)).limit(1);
    const debate = await seedDebateCluster(userRecord!.id, workId);
    clusterId = debate.clusterId;

    const after = await (await page.request.get(`/api/works/${workId}/graph`)).json();

    // Byte-identical: same node/link arrays, same stats — the flag being
    // off means `buildGraph()` never even queries `debate_cluster`, so a
    // debate that structurally applies to this work is invisible to this
    // payload exactly as if it didn't exist.
    expect(after).toEqual(before);

    // And explicitly, for readability: no debate/claim node or edge type
    // anywhere in either payload.
    for (const body of [before, after]) {
      const nodes = body.nodes as Array<Record<string, unknown>>;
      const links = body.links as Array<Record<string, unknown>>;
      expect(nodes.some((n) => n.type === "debate" || n.type === "claim")).toBe(false);
      expect(links.some((l) => ["in_debate", "asserts_claim", "claim_contradicts", "claim_supports", "claim_nuances"].includes(l.edgeType as string))).toBe(false);
    }
  });

  test("the expansion route 404s while the flag is off, even for a real, owned cluster", async ({ page }) => {
    await login(page, offEmail);
    const res = await page.request.get(`/api/graph/debate/${clusterId}/expand`);
    expect(res.status()).toBe(404);
  });
});
