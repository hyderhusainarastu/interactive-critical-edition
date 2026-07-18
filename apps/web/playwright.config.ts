import { defineConfig } from "@playwright/test";

/**
 * Runs against an already-running local dev stack (web + worker +
 * Postgres) rather than spinning services up itself — the worker is a
 * separate long-running process Playwright's single `webServer` option
 * can't orchestrate alongside the web app and a live Postgres. See
 * CLAUDE.md "Commands" for how to start the full stack before running
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
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
