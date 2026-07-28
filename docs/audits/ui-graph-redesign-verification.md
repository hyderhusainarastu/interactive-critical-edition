# UI/graph redesign verification — final-candidate record

**Candidate:** `2c0f820` on `redesign/ui-graph-rebuild`.

**Status: verification remains partial; this is not a release, production, or
VoiceOver sign-off.** It records final-candidate facts verified during the
Stage 7 run and retains every unclosed gate explicitly.

## Scope and commit boundary

The canonical redesign lineage integrated the Stage 7 journey matrix,
accessibility/hydration repair, graph-browser coverage, and subsequent
legacy-chooser and touch-stress repairs through `2c0f820`. Earlier
preparation evidence at `6f9330c` and `4e779e6` remains useful only as
before-state/context evidence; it is not substituted for final-candidate
results.

## Prior-stage record

| Stage | Recorded outcome | Primary evidence |
| --- | --- | --- |
| 0 | Baseline charter/audit completed; 12/12 charter defects and no-WebGL failure documented. | `72744d6`, `docs/audits/ui-graph-redesign-baseline.md` |
| 1 | Shell/design-system gate passed. | `3ce4a0b` |
| 2 | Bakeoff selected Prototype A after corrected lifecycle measurement. | `0699182`, `docs/audits/graph-renderer-bakeoff.md` |
| 3 | Re-verification completed after the degenerate-resize blank-scene repair. | `a246da0`, `docs/audits/stage3-kmap-verification.md` |
| 4 | Read gate passed with documented storage/environment exceptions. | `e6bfa62`, `docs/audits/stage4-read-verification.md` |
| 5 | Research round-two independent verification passed. | `ceff954`, `docs/audits/stage5-research-verification.md` |
| 6 | Writer round two passed after in-lane repairs. | `857bee7`, `docs/audits/stage6-write-verification.md` |

## Final-candidate evidence

| Activity | Result | Boundary / notes |
| --- | --- | --- |
| Monorepo unit suite | **PASS (earlier final-program run)** | Retained evidence from the final-program run; no claim that it was re-run in this documentation lane. |
| Web typecheck, lint, production build | **PASS** | Final candidate `2c0f820`; recorded final-gate result. |
| Chromium targeted accessibility/hydration checks | **PASS, 7/7** | Final-candidate targeted checks; includes the repaired collapsed-rail naming, contrast, Map live-region, and hydration coverage. |
| Firefox login hydration | **PASS, 151** | Final-candidate login hydration check; no reported hydration error. |
| WebKit login hydration | **PASS, 26.5** | Final-candidate login hydration check; no reported hydration error. |
| Legacy bookmark chooser | **PASS, retries=0** | Invalid and ambiguous legacy roadmap-root chooser case passed at `2c0f820`. |
| Small-fixture touch stress | **PASS, retries=0** | Mobile hub/satellite selection and Home-framing check passed at `2c0f820`. |
| Stage 7 signed-in journey matrix | **PARTIAL** | 15 journeys passed before interruption. J01 and J07 have real blockers in parallel repair and must be re-run after those repairs. |

## Final gate status

| Required final-tree activity | State | Required remaining record |
| --- | --- | --- |
| Install/typecheck/lint/production build | **PASS** | Final-candidate command record retained by the gate run. |
| Stage 7 signed-in journeys at declared viewports | **PENDING: J01/J07 RE-RUN; full matrix incomplete** | Re-run J01 and J07 after their repairs, then complete the matrix. |
| Critical Chromium/Firefox/WebKit smoke | **PARTIAL PASS** | Chromium targeted checks and Firefox/WebKit login hydration passed; complete the declared critical-route smoke record if not otherwise captured by the final matrix. |
| Light/dark and reduced-motion targeted checks | **PENDING FINAL MATRIX** | Link final screenshots/assertions. |
| Automated axe and keyboard-only workflows | **PARTIAL PASS** | Chromium targeted accessibility/hydration checks passed; record remaining required keyboard workflows with the final matrix. |
| Manual VoiceOver walkthroughs | **PENDING — NOT RUN** | Operator, specified routes, findings; automation is insufficient. |
| Preservation/legacy-bookmark regression check | **PARTIAL PASS** | Legacy chooser browser regression passed; route/deep-link and capability matrix remains open. |
| Real-GPU performance measurement | **PENDING** | Machine/browser/GPU and measured result; headless timing is not a substitute. |

## Known limitations and non-claims

- J01 and J07 are not waived: their re-runs and the full final journey matrix
  remain required after the parallel repairs complete.
- Manual VoiceOver validation was not run.
- Seeded and local checks do not prove live-provider, worker, real Storage,
  paid API, or production behavior.
- No production access, migration application, merge to `main`, push,
  deployment, or production action is authorized by this record.

## Closing rule

Do not call the redesign complete until every remaining row above has linked
evidence from the final integrated tree, or is listed as an explicit accepted
limitation under owner authority.
