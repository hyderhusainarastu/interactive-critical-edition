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
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
