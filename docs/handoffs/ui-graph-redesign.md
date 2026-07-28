# UI/graph redesign handoff — final candidate

## Current state

The canonical local redesign candidate is `2c0f820` on
`redesign/ui-graph-rebuild`. It integrates the Stage 7 journey matrix,
accessibility/hydration repairs, graph coverage, and legacy-chooser/touch
repairs. It is **not** a release: the final journey matrix is incomplete,
manual VoiceOver has not run, and no merge/push/deploy authority exists.

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
| Stage 7 matrix and accessibility/hydration integration | `ff0b9c4` → `aa8ca51` |
| Final graph/browser and legacy-chooser repairs | `79bb2cd` → `2c0f820` |

## Verified final-candidate evidence

- Earlier final-program monorepo unit pass is retained as evidence.
- Web typecheck, lint, and production build are green on the final candidate.
- Targeted Chromium accessibility/hydration checks: 7/7 green.
- Firefox 151 and WebKit 26.5 login hydration checks are clean.
- Invalid/ambiguous legacy chooser and small-fixture mobile touch stress pass
  with retries disabled.
- Stage 7 journeys: 15 passed before interruption; J01 and J07 are active
  repair/re-run blockers, not waived results.

See `docs/audits/ui-graph-redesign-verification.md` for the precise gate
boundary and remaining requirements.

## Required continuation

1. Finish the parallel J01 and J07 repairs, then re-run those journeys.
2. Complete the remaining final journey matrix, including declared viewport,
   browser, keyboard, light/dark, and reduced-motion coverage.
3. Run and record the required manual VoiceOver walkthroughs and real-GPU
   performance measurement.
4. Refresh the preservation matrix and verification record with completed
   evidence from the same final integrated commit.
5. Obtain explicit owner authorization before merge to `main`, push,
   migration, deploy, production setting change, paid API use, or production
   action.

## Authorization boundary

Authorized in the redesign program: local integration, review, CI-safe
testing, and documentation updates. Not authorized: production database
changes, secrets, live provider calls, real Storage tests, merge to `main`,
push, deploy, or external-runtime cleanup.

## Explicit limitations

- The final full Stage 7 journey matrix is incomplete; J01 and J07 require
  re-run after their repairs.
- Manual VoiceOver validation has not been run.
- Local/seeded verification does not establish production behavior.
