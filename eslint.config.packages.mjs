// Shared ESLint config for every `packages/*` workspace and `apps/worker`.
//
// Before this file, `pnpm -r lint` covered exactly one package (`apps/web`),
// because it was the only one with a `lint` script — so nothing enforced
// import hygiene across the other sixteen.
//
// Deliberately minimal. The one rule here is load-bearing for the way this
// monorepo is organised: every `@ice/*` package exposes a single public
// surface through its `src/index.ts` barrel, and reaching past that barrel
// into another package's internals couples callers to file layout that the
// owning package is free to rearrange. Stylistic rules are intentionally
// absent — adding them to sixteen previously-unlinted packages would bury
// real findings under thousands of unrelated warnings.
//
// `apps/web` keeps its own `eslint.config.mjs` (Next.js presets).

import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts", "**/*.mts"],
    linterOptions: {
      // Several packages carry `eslint-disable-next-line no-console`
      // comments from before they had a config at all. `no-console` is not
      // enabled here (these are CLI/worker packages where console output is
      // the point), so those directives read as "unused" and would emit ~13
      // warnings of pure noise. The comments still document intent.
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ice/*/src/*", "@ice/*/src"],
              message:
                "Import from the package barrel (e.g. `@ice/ingestion`), not its internal `src/` path. If the symbol you need is not exported, add it to that package's src/index.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["dist/**", "build/**", "node_modules/**", "**/*.d.ts"],
  },
];
