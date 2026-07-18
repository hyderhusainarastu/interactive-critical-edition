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
  // One retry: since Phase 4 the analysis pipeline makes live bibliographic
  // API calls, and the whole suite shares a single local worker — under
  // that load a flow can occasionally miss a wait. Each spec is solid in
  // isolation; a retry absorbs external-latency variance without masking a
  // real regression (a genuine break fails both attempts).
  retries: 1,
  reporter: "list",
  // Raised from Playwright's 30s default: since Phase 4, confirming a work
  // enqueues an analysis job (with live bibliographic lookups) on the same
  // single local worker, so end-to-end flows that wait on text extraction
  // and then analysis legitimately need more headroom than the default.
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
