import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against an already-running local dev stack (web + worker +
 * Postgres) rather than spinning services up itself — the worker is a
 * separate long-running process Playwright's single `webServer` option
 * can't orchestrate alongside the web app and a live Postgres. See
 * docs/PROJECT-LOG.md "Commands" for how to start the full stack before running
 * these. Wiring this into CI (which would need the worker running
 * alongside the existing Postgres service container) is a documented
 * follow-up, not yet done.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Serial: every spec drives uploads through ONE shared local worker, and
  // since Phase 4 each upload also enqueues analysis (live bibliographic
  // API calls). Running spec files in parallel piled concurrent jobs on
  // that single worker and starved text extraction; one worker at a time
  // keeps the queue depth sane and the flows reliable.
  workers: 1,
  // One retry to absorb residual external-API latency variance without
  // masking a real regression (a genuine break fails both attempts).
  retries: 1,
  reporter: "list",
  // Raised from Playwright's 30s default: end-to-end flows that wait on
  // text extraction and then live-API analysis legitimately need more
  // headroom than the default, even serialized.
  timeout: 120_000,
  use: {
    // Override when the normal dev port is already occupied (for example,
    // when testing a production build side by side with `next dev`).
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
      // Stage 7 journey matrix (docs/design/stage7-journey-matrix.md) owns
      // its own viewport parameterization below — every journeys/*.spec.ts
      // file already runs under "journeys-desktop" plus a guided-mobile and
      // (for the four cross-workflow journeys) 1024/768 project, so letting
      // this default project ALSO pick them up at Playwright's own default
      // 1280x720 viewport would just be a fifth, uncontrolled-viewport run
      // of the same file with no charter rationale behind that specific
      // size — excluded here, not because the journeys are out of scope.
      testIgnore: [/knowledge-map-touch\.spec\.ts$/, /journeys\//],
    },
    // Touch-capable mobile project (Stage 3 Knowledge Map rebuild, spec
    // §7.3 "Touch tap/orbit/pinch/pan (mobile project)") — `devices["Pixel
    // 7"]` ships as part of the already-installed `@playwright/test`
    // package itself (not a new npm dependency: this project's own
    // operating constraints forbid adding one). Scoped via `testMatch` to
    // ONLY the dedicated touch spec, since every other spec in this suite
    // assumes the default desktop chromium viewport/pointer model and was
    // never written to run twice.
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testMatch: /knowledge-map-touch\.spec\.ts$/,
    },
    // --- Stage 7 journey matrix (charter §16 "Signed-in journey tests" +
    // its risk-based-matrix bullets: "Run every journey end to end in
    // desktop Chromium at 1440px and in one appropriate guided-mobile
    // viewport, alternating 375px and 320px so both are covered" plus "Run
    // the Reader, Research, Writer, and Knowledge Map cross-workflow
    // journeys additionally at 1024px and 768px"). Every journey file is
    // matched by "journeys-desktop"; the guided-mobile pair is split by
    // `testMatch` so each journey lands on exactly one of 375/320 (odd
    // journeys 375, even journeys 320 — an arbitrary but fixed and
    // documented alternation, see the matrix doc); the two cross-workflow
    // projects are scoped to only the Reader/Research/Knowledge-Map/Writer
    // journey files (j02/j04/j05/j07). See docs/design/stage7-journey-matrix.md
    // for the full rationale and which viewport(s) were actually executed
    // this session vs. configured-for-a-future-run.
    {
      name: "journeys-desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
      testMatch: /journeys\/.*\.spec\.ts$/,
    },
    {
      name: "journeys-guided-mobile-375",
      use: { browserName: "chromium", viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true },
      testMatch: /journeys\/j0[1357]-.*\.spec\.ts$/,
    },
    {
      name: "journeys-guided-mobile-320",
      use: { browserName: "chromium", viewport: { width: 320, height: 690 }, hasTouch: true, isMobile: true },
      testMatch: /journeys\/(j0[2468]|j10)-.*\.spec\.ts$/,
    },
    {
      name: "journeys-crossworkflow-1024",
      use: { browserName: "chromium", viewport: { width: 1024, height: 900 } },
      testMatch: /journeys\/(j02|j04|j05|j07)-.*\.spec\.ts$/,
    },
    {
      name: "journeys-crossworkflow-768",
      use: { browserName: "chromium", viewport: { width: 768, height: 1024 } },
      testMatch: /journeys\/(j02|j04|j05|j07)-.*\.spec\.ts$/,
    },
  ],
});
