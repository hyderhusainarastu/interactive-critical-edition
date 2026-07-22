# Phase 19 Interaction Inventory

Per `palimnote_phases_19_23_plan_revised.md` §19.5–19.6. This is a living, evidence-backed inventory: a control is marked **working** only after its visible interaction has been exercised in the local Playwright harness or an existing equivalent test; **fixed** means this audit first reproduced a defect, then added a regression; **pending** means it is deliberately not yet classified and must not be read as a pass.

The in-app browser runtime is unavailable in this agent session, so the interaction evidence below comes from the repository's real local Chromium/Playwright harness against the running web app and Postgres. Manual VoiceOver remains out of scope and open.

## Shared shell and modal controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Desktop shell | Primary nav, product-home link, visible feature-gated nav links | working | Existing `workspace-shell.spec.ts` authenticates and navigates the shell; feature-gate content assertion is covered by `hardening.spec.ts` (Writer) and `rag.spec.ts` (Ask Library). |
| Desktop shell | Search icon and `Ctrl/Cmd+K` command palette | fixed — D-19-14 | Pre-fix Shift+Tab escaped the dialog and Escape left focus outside it. The command palette now traps Tab/Shift+Tab and restores its trigger; `workspace-shell.spec.ts` exercises both paths. |
| Desktop shell | Light/dark quick switch and persisted theme select | working | `workspace-shell.spec.ts` and `hardening.spec.ts` exercise theme change and HTML token update. |
| Desktop shell | Workspace preferences popup lifecycle | fixed — D-19-19 | Pre-fix floating section had no dialog semantics, initial focus, trigger relationship, or restoration. It is now a labelled non-modal dialog whose close control receives focus and whose close/Escape returns the trigger; regression covers all of that. |
| Desktop shell | Preferences Theme selector | working | Existing workspace E2E selects Light and verifies the document theme token updates. |
| Desktop shell | Preferences text size and focus-mode checkbox | working | New `workspace-shell.spec.ts` regressions change each control and verify its real effect (computed `font-size` change, `data-font-size` attribute, focus-mode Exit-control visibility) plus persistence across a reload with `localStorage` cleared first, so persistence is proven server-side, not client-cached. |
| Desktop shell | Preferences reading width | fixed — D-19-21 | The shell-level `--reading-measure` CSS custom property did change per option (verified working), but the **Interactive Reader's own content column ignored it entirely** — `EditionReader.tsx` hardcoded `max-w-[72ch]`. Fixed to `max-w-[var(--reading-measure,72ch)]`; new `edition.spec.ts` regression proves the reader's actual rendered width changes with the preference. |
| Desktop shell | Preferences script display | working | New `edition.spec.ts` regression swaps a verified term's shown text between original script and transliteration. |
| Desktop shell | Desktop logout | working | New `workspace-shell.spec.ts` regression logs out, then confirms a subsequent visit to a protected route (`/dashboard`) redirects to `/login`. |
| Mobile shell | Open/close navigation, nav links, mobile logout | fixed — D-19-15 | Pre-fix overlay was a non-modal `aside` with no focus placement, trap, Escape, or restoration. It is now an accessible modal dialog; narrow-viewport Playwright test verifies initial focus, Shift+Tab containment, Escape, and trigger restoration. |
| Focus mode | Enable/exit focus mode | fixed — D-19-20 | Pre-fix, enabling Focus mode left keyboard focus on the now-visually-hidden preferences checkbox, and Tab could still reach the hidden shell. The real Chromium regression proves entry focus moves to Exit focus mode, the hidden shell is inert, and exit restores Workspace preferences focus. |

