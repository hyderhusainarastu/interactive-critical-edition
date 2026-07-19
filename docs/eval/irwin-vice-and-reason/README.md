# Private evaluation package — Irwin, "Vice and Reason" (2001)

This directory is the **gold-eval steering package** for the Phase 8 relevance
closeout and the Phase 9 learning workspace. It exists so that a v2/v3 run over
the Irwin paper can be scored against expected coverage instead of being judged
by eyeballing the output.

## What is here

| File | Purpose |
|---|---|
| `vice-and-reason.fixture.json` | PDF hash, byte size, storage location, bibliographic identity, lawful-purpose statement |
| `vice-and-reason.reference-brief.md` | The user-supplied report, verbatim, with corrupted spans marked |
| `vice-and-reason.manifest.json` | Machine-readable expected concepts, arguments, sources, relationships, annotations, curriculum, and **negative examples** |
| `vice-and-reason.verification.json` | Independent verification result for every bibliographic and substantive assertion in the brief |

## The PDF is never committed

The source PDF lives **only** in the private Supabase Storage bucket
`eval-fixtures` (see `vice-and-reason.fixture.json` for the path and hash). It is
not in git and must not be added. A `.gitignore` in this directory blocks
`*.pdf` as a guard, not as permission.

The manifest carries **short anchor excerpts only** — the minimum quotation
needed to locate a passage and score an anchor — never reproduced sections.

## The brief is a steering document, not verified scholarship

`vice-and-reason.reference-brief.md` is what the user supplied. It defines
**minimum expected coverage**: the evaluation fails if the generated edition
misses what the brief covers. It does **not** define correctness. Every DOI,
thesis attribution, influence claim, and source characterization in it was
checked independently; the results — including the discrepancies found — are in
`vice-and-reason.verification.json`.

Where the brief and the verification disagree, **the verification wins**. Where
neither could settle a question, the item is recorded as an open evaluation
question rather than being promoted to an accepted fact.

## Scoring stance

- The brief's beginner / undergraduate / reconstruction summaries are expected
  **semantic** coverage. A run is scored on whether it explains the same things,
  never on whether it reproduces the same sentences.
- The curriculum spine in the manifest is a **floor**, not a fixed answer. An
  autonomous run may reorder or extend it when evidence supports doing so, but
  must explain every deviation.
- Negative examples are drawn from **actually observed** false positives during
  verification, not invented. They are the sharper half of the test.
