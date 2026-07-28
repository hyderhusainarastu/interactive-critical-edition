# UI/graph redesign handoff — pre-final

## Current state

This handoff transfers a prepared redesign program, not a release. `main`
remains at `6f9330c`; the canonical redesign lineage is
`redesign/ui-graph-rebuild`, whose pre-Stage-7 integration head is `491c092`.
The Stage 7 journey matrix is a child commit, `fbfedf3`, on
`redesign/journey-matrix`.

Do not merge individual Stage 2/4/5/6 branches: their work is already
reachable from the canonical redesign lineage.

## Commit map

| Work | Commit / merge |
| --- | --- |
| Stage 0 baseline | `ad3b140` → `72744d6` |
| Stage 1 shell | `4fe2913` → `3ce4a0b` |
| Stage 2 bakeoff | `0699182` (branch tip `2650178`) |
| Stage 3 Knowledge Map | `ba94cef` → `a246da0` |
| Stage 4 Read | `006aac0` (branch verification tip `e6bfa62`) |
| Stage 5 Research | `528623f` (branch verification tip `ceff954`) |
| Stage 6 Write | `e5650a2` (branch verification tip `857bee7`) |
| Cross-stage integration | `9a9485b` → `491c092` |
| Stage 7 journeys | `fbfedf3` |

## Recommended continuation order

1. Preserve and commit the separate accessibility/hydration worktree changes.
2. Integrate that commit and `fbfedf3` onto the one canonical redesign
   lineage; resolve overlapping test/config edits deliberately.
3. Freeze the resulting commit as the final-tree candidate.
4. Run the final gate in
   `docs/audits/ui-graph-redesign-verification.md`, update it with actual
   results, and refresh the preservation matrix only if the final tree
   changes routes/capabilities.
5. Obtain explicit authorization before any merge to `main`, push, migration,
   deployment, or production action.

## Authorization boundary

Authorized by this handoff: local integration, review, CI-safe tests, and
documentation updates in the supplied worktrees. Not authorized: production
database changes, secrets, live provider calls, real Storage tests, merge to
`main`, push, deploy, or cleanup of external/local runtime resources.

## Evidence index

- Stage-level verification: `docs/audits/stage3-kmap-verification.md`,
  `stage4-read-verification.md`, `stage5-research-verification.md`, and
  `stage6-write-verification.md`.
- Journey matrix and viewport rationale:
  `docs/design/stage7-journey-matrix.md` and `apps/web/e2e/journeys/`.
- Preservation status:
  `docs/audits/ui-graph-redesign-preservation-matrix.md`.
- Pre-final prep artifacts (not tracked, not final evidence):
  `/private/tmp/claude-501/-Users-hyderhusainarastu-Project-AutoCriticalEditionProject/6c3d839e-398b-49e8-b9c3-2a6d03612b7d/scratchpad/stage7-prep`.

## Open/explicit limitations

- Final-tree verification has not yet run.
- Manual VoiceOver validation remains open.
- The current local environment has no server on port 3000, so the journey
  matrix has typechecked and been discovered but has not been executed here.
- The scratchpad accessibility pass found issues on the pre-final snapshot;
  do not call them fixed without final-tree evidence.