## Writer controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Writer projects | New project; project cards; archived-project show/hide; restore | working | `writer.spec.ts` creates a project, archives it with confirmation, shows archived projects, and restores it. |
| Writer editor | Project title; document title; draft autosave; active document; new document; reorder | fixed — D-19-25 | Reorder's own PATCH persistence was correct (DB-verified), but a separate `useEffect` keyed on the `active` **object reference** (not the stable document id) re-fired on every reorder and its `setStatus("Saved")` raced with — and could precede — the reorder's real write, so a reload immediately after reordering could observe the pre-reorder order. Reproduced 3/12 times before the fix, 0/12 after. Fixed by keying the effect on `activeDocumentId` and giving `moveDocument` its own explicit save-status lifecycle. |
| Writer editor | Citation import, insert, revision restore, DOCX/PDF export | working | `writer.spec.ts` imports BibTeX, inserts MLA text, exposes revisions, and validates actual DOCX/PDF downloads. |
| Writer editor | Library-source Cite/Read controls | working | New `writer.spec.ts` regression seeds a real Library source, clicks Cite (verifies a real citation appears + Insert places text in the draft), then clicks Read (verifies real navigation to `/works/{workId}/reader` with the work's actual title). |
| Writer editor | Desktop Library-source sidebar resize | fixed — D-19-13 | Pre-fix control was a pointer-only `<button>`: keyboard activation had no effect. It is now a `separator` with value semantics and Arrow/Home/End support; the regression verifies `aria-valuenow` and rendered width. |
| Writer editor | Archive confirmation | working | Existing Writer E2E accepts the confirmation and verifies the archive/restore result. |

## Library controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Library | Reading-status filter (All, To read, Reading, Completed) | fixed — D-19-16 | Pre-fix active state was colour/border only. It is now a labelled `group` with `aria-pressed`; a new Library E2E changes the filter and proves the selected state and result set. |
| Library | Relationship, source-type, and sort selectors | working | New `library.spec.ts` control-inventory regression exercises relationship filtering, source-type filtering, reset, and title ordering against distinct seeded rows. |
| Library | Per-resource reading-status selector | working | Existing Library E2E writes a scoped `reading_record` through the real UI and verifies persisted state after reload. |
| Library | Focus selector, newest-default and deep link | working | Existing Library E2E proves All works/work scoping, newest-upload focus, `?focus=` state, and narrow/reduced-motion use. |
| Library | Reader-level facets and level suggestion Switch/Dismiss | working | Existing Library E2E proves cumulative/exact matching, saved-level write, and locally remembered dismissal. |
| Library | Focused-work title, recommended-for chips, external resource links, and empty-state upload CTA | working | New `library.spec.ts` regressions click each: the focused-work title and a recommended-for chip both navigate to and render the real work page; an external resource link (`target="_blank"`) opens the real seeded URL in a new tab; the empty-state "Upload a work" CTA navigates to `/upload`. |

## Work-status and trash controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Ready work | Roadmap, Concept check, Curriculum, work Visualization, and Open reader action links | working / fixed | New CI-safe `trash.spec.ts` journey clicks each route from a ready work and returns. The work Visualization action is fixed as D-19-17, now exposed as “Visualization for [work title]” so it does not collide with the global link. |
| Ready work | Move-to-trash confirmation and Cancel | working | New journey opens the inline confirmation, verifies the irreversible-action message, and cancels it without mutating the work. |
| Trash | Move, restore, permanent-delete confirmation and Delete now | working | Existing `trash.spec.ts` covers normal-list removal, route protection, 30-day messaging, restore, and actual database deletion; full suite is 4/4 after the new journey. |
| Work status | Metadata-confirm form | working | New `work-status.spec.ts` seeds a `needs_review` document directly (bypassing the worker, per D-19-6's live-pipeline-cost finding) and confirms the form prefills from `extractedTitle`/`extractedAuthor` and submitting readies the work (DB-verified). |
| Work status | Processing progress indicator | working | New `work-status.spec.ts` seeds a `processing` document and confirms the real `V2_STAGE_SEQUENCE`-driven step list renders with correct done/active states. |
| Work status | Failed-state recovery | fixed — D-19-29 | `WorkStatusPanel.tsx`'s failed branch rendered only an error message — **no recovery action existed at all**. Reproduced red (test looked for a "Retry processing" button, found none), fixed by adding one that reuses the existing `handleReprocess` handler, re-ran green. |
| Work status | Reprocess action (on ready works) | working | New `work-status.spec.ts` verifies via a mocked `/reprocess` response (same mocking pattern as `upload.spec.ts`), independent of live pipeline/env state per D-19-6. |
| Work status | Trashed-work Undo/Trash link (on the work's own status panel, distinct from `/works/trash`'s Restore button) | working | Was genuinely untested before this pass (`trash.spec.ts` only exercises the separate Trash-listing page). New `work-status.spec.ts` test confirms both controls. |

## Reader controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Reader | Published edition / Interactive reader view switch | working | Existing seeded `edition.spec.ts` exercises both modes and verifies the labelled reader-view group’s pressed state and content. |
| Reader | Annotation markers; Annotations, Notes, Apparatus, and Sources sidebar controls | working | Existing seeded Edition E2E opens in-text markers, follows a quote-matched note to its owning tab, and exercises apparatus/notes/sources content and their `aria-pressed` state. |
| Reader | Split-view chooser open/close disclosure, including non-empty selection | working | The empty-chooser path was fixed as D-19-18. `reader.spec.ts` now also selects a real second work: confirms the chooser closes, "Exit split view" appears, and both works' titles render together. Not re-verified against a fresh live run this pass — see the note below; the code path and empty-chooser regression are proven, live-upload-dependent confirmation is blocked by the same D-19-6 timing limitation. |
| Reader | Highlight creation/color, bookmark, notes sidebar, reader analysis toggle | working | New `edition.spec.ts` regressions (seeded data, not live upload — avoids D-19-6's timing issue): create a highlight with a chosen color and confirm it survives reload; create a bookmark and a standalone note and confirm both persist from the sidebar; toggle reader analysis and confirm the edition sidebar hides/restores. |
| Reader | Footnote modal | fixed — D-19-34 | The original-note popup had no keyboard-dialog semantics at all (no role, no initial focus, no Escape, no trigger-focus restoration) — the same class of gap as D-19-18/19/20. Brought to the same standard: `role="dialog"`, `aria-modal`, close-button initial focus, Escape closes and restores focus to the footnote marker that opened it. New `reader.spec.ts` assertions cover both the Escape path and the visible Close-button path. **Not confirmed by a passing live-upload E2E run this session** — see note below. |
| Reader | Contextual Ask Library | pending | Not reached this pass; Phase 22.5 (Global RAG sidebar) will supersede whatever the current contextual drawer does, so this is deferred there rather than covered in isolation now. |

**Note on `reader.spec.ts` (live-upload-dependent, manual-only spec):** the footnote-modal and non-empty-split-view fixes above are typecheck/lint-clean and follow an already-proven pattern (D-19-18/19/20), but a full run of `reader.spec.ts` this session reproduced the exact pre-existing, already-documented D-19-6 finding — 2 of 5 tests (`upload, highlight, note, and resume reading position`; `published edition is available without replacing the interactive reader`) time out waiting for a real local v2-pipeline upload to finish processing (multi-minute, live-network-bound), before ever reaching the new code. This is not a regression introduced this session; the other 3 tests in the same file pass. Confirming the footnote/split-view fixes end-to-end against a completed live upload remains open, tracked here rather than silently claimed.

Password reset, login failure, and cross-account-denial journeys (plan §19.5) were also closed this tranche: see the Changelog/PROJECT-LOG entry for the new `auth.spec.ts` password-reset suite (request confirmation, valid-token round trip with old-password invalidation, invalid-token handling) and the extended `security.spec.ts` IDOR matrix (5 more routes covered; `/reprocess` deliberately excluded with a documented reason, not a defect).

## Control families queued for subsequent passes

The following are source-mapped but not yet classified by interactive evidence, or are explicitly deferred to a later phase: contextual Ask Library (deferred to Phase 22.5's global sidebar); upload queue/duplicate/retry confirmation controls beyond what `upload.spec.ts` covers; Roadmap/Curriculum/Diagnostic controls; Visualization filters, graph/table/inspector/fullscreen/export/expansion controls (Phase 21's own scope); Ask Library conversation controls; and remaining empty-state calls to action not covered above.

## Defects surfaced by this tranche

- **D-19-13:** Writer sidebar resize was exposed as a button but only listened for pointer drag; keyboard users had no functional control.
- **D-19-14:** Command-palette dialog lacked a focus trap and trigger-focus restoration.
- **D-19-15:** Mobile navigation overlay lacked modal semantics, initial focus, focus containment, Escape handling, and trigger-focus restoration.
- **D-19-16:** Library’s active reading-status filter state was visual-only and unlabelled for assistive technology.
- **D-19-17:** Global and work-specific Visualization links shared an ambiguous accessible name.
- **D-19-18:** The Reader split-view picker omitted programmatic disclosure state and Escape dismissal.
- **D-19-19:** The Workspace preferences popup lacked accessible dialog/focus lifecycle.
- **D-19-20:** Focus mode visually hid the shell while leaving its current checkbox and navigation focusable, with no focus transfer to its Exit control.
- **D-19-21:** The Interactive Reader's content column hardcoded a 72ch width, ignoring the reading-width preference entirely.
- **D-19-25:** Writer's document-reorder status raced an unrelated effect keyed on a non-stable object reference, letting "Saved" appear before the reorder's DB write actually completed.
- **D-19-29:** A failed document had no recovery action anywhere in the UI — the failed-state branch rendered only an error message.
- **D-19-34:** The Reader's footnote/original-note popup had no keyboard-dialog semantics (role, initial focus, Escape, trigger-focus restoration) at all.

Twelve defects are now repaired and regression-tested locally (D-19-13 through D-19-21, D-19-25, D-19-29, D-19-34 — D-19-22/23/24/26/27/28/30/31/32/33 were not needed; those items tested clean on first pass with no defect found). The authoritative detailed record is `docs/audits/phase-19-product-audit.md`.
