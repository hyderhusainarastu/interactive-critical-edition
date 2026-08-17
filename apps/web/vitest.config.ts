import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Until now `apps/web` had no test runner at all. Its 70 `*.test.ts` files
 * used bare top-level `node:assert` calls, vitest was not a dependency, and
 * `package.json` had no `test` script — so `pnpm -r test` silently skipped
 * the largest app in the repo and the files were only ever typechecked.
 *
 * Six of the 70 reach `@ice/db`, which throws at import when DATABASE_URL is
 * unset -- three directly, three through the module they test. (Membership is
 * by real import graph, not by a grep for the string: `avatarUpload.test.ts`
 * and `foreignSpans.test.ts` mention `@ice/db` only in a comment saying they
 * do NOT use it, and were wrongly excluded on a first pass.)
 *
 * Same treatment as `apps/worker/vitest.config.ts`: collect
 * everything when a database is configured, and only the DB-free files when
 * one is not, so a machine or CI job without Postgres still runs the 64 pure
 * ones rather than erroring on collection.
 */
const DB_BACKED = [
  "src/lib/auth/accountDeletion.test.ts",
  "src/lib/auth/auth-service.consent.test.ts",
  "src/lib/rag/competencyData.test.ts",
  "src/lib/rag/ragData.test.ts",
  "src/lib/research/researchDashboard.test.ts",
  // Transitive: roadmapGraph imports @/lib/graph, whose builder reads the DB.
  "src/lib/roadmap/roadmapGraph.test.ts",
];

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json. Vitest does not read
    // tsconfig paths on its own.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Spread vitest's own defaults rather than replacing them — an empty
    // array here would drop the node_modules/dist exclusions and try to run
    // every dependency's tests.
    exclude: process.env.DATABASE_URL
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, ...DB_BACKED],
    passWithNoTests: true,
    // The DB-backed files share one local Postgres and clean up after
    // themselves by id, exactly like the worker suite. Serialize for the same
    // reason: parallel files race each other's deletes.
    fileParallelism: false,
  },
});
