# UI/graph redesign verification — pre-final handoff

**Status: NOT A RELEASE GATE.** This document records the evidence available
before final-tree integration and identifies the work that must be repeated
after the final merge. It must not be read as deployment, production, or
VoiceOver sign-off.

## Scope and snapshot boundary

The recovered Stage 7 preparation evidence was gathered against two distinct
pre-final snapshots:

- `6f9330c` (`main`) for the before baseline, build, and visual capture.
- `4e779e6` for the merged redesign snapshot used for preservation and
  accessibility preparation.

The current journey-matrix commit is `fbfedf3`, a descendant of `4e779e6`.
None of these is the eventual final integrated tree. Therefore every result in
the **final gate** table below is deliberately `PENDING FINAL TREE`.

## What prior stages established

| Stage | Recorded outcome | Primary evidence |
| --- | --- | --- |
| 0 | Baseline charter/audit completed; 12/12 charter defects and no-WebGL failure documented. | `72744d6`, `docs/audits/ui-graph-redesign-baseline.md` |
| 1 | Shell/design-system gate passed. | `3ce4a0b` |
| 2 | Bakeoff selected Prototype A after corrected lifecycle measurement. | `0699182`, `docs/audits/graph-renderer-bakeoff.md` |
| 3 | Re-verification completed after the degenerate-resize blank-scene repair. | `a246da0`, `docs/audits/stage3-kmap-verification.md` |
| 4 | Read gate passed with documented storage/environment exceptions. | `e6bfa62`, `docs/audits/stage4-read-verification.md` |
| 5 | Research round-two independent verification passed. | `ceff954`, `docs/audits/stage5-research-verification.md` |
| 6 | Writer round two passed after two in-lane fixes. | `857bee7`, `docs/audits/stage6-write-verification.md` |

Stage 6's first verification was explicitly not passed (`e4ac773`); this was
subsequently repaired (`a4c9c5d`) and re-verified at `857bee7`. That history
is retained here to avoid presenting the program as a single clean pass.

## Recovered Stage 7 preparation evidence (pre-final only)

The retained scratchpad evidence is outside this repository at
`/private/tmp/claude-501/-Users-hyderhusainarastu-Project-AutoCriticalEditionProject/6c3d839e-398b-49e8-b9c3-2a6d03612b7d/scratchpad/stage7-prep`.
It reports a successful production build and 33 before screenshots at
`6f9330c`, plus pre-final Firefox/WebKit smoke captures. It also records a
proxy accessibility pass, not a human screen-reader pass.

That proxy found four real issues on the `4e779e6` snapshot: unnamed
collapsed-rail links, Reader evidence/sidebar contrast, Knowledge Map/Writer
dialog contrast, and missing Knowledge Map result/selection announcements.
Those observations are inputs to the separate accessibility-fix work; they
are **not** certified fixed by this document.

The preparation preservation comparison found no page-route removals from
the baseline snapshot. Its three added pages were `/works/[workId]/sources`,
`/research/[projectId]/chambers`, and `/research/[projectId]/graph`.
`docs/audits/ui-graph-redesign-preservation-matrix.md` carries the durable,
reviewable version of that comparison.

## Final gate — PENDING FINAL TREE

| Required final-tree activity | State | Required record |
| --- | --- | --- |
| Install/typecheck/lint/production build | **PENDING FINAL TREE** | exact commands, exit status, commit |
| Stage 7 signed-in journeys at declared viewports | **PENDING FINAL TREE** | matrix run and 10 journey outcomes |
| Critical Chromium/Firefox/WebKit smoke | **PENDING FINAL TREE** | browser/version/viewport and results |
| Light/dark and reduced-motion targeted checks | **PENDING FINAL TREE** | screenshot/assertion locations |
| Automated axe and keyboard-only workflows | **PENDING FINAL TREE** | violations, fixes, or accepted limitations |
| Manual VoiceOver walkthroughs | **PENDING FINAL TREE** | operator, routes, findings; automation is insufficient |
| Preservation/legacy-bookmark regression check | **PENDING FINAL TREE** | route and codec results |
| Real-GPU performance measurement | **PENDING FINAL TREE** | machine/browser/GPU; headless timing is not a substitute |

## Known limitations and non-claims

- No production access, migration application, deployment, push, or merge is
  authorized by this verification record.
- Seeded tests do not prove live-provider, worker, real Storage, or paid API
  behavior. Existing stage docs already record the dummy-Storage limitation.
- The recovered cross-browser captures and accessibility proxy are pre-final
  snapshot evidence only. They cannot close a final-tree gate.
- A human VoiceOver pass remains mandatory for the Charter's specified
  Home/Read, Reader evidence, Research claim/debate, Knowledge Map, and
  Writer insertion walkthroughs.

## Closing rule

Only after every `PENDING FINAL TREE` row is replaced by evidence from the
same final commit may this file be changed from **pre-final handoff** to a
verification gate record.
