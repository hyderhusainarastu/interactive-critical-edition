# Stage 7 journey matrix

This is the risk-based execution plan for charter §16.  It deliberately adds
cross-workflow entry-point tests rather than duplicating the detailed seeded
tests already maintained beside their owning features.  All journeys use
disposable verified users and deterministic database fixtures; no journey
starts a worker or a paid provider request.

| Journey | Matrix entry point | Detailed evidence retained in |
| --- | --- | --- |
| 1 Upload lifecycle | `j01-upload-lifecycle.spec.ts` | `upload.spec.ts`, `work-status.spec.ts`, `trash.spec.ts` |
| 2 Reader continuity | `j02-reader-continuity.spec.ts` | `edition.spec.ts`, `rag.spec.ts` |
| 3 Library discovery | `j03-library-discovery.spec.ts` | `library.spec.ts`, `sources-tab.spec.ts` |
| 4 Research project | `j04-research-project.spec.ts` | `stage5-research-verification.spec.ts` |
| 5 Read to Write | `j05-reading-to-writing.spec.ts` | `writer-insertion.spec.ts`, `roadmap2d.spec.ts`, `knowledge-map.spec.ts` |
| 6 Corrections/provenance | `j06-correction-provenance.spec.ts` | `stage5-research-verification.spec.ts` |
| 7 Writer lifecycle | `j07-writer-lifecycle.spec.ts` | `writer.spec.ts`, `writer-export.spec.ts`, `writer-panels.spec.ts` |
| 8 Ask Library | `j08-ask-library-deep-links.spec.ts` | `ask-research-modes.spec.ts`, `workspace-shell.spec.ts` |
| 9 Account surfaces | `j09-account-surfaces.spec.ts` | `account.spec.ts`, `feedback.spec.ts`, `security.spec.ts` |
| 10 Bookmarks | `j10-legacy-bookmarks.spec.ts` | `knowledge-map.spec.ts`, graph-display codec unit tests |

## Pairwise/risk rationale

Every journey runs in Chromium at 1440×900 and exactly one guided mobile size:
odd journeys use 375×812; even journeys use 320×690.  The four workflows whose
layout changes materially with an intermediate desktop width (Reader/Research,
Knowledge Map, and Writer: journeys 2, 4, 5, 7) also run at 1024×900 and
768×1024.  These projects are declared in `apps/web/playwright.config.ts` so
the selection is executable and reviewable, rather than a claim in prose.

This is not a full Cartesian product.  Browser-engine smoke, dark theme,
reduced-motion, keyboard, long/empty/error and accessibility cases stay in the
feature suites listed above, where their fixtures and assertions are specific.
Before a release, final Stage 7 runs must record the exact commands/results in
`docs/audits/ui-graph-redesign-verification.md`; manual VoiceOver walkthroughs
remain a required human gate and cannot be claimed by these automated specs.
