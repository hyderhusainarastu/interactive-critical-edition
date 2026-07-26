# Relationship-Category Gold Set Provenance

`relationshipCategories.json` — 60 hand-labeled examples for the 10-category
relationship classifier (`RELATIONSHIP_CATEGORIES` in `../../types.ts`), 6
per category. Retrofits the `@ice/claims` eval discipline (deterministic
SHA-256 train/test split, confusion matrix, per-class P/R/F1, macro-F1,
Cohen's kappa) onto Palimnote's existing classifier, per
`docs/architecture/scholarlens-integration-plan.md`'s "reverse direction"
section and Phase 29.3.

## Sourced from existing fixtures (`synthetic: false`)

9 examples transcribed verbatim from `packages/ai-adapters/src/eval.test.ts`
(the Phase 7 harness) and `packages/ai-adapters/src/classify.test.ts`
(`heuristicClassify` unit tests), each row's `source` field naming the exact
file. These are real, already-reviewed fixtures the project has relied on
since Phase 7/9; reusing them (rather than re-authoring equivalent text)
keeps this gold set consistent with what those files already assert.

## Authored for this gold set (`synthetic: true`)

51 examples written for this lane, in the grounded scholarly register the
project's own worked examples use (Heidegger/*Being and Time*,
Vico/*The New Science*, Irwin/*Vice and Reason* on Aristotle's
*Nicomachean Ethics*, Kant, Husserl). None are presented as real citations —
`primaryTitle`/`candidateTitle` name real works for realism, but
`sourceText` is invented prose illustrating the target category, not a
transcription of any actual passage. Two categories — `interpretive_aid`
and `optional_extension` — have essentially no coverage in the existing
Phase 7/9 fixtures, so all 6 examples for each are authored here.

## Field shape

Mirrors `ClassificationInput` (`../../types.ts`) field-for-field
(`primaryTitle`, `primaryAuthor`, `candidateTitle`, `candidateAuthor`,
`sourceText`, `resolved`, optional `citationFrequency`) plus the gold
`category` label and the `synthetic`/`source` provenance fields — see
`../goldSchema.ts` for the validated shape. A gold row can be spread
directly into `heuristicClassify()` or `classifyRelationship()` with no
reshaping.
