import { defineConfig } from "vitest/config";

/**
 * Worker tests are DB integration tests: `@ice/db` throws at import when
 * DATABASE_URL is unset, so we only COLLECT test files when a database is
 * configured. Without one (e.g. a CI job that hasn't provisioned the worker
 * DB), no files are collected and the run passes — the tests are exercised
 * locally (and in any CI job that sets DATABASE_URL) instead.
 */
export default defineConfig({
  test: {
    // `v3.test.ts`, `citationSources.test.ts` (D-20-91), and
    // `foreignText.test.ts` are intentionally pure — none imports `@ice/db`
    // — so they run without a database;
    // lifecycle tests also run wherever a local/integration database has
    // been configured.
    include: process.env.DATABASE_URL
      ? ["src/**/*.test.ts"]
      : ["src/v3.test.ts", "src/citationSources.test.ts", "src/foreignText.test.ts"],
    passWithNoTests: true,
    // The 21 `*.integration.test.ts` files (of 27 total) share a deduped
    // Postgres catalog fixture (bibliographic_record/learning_resource rows
    // keyed by url, e.g. the vice-and-reason/annas fixture) and each file's
    // afterEach deletes rows by id. Running files in parallel (Vitest's
    // default) races those deletes against another file's still-in-flight
    // assertions, intermittently throwing FK violation 23503. Since the vast
    // majority of files here are integration tests anyway, scoping
    // serialization to just them via a projects/workspace split isn't worth
    // the added config complexity — serialize file execution for the whole
    // suite instead, matching the E2E suite's existing `workers: 1`
    // precedent (see docs/PROJECT-LOG.md).
    fileParallelism: false,
  },
});
