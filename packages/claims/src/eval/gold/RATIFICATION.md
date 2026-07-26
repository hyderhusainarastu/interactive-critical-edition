# Humanities gold-set ratification (Lane L5, Phase 25)

**Status: DRAFT / PROVISIONAL.** Every record in this directory carries `"provisional": true`.
Nothing here is a ratified gold label yet. This document exists so the owner can turn these
drafts into real gold data.

## What was produced

| File | Records | Purpose |
|---|---|---|
| `relationshipPairs.humanities.json` | 36 | Claim-pair records (support/contradiction/nuance/unrelated) about Aristotle on vice, akrasia, and ignorance, for the humanities relationship-classifier judge gate. Mirrors the shape of `scholarlens_src/eval/gold_claims.json`, with `"domain": "ancient_philosophy"` added. |
| `retrievalNegatives.json` | 22 | Deliberately low-similarity, cross-domain "unrelated" pairs (one claim from the Aristotle corpus, one from ScholarLens's empirical content domains: negotiation coaching, information retrieval, LLM reasoning), so the stage-1 retrieval/separation harness has honest should-reject mass. |
| `claimNature.json` | 65 | Single-claim records covering all 8 claim natures (`empirical`, `textual`, `interpretive`, `historical`, `conceptual`, `normative`, `definitional`, `methodological`), for the claim-nature classification gate. |

All three files are valid JSON (verified with `node -e "require(...)"` at generation time).

## Sourcing discipline

- Every Aristotle-corpus claim text is a **paraphrased position statement grounded in a real
  source**, never an invented quotation. Sources drawn on:
  - `baseline-test/roochnik_vicious_baseline_test.md` — the full researched baseline for
    Roochnik's "Aristotle's Account of the Vicious: A Forgivable Inconsistency" (2007), including
    its argument map, passage map (Bekker references), source inventory, position map, and
    concept glossary.
  - `docs/eval/irwin-vice-and-reason/vice-and-reason.manifest.json` and
    `vice-and-reason.fixture.json` — the expected-coverage floor for Irwin's "Vice and Reason"
    (2001), including its stated arguments, required concepts, Aristotelian background loci, and
    scholarly-debate relationships (Brickhouse, Muller, Nielsen, Solis, Annas, etc.).
  - The primary text itself (Nicomachean Ethics, cited by Bekker reference) and the named
    secondary works those two documents ground (Bostock 2000, Annas 1977, Brickhouse 2003,
    Muller 2015, Nielsen 2017, Barney 2020, Solis 2025, Broadie 1991), plus Homer's *Odyssey*
    XI/IV and Plato's *Republic* IX / *Gorgias*, both used by these papers as explicit
    comparanda.
  - The `AristotlesAccountoftheVicious.pdf` fixture itself was not separately re-transcribed;
    the baseline-test markdown is a prior, already-verified close reading of that exact PDF
    (including OCR/diacritic caveats it documents), so it was used as the primary source rather
    than re-deriving the same passages from a possibly-OCR-damaged PDF a second time.
- Every ScholarLens-sourced claim text (used for `retrievalNegatives.json`'s cross-domain half,
  and for `claimNature.json`'s `empirical`/`methodological` records) is paraphrased from
  `scholarlens_src/eval/gold_claims.json`'s own `claim_a`/`claim_b` text and cites that record's
  `paper_title`.
- `relationshipPairs.empirical.json` (referenced in the lane brief as the source for
  `retrievalNegatives.json`'s non-Aristotle claim) did not exist yet in this worktree at
  drafting time (another lane owns it). The negatives were sourced directly from
  `scholarlens_src/eval/gold_claims.json`'s own content instead, which is the same underlying
  material that file is expected to mirror. **Re-check `retrievalNegatives.json`'s claim_b texts
  against the finished `relationshipPairs.empirical.json` once it lands**, in case that lane
  rephrased any of the same source claims differently — the two should describe the same
  findings, not necessarily in identical words.
- No DOIs, page numbers, or Bekker references were invented; where a document number is uncertain
  in the source material (e.g. `PAS-041`'s "verify edition/location" flag in the baseline), no
  claim in this gold set was built on that specific uncertain locus.

## What the owner needs to do

1. **Read every record's `rationale`** against the cited source (the baseline-test markdown, the
   Irwin manifest, or a direct check of the Nicomachean Ethics passage/secondary source named).
   Confirm the claim text is a fair paraphrase of a real, attributable position — not a distortion
   or an overreach beyond what the source actually supports.
2. **Correct or reject labels.** In particular:
   - The `nuance` records carrying `"mechanismDraft"` are this lane's best guess at *why* a pair
     looks contradictory but isn't. Treat `mechanismDraft` values as drafts to confirm, edit, or
     remove — they are not independently validated.
   - The `contradiction` vs `nuance` line is genuinely contested in the literature itself for
     several of these pairs (e.g. hum_009, hum_017: is Brickhouse's reconciliation a real
     rebuttal of the inconsistency claim, or does it concede the surface tension while offering a
     compatible scope-qualified reading?). Where the owner's own judgment differs from this
     draft's placement, that is expected and should be corrected, not treated as an error to
     silently accept.
   - `category` values here (`textual`, `interpretive`, `historical`, `definitional`,
     `methodological`) are a locally invented vocabulary for this humanities domain rather than a
     reuse of ScholarLens's exact `findings`/`scope`/`methodological` set, since those categories
     were fitted to empirical papers. Confirm this vocabulary is acceptable, or have the owner
     specify a preferred one and this file can be regenerated.
3. **Delete any record that doesn't hold up.** Every id is independent (`hum_NNN`, `negx_NNN`,
   `nat_NNN`); removing one does not require renumbering the rest, though the owner may want to
   renumber for cleanliness once the set is final.
4. **Set `"provisional": false`** on every record that survives review (per record, or via a
   bulk script once the owner is satisfied with the whole file). **The humanities judge gate and
   the claim-nature gate must treat only `provisional: false` records as gold** — this lane does
   not implement that gating logic itself (that belongs to the package/harness lane), it only
   drafts the data and states the rule here.
5. **Estimated review time: 1-2 hours** for a domain-fluent reviewer (someone who can sanity-check
   Aristotelian exegesis at a glance) working through all 123 records across the three files.

## Summary counts

### `relationshipPairs.humanities.json` (36 records)

| Label | Count |
|---|---|
| support | 8 |
| contradiction | 7 |
| nuance | 15 (11 carry a `mechanismDraft`) |
| unrelated | 6 |

| Category | Count |
|---|---|
| interpretive | 18 |
| methodological | 8 |
| textual | 6 |
| historical | 2 |
| definitional | 2 |

Split: 25 train / 11 test (~70/30).

### `retrievalNegatives.json` (22 records)

All labeled `unrelated`, category `scope`. Cross-domain pairing (`ancient_philosophy` vs one of
`negotiation_coaching`, `information_retrieval`, `llm_reasoning`). Split: 15 train / 7 test
(~70/30).

### `claimNature.json` (65 records)

| Nature | Count | Source pool |
|---|---|---|
| textual | 9 | Aristotle material |
| interpretive | 9 | Aristotle material |
| definitional | 8 | Aristotle material |
| normative | 8 | Aristotle material |
| conceptual | 8 | Aristotle material |
| historical | 7 | Aristotle material |
| empirical | 8 | ScholarLens gold_claims.json |
| methodological | 8 | ScholarLens gold_claims.json |

Every nature has at least 6 records, as required.
