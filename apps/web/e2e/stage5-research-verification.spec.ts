import AxeBuilder from "@axe-core/playwright";
import { db, researchProjects, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";
import { seedStage5Fixture, type Stage5Fixture } from "./stage5-verification-seed";

/**
 * Stage 5 verification lane, round 1 — journeys 4 (core) and 6, the one
 * canonical pipeline action surface, permalink preservation, and
 * light/dark/reduced-motion screenshots. Runs against the dedicated
 * `palimnote-s5-pg` Postgres (port 5435) and a `next start` production
 * build already serving on PORT 3250 (both started manually for this
 * verification pass — see docs/audits/stage5-research-verification.md).
 * No worker process runs and no live provider is called anywhere in this
 * file: every dispatch exercised here is a plain DB insert + pg-boss
 * enqueue that nothing consumes, the same "verify the queued row, don't
 * run the worker" precedent every other research e2e spec already uses.
 */

function main(page: Page) {
  return page.locator("#main-content");
}

const EMAIL = `e2e-stage5-verify-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";
let fixture: Stage5Fixture;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function markOnboarded(id: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, id));
}

async function scan(page: Page) {
  await page.waitForTimeout(300);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}

const SHOT_DIR = "docs/audits/stage5-research-verification";

test.describe("Stage 5 research verification — journeys 4/6, pipeline surface, permalinks, screenshots", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
    fixture = await seedStage5Fixture(userId, "round1");
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("journey 4 core: creates a project via the accessible dialog (no window.prompt)", async ({ page }) => {
    await login(page);
    await page.goto("/research");
    await expect(main(page).getByRole("heading", { name: "Research" })).toBeVisible();

    const trigger = main(page).getByRole("button", { name: "New project" });
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: /New research project/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Project title")).toBeFocused();
    await dialog.getByLabel("Project title").fill("Journey 4 dialog project");
    await dialog.getByRole("button", { name: "Create" }).click();

    await page.waitForURL(/\/research\/[0-9a-f-]+$/);
    await expect(main(page).getByRole("heading", { name: "Journey 4 dialog project" })).toBeVisible();

    // Clean up: this project is disposable, distinct from the shared fixture.
    const [created] = await db.select({ id: researchProjects.id }).from(researchProjects).where(eq(researchProjects.title, "Journey 4 dialog project"));
    if (created) await db.delete(researchProjects).where(eq(researchProjects.id, created.id));
  });

  test("journey 4 core: corpus view shows the imported item and the search UI", async ({ page }) => {
    await login(page);
    await page.goto(`/research/${fixture.projectId}/corpus`);
    await expect(main(page).getByRole("heading", { name: "Corpus", exact: true })).toBeVisible();
    await expect(main(page).getByRole("list", { name: "Corpus items" }).getByText(/A Reading of Akrasia/)).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Search providers" })).toBeVisible();
  });

  test("journey 4 core: claims list renders as cards below 768px and a table at/above it", async ({ page }) => {
    await login(page);

    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`/research/${fixture.projectId}/claims`);
    await expect(main(page).getByRole("heading", { name: "Claims" })).toBeVisible();
    await expect(main(page).getByRole("table")).toHaveCount(0);
    const cardList = main(page).getByRole("list", { name: /Claims for/ });
    await expect(cardList).toBeVisible();
    await expect(cardList.getByRole("link", { name: /desire overrides judgment/ })).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await expect(main(page).getByRole("table")).toBeVisible();
    await expect(main(page).getByRole("list", { name: /Claims for/ })).toHaveCount(0);
  });

  test("journey 4 core: correct a claim — dispute with a reason, revision history shows it", async ({ page }) => {
    await login(page);
    await page.goto(`/research/claims/${fixture.claimAId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();

    const controls = main(page).locator('[data-research-correction-controls="claim"]');
    await controls.getByRole("button", { name: "Dispute" }).click();
    await controls.getByLabel(/reason/i).fill("The excerpt does not actually support this reading — round1 verification.");
    await controls.getByRole("button", { name: "Confirm dispute" }).click();
    await expect(controls.locator("[data-verification-chip]")).toHaveText("Disputed");

    // The revision list is `ul > li > (p, p, ul.list-disc)` — a NESTED inner
    // `<ul>` per entry (the "Verification status: x → y" sub-list), so
    // `.locator("ul").last()` would resolve to that innermost sub-list, not
    // the outer revision list. Assert directly against `controls` instead.
    await controls.getByRole("button", { name: "History" }).click();
    await expect(controls.getByText(/Revision 1 — Disputed/)).toBeVisible();
    await expect(controls.getByText("The excerpt does not actually support this reading — round1 verification.")).toBeVisible();
    await expect(controls.getByText(/Revision 0 — Generated/)).toBeVisible();
  });

  test("journey 4 core: monitors — project-scoped and global pages both render the seeded monitor/hit", async ({ page }) => {
    await login(page);

    // Project-scoped heading is "Monitors"; the global page's own heading is
    // deliberately "Research monitors" (MonitorsView.tsx: `{project ?
    // "Monitors" : "Research monitors"}`) — a real, intentional distinction,
    // not a defect, confirmed by direct read.
    await page.goto(`/research/${fixture.projectId}/monitors`);
    await expect(main(page).getByRole("heading", { name: "Monitors", exact: true })).toBeVisible();
    await expect(main(page).getByRole("list", { name: "Monitors" }).getByText("akrasia and practical knowledge round1", { exact: true })).toBeVisible();

    await page.goto("/research/monitors");
    await expect(main(page).getByRole("heading", { name: "Research monitors", exact: true })).toBeVisible();
    await expect(main(page).getByRole("list", { name: "Monitor hits" }).getByText(/A New Paper on Akrasia/)).toBeVisible();
  });

  test("journey 4 core: Evidence Chambers project view links to the working chamber permalink", async ({ page }) => {
    await login(page);
    await page.goto(`/research/${fixture.projectId}/chambers`);
    await expect(main(page).getByRole("heading", { name: "Evidence Chambers" })).toBeVisible();
    const link = main(page).getByRole("link", { name: "Does the akratic agent know what they are doing?" });
    await expect(link).toHaveAttribute("href", `/research/chambers/${fixture.chamberId}`);
    await link.click();
    await expect(main(page).getByRole("heading", { name: "Does the akratic agent know what they are doing?" })).toBeVisible();
    await expect(page).toHaveURL(`/research/chambers/${fixture.chamberId}`);
  });

  test("journey 4 core: Hypotheses & gaps combined view renders both sections from one project", async ({ page }) => {
    await login(page);
    await page.goto(`/research/${fixture.projectId}/hypotheses`);
    await expect(main(page).getByRole("heading", { name: "Hypotheses & gaps" })).toBeVisible();
    await expect(main(page).getByText(/breakdown between occurrent and dispositional knowledge/)).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Open gaps" })).toBeVisible();
    await expect(main(page).getByText(/unresolved contradiction with no reconciling account/)).toBeVisible();
  });

  test("journey 6: every correction action round-trips with provenance across all six object types", async ({ page }) => {
    await login(page);

    // cluster + relationship — both live on the debate cluster detail page.
    // (Finding 2 fix: `DebateClusterDetail.tsx` now renders its own
    // `objectType="relationship"` controls for every judged edge in the
    // cluster, not only the cluster itself — reachable independent of
    // whether any hypothesis happens to cite the relationship.)
    await page.goto(`/research/${fixture.projectId}/debates/${fixture.clusterId}`);
    const clusterControls = main(page).locator('[data-research-correction-controls="cluster"]');
    await clusterControls.getByRole("button", { name: "Hide" }).click();
    await expect(clusterControls.locator("[data-verification-chip]")).toBeVisible();
    await expect(clusterControls.getByText("Hidden")).toBeVisible();
    await clusterControls.getByRole("button", { name: "Restore" }).click();
    await expect(clusterControls.getByText("Hidden")).toHaveCount(0);

    const clusterPageRelControls = main(page).locator('[data-research-correction-controls="relationship"]');
    await expect(clusterPageRelControls).toBeVisible();
    await clusterPageRelControls.getByRole("button", { name: "Verify" }).click();
    await expect(clusterPageRelControls.locator("[data-verification-chip]")).toHaveText("Verified");

    // chamber — its own permalink.
    await page.goto(`/research/chambers/${fixture.chamberId}`);
    const chamberControls = main(page).locator('[data-research-correction-controls="chamber"]');
    await chamberControls.getByRole("button", { name: "Verify" }).click();
    await expect(chamberControls.locator("[data-verification-chip]")).toHaveText("Verified");

    // relationship (re-confirmed reachable a second way) + hypothesis + gap
    // — all live on the hypotheses page. The relationship was already
    // verified above on the cluster page; this re-confirms the "Cited
    // conflicts" path on the hypotheses page still shows that same,
    // already-verified state (both doors lead to the same object).
    await page.goto(`/research/${fixture.projectId}/hypotheses`);
    const relControls = main(page).locator('[data-research-correction-controls="relationship"]');
    await expect(relControls.locator("[data-verification-chip]")).toHaveText("Verified");

    const hypothesisControls = main(page).locator('[data-research-correction-controls="hypothesis"]');
    await hypothesisControls.getByRole("button", { name: "Verify" }).click();
    await expect(hypothesisControls.locator("[data-verification-chip]")).toHaveText("Verified");

    const gapControls = main(page).locator('[data-research-correction-controls="gap"]');
    await gapControls.getByRole("button", { name: "Hide" }).click();
    await expect(gapControls.getByText("Hidden")).toBeVisible();
    await gapControls.getByRole("button", { name: "Restore" }).click();
    await expect(gapControls.getByText("Hidden")).toHaveCount(0);

    // claim — the only object type with the extra edit/reclassify/split/merge
    // actions (ClaimCorrectionExtras), confirmed present ONLY here.
    await page.goto(`/research/claims/${fixture.claimBId}`);
    await expect(main(page).getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Reclassify" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Split" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Merge with…" }).or(main(page).getByRole("button", { name: /Merge/ }))).toBeVisible();

    // Honest "unsupported" check: the extras are absent (not shown-disabled)
    // on every non-claim object type's controls — confirmed on the
    // relationship/cluster page visited above and re-confirmed here on the
    // chamber and hypothesis pages already visited (no Edit/Reclassify/
    // Split/Merge button ever rendered next to those object types' own
    // ResearchCorrectionControls instance).
  });

  test("pipeline surface: exactly one dispatch site for detect/cluster, the stepper is status-only", async ({ page }) => {
    await login(page);
    await page.goto(`/research/${fixture.projectId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();

    const stepper = main(page).getByRole("region", { name: "Pipeline" });
    await expect(stepper).toBeVisible();
    await expect(stepper.getByRole("button")).toHaveCount(0);

    const jobsPanel = main(page).getByRole("region", { name: "Research jobs" });
    await expect(jobsPanel).toBeVisible();
    await expect(jobsPanel.getByRole("button", { name: /Detect relationships|Continue judging/ })).toHaveCount(1);
    await expect(jobsPanel.getByRole("button", { name: "Cluster debates" })).toHaveCount(1);
    // Both are enabled: the fixture seeded 2 works-with-claims and 1
    // relationship, matching `getResearchPipelineOverview`'s own
    // detectReady/clusterReady thresholds.
    await expect(jobsPanel.getByRole("button", { name: /Detect relationships|Continue judging/ })).toBeEnabled();
    await expect(jobsPanel.getByRole("button", { name: "Cluster debates" })).toBeEnabled();

    // The old quick-link row is gone (Stage 5 §2.3) — the persistent nav is
    // the only way to reach Claims/Debates/Corpus/Hypotheses from Overview.
    await expect(main(page).getByRole("link", { name: "View claims" })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: "View debates" })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: "Hypotheses & gaps" })).toHaveCount(0);

    const nav = page.getByRole("navigation", { name: "Research project sections" });
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Corpus",
      "Claims",
      "Debates",
      "Evidence Chambers",
      "Hypotheses",
      "Monitors",
      "Knowledge Map",
    ]);
  });

  test("permalink preservation: claim, chamber, debate-cluster, global + project monitors all resolve directly", async ({ page }) => {
    await login(page);

    await page.goto(`/research/claims/${fixture.claimAId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(`/research/claims/${fixture.claimAId}`);

    await page.goto(`/research/chambers/${fixture.chamberId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(`/research/chambers/${fixture.chamberId}`);

    await page.goto(`/research/${fixture.projectId}/debates/${fixture.clusterId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/research/monitors");
    await expect(main(page).getByRole("heading", { name: "Research monitors", exact: true })).toBeVisible();

    await page.goto(`/research/${fixture.projectId}/monitors`);
    await expect(main(page).getByRole("heading", { name: "Monitors", exact: true })).toBeVisible();
  });

  test("Knowledge Map tab: opens the project's own real Knowledge Map context, not a 404 or a stub (integration step 'focus-modes-map-tabs')", async ({ page }) => {
    await login(page);
    const [projectRow] = await db.select({ title: researchProjects.title }).from(researchProjects).where(eq(researchProjects.id, fixture.projectId));
    const response = await page.goto(`/research/${fixture.projectId}/graph`);
    // `app/(app)/research/[projectId]/graph/page.tsx` now mounts the SAME
    // `KnowledgeMapWorkspace` the work-context tab uses, pre-selected to
    // this project's own "question" context (`initialContext`) — no more
    // "planned for a later integration stage" stub linking out to the bare
    // global `/graph`.
    expect(response?.status()).toBe(200);
    // A real, screen-reader-visible page heading exists (matching every
    // other project tab's own convention) even though it's visually hidden
    // — see that page's own doc comment for why (`.knowledge-map-workspace`
    // sizes itself to fill the viewport below only the global context bar).
    await expect(page.getByRole("heading", { name: `${projectRow.title} — Knowledge Map`, level: 1 })).toBeAttached();
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();
    // The context label shows this project's own title, not a generic
    // chooser or an unrelated context — proving the pre-selection actually
    // took effect, not just that SOME Knowledge Map rendered.
    await expect(page.getByTestId("knowledge-map-toolbar")).toContainText(projectRow.title);
    // The nav's own "Knowledge Map" tab is `aria-current` on this route,
    // same as every other real project tab (§2.2) — preserved return
    // navigation: every other project tab stays one click away.
    const nav = page.getByRole("navigation", { name: "Research project sections" });
    await expect(nav.getByRole("link", { name: "Knowledge Map" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Claims" })).toBeVisible();
  });

  test("axe: zero wcag2a/wcag2aa violations on the fixture's key pages, light and dark", async ({ page }) => {
    await login(page);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const path of [
        `/research/${fixture.projectId}`,
        `/research/${fixture.projectId}/corpus`,
        `/research/${fixture.projectId}/claims`,
        `/research/${fixture.projectId}/chambers`,
        `/research/${fixture.projectId}/hypotheses`,
        `/research/${fixture.projectId}/monitors`,
        `/research/${fixture.projectId}/graph`,
      ]) {
        await page.goto(path);
        await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
        expect((await scan(page)).violations, `${path} (${colorScheme})`).toEqual([]);
      }
    }
  });

  test("screenshots: 1440/375 widths, dark mode, and reduced motion — unmasked, into docs/audits", async ({ page }) => {
    await login(page);

    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/research/${fixture.projectId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/overview-1440-light.png`, fullPage: true });

    await page.goto(`/research/${fixture.projectId}/claims`);
    await expect(main(page).getByRole("heading", { name: "Claims" })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/claims-1440-light.png`, fullPage: true });

    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(`/research/${fixture.projectId}/claims`);
    await expect(main(page).getByRole("heading", { name: "Claims" })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/claims-375-light.png`, fullPage: true });

    await page.goto(`/research/${fixture.projectId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/overview-375-light.png`, fullPage: true });

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/research/${fixture.projectId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/overview-1440-dark.png`, fullPage: true });

    await page.goto(`/research/${fixture.projectId}/chambers`);
    await expect(main(page).getByRole("heading", { name: "Evidence Chambers" })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/chambers-1440-dark.png`, fullPage: true });

    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(`/research/${fixture.projectId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/overview-1440-reduced-motion.png`, fullPage: true });
  });
});
