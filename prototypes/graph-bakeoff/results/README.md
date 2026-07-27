# Bench results

One JSON file per prototype per fixture per trial, written by
`e2e/bench.spec.ts` via `src/bench/runner.ts`, named
`<prototype>--<fixture>--trial<N>.json`.

**Status as of the Stage 2 harness-building pass: empty.** Prototype A and
Prototype B are not yet implemented (`src/prototypes/protoA` and
`src/prototypes/protoB` are labeled placeholder scaffolds) — the bench spec
that would populate this directory is deliberately `test.skip`-guarded so it
can't accidentally produce fabricated-looking numbers from a static
placeholder `<div>`. See `e2e/bench.spec.ts`'s top comment for what unblocks
it.
