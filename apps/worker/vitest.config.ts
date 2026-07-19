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
    include: process.env.DATABASE_URL ? ["src/**/*.test.ts"] : [],
    passWithNoTests: true,
  },
});
