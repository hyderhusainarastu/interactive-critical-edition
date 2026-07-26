# `classifyCitationForm` eval — ScholarLens retrofit (Phase 29.3)

## What this is

`classifyCitationForm` (`../types.ts`) is a small, pure, regex-based
heuristic that has shipped in production since Phase 20.8 (D-20-81/D-20-82):
it decides whether a citation string is book-, journal-, or classical-form
so `resolveCitation` (`../index.ts`) can order the four bibliographic
providers (Crossref/OpenAlex/Open Library/Google Books) sensibly for that
citation, instead of always trying Crossref first. Until this lane, it had
regression tests (in `../resolve.test.ts`) but no *eval* — no gold set, no
per-class precision/recall, no macro-F1, no confusion matrix, no ratchet
floor to catch a future regression.

`docs/architecture/scholarlens-integration-plan.md`'s "What ScholarLens
improves in *existing* Palimnote (reverse direction)" section names exactly
this gap: ScholarLens's own eval discipline — versioned gold sets,
deterministic train/test splits, Cohen's kappa + macro-F1 + honest
"no meaningful difference" verdicts — "applied not just to the new judge but
retrofitted to Palimnote's existing 10-category relationship classifier and
**citation-form classifier**." This directory is that retrofit for the
citation-form classifier specifically (the 10-category relationship
classifier retrofit is a separate, not-yet-done lane).

## What's here

- **`goldSchema.ts`** — the `GoldCitationFormExample` shape and its
  validator/parser, following `@ice/claims/src/eval/goldSchema.ts`'s own
  precedent (throw on a malformed row rather than silently dropping it).
- **`gold/citationForms.json`** — 43 labeled citation strings (>= the 40
  the brief called for), covering all four of `classifyCitationForm`'s real
  output values (book/journal/classical/unknown) plus two provisional
  chapter-in-edited-volume edge cases (see "Provisional labels" below).
  Every entry carries a `source` field: either a file:line pointing at a
  real fixture already in this codebase, a `docs/PROJECT-LOG.md` changelog
  entry describing a real production case, or an explicit
  `synthetic: true` marking a hand-constructed probe of one specific regex
  branch — never an invented citation presented as a real one.
- **`classifierEval.test.ts`** — CI-safe, zero-network (the function under
  test is pure regex matching over a string; nothing here calls a provider,
  a database, or an LLM). Runs `classifyCitationForm` over every gold
  example, scores it with the *same* metric/split machinery
  `@ice/claims`'s judge eval uses (`confusionMatrix`/`perClassPRF1`/
  `macroF1`/`cohenKappa` from `eval/metrics.ts`, `splitItems` from
  `eval/split.ts` — imported, not reimplemented; see "Dependency direction"
  below), prints the full per-class table + confusion matrix + train/test
  split breakdown + a misclassification list on every run, and asserts a
  ratchet floor.

## The honest-verdict discipline

Three things this retrofit deliberately does **not** do, matching the
ScholarLens-derived discipline the plan calls for:

1. **The floor was measured, then hard-coded** — not picked aspirationally.
   `classifierEval.test.ts`'s `RATCHET_MACRO_F1_FLOOR` constant carries a
   dated comment recording the exact measured macro-F1 (0.9558, measured
   2026-07-26) and per-class breakdown at measurement time, with the floor
   set to that number minus a 0.02 margin (0.9358) — the same margin
   convention `@ice/claims/src/eval/gates.ts` uses for its own regression
   gates (`EMPIRICAL_REGRESSION_MAX`).
2. **Every run prints the full table, not just a pass/fail** — the eval
   test's console output (per-class P/R/F1, the confusion matrix, the
   train/test split breakdown, and an explicit list of which gold ids
   misclassified and how) is designed so a future prompt/heuristic change to
   `classifyCitationForm` gets a visible before/after, not just a green or
   red checkmark.
3. **Real misclassifications were left as findings, not silently fixed
   here.** Two gold examples (`cf_042`, `cf_043` — both a citation shaped
   like a chapter within an edited volume, one real and one synthetic) are
   genuinely misclassified by the current implementation: their quoted
   chapter title trips `classifyCitationForm`'s `QUOTED_TITLE` check before
   its `BOOK_MARKERS` check ever runs (`types.ts:171-172`), so the function
   predicts "journal" where this eval's gold label says "book" (see
   "Provisional labels" below for why that gold label, and this lane's
   completion report for the register-worthy finding). This lane's scope is
   measurement only — see the brief — so the branch order is untouched.

## Provisional labels — the "chapter" gap

`classifyCitationForm`'s real output type, `CitationForm`
(`../types.ts:98`), has exactly four values: `"book" | "journal" |
"classical" | "unknown"`. There is no fifth "chapter" value the function
could ever return — it was never designed to distinguish a chapter within an
edited volume from the volume itself. `GoldCitationFormExample.goldForm` is
therefore restricted to those same four values (`goldSchema.ts` validates
this), while a separate, unscored `citationShape` field records the finer
real-world bibliographic shape (`"chapter-in-edited-volume"`,
`"monograph"`, `"journal-article"`, etc.) purely descriptively.

For the two chapter-in-edited-volume gold rows (`cf_042`, sourced from the
real, already-documented D-20-88 extraction-coverage gap; `cf_043`, a
second synthetic probe of the same branch-order collision), this eval makes
an explicit, flagged judgment call: `goldForm` is set to `"book"`, on the
reasoning that an individual book chapter is more likely to resolve (if at
all) through a book-catalogue lookup than a Crossref/OpenAlex DOI search.
That reasoning is contestable — a future reviewer with better evidence about
where chapter-form citations actually resolve should feel free to
relitigate it. Both rows carry `provisional: true` and a `notes` field
explaining the judgment, exactly matching `@ice/claims/src/eval/
goldSchema.ts`'s own `provisional` convention for its humanities-domain
gold rows. They are still counted in every metric like any other row (no
special-casing in the scoring code) — `provisional` only changes which
findings get flagged as worth a second look, not how they're scored.

## Dependency direction

`@ice/bibliographic` now depends on `@ice/claims` (see `package.json`),
importing `confusionMatrix`/`perClassPRF1`/`macroF1`/`cohenKappa`/
`splitItems` rather than reimplementing them. This direction is legal and
was checked before adding it: `@ice/claims` has zero workspace dependencies
by design (its own `src/index.ts` doc comment: "Zero workspace
dependencies, zero runtime dependencies") and does not import from
`@ice/bibliographic` or `@ice/research` anywhere in its source — confirmed
by grep before this dependency was added, not assumed. `@ice/research`
already depends on `@ice/bibliographic`, so the resulting graph is
`@ice/research → @ice/bibliographic → @ice/claims`, a straight line with no
cycle.

## Re-running / updating this eval

```sh
pnpm --filter @ice/bibliographic test -- classifierEval
```

If a `classifyCitationForm` change is deliberate and improves real
citations' classification, re-run the command above, copy the new printed
macro-F1 into `RATCHET_MACRO_F1_FLOOR`'s dated comment (with today's date)
and lower the floor by the same 0.02 margin. If it's a regression, the
printed misclassification list names exactly which gold ids broke and what
they were mispredicted as — start there.
