# Phase 19 Interaction Inventory

Per `palimnote_phases_19_23_plan_revised.md` §19.5–19.6. This is a living, evidence-backed inventory: a control is marked **working** only after its visible interaction has been exercised in the local Playwright harness or an existing equivalent test; **fixed** means this audit first reproduced a defect, then added a regression; **pending** means it is deliberately not yet classified and must not be read as a pass.

The in-app browser runtime is unavailable in this agent session, so the interaction evidence below comes from the repository's real local Chromium/Playwright harness against the running web app and Postgres. Manual VoiceOver remains out of scope and open.

## Shared shell and modal controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Desktop shell | Primary nav, product-home link, visible feature-gated nav links | working | Existing `workspace-shell.spec.ts` authenticates and navigates the shell; feature-gate content assertion is covered by `hardening.spec.ts` (Writer) and `rag.spec.ts` (Ask Library). |
| Desktop shell | Search icon and `Ctrl/Cmd+K` command palette | fixed — D-19-14 | Pre-fix Shift+Tab escaped the dialog and Escape left focus outside it. The command palette now traps Tab/Shift+Tab and restores its trigger; `workspace-shell.spec.ts` exercises both paths. |
| Desktop shell | Light/dark quick switch and persisted theme select | working | `workspace-shell.spec.ts` and `hardening.spec.ts` exercise theme change and HTML token update. |
| Desktop shell | Preferences menu: text size, reading width, script display, focus-mode checkbox | pending | Controls are source-mapped and have an owned persistence API, but their complete interaction matrix is scheduled for the next inventory pass. |
| Desktop shell | Desktop logout | pending | Source-mapped form action; needs an explicit logout→protected-route journey assertion. |
| Mobile shell | Open/close navigation, nav links, mobile logout | fixed — D-19-15 | Pre-fix overlay was a non-modal `aside` with no focus placement, trap, Escape, or restoration. It is now an accessible modal dialog; narrow-viewport Playwright test verifies initial focus, Shift+Tab containment, Escape, and trigger restoration. |
| Focus mode | Exit-focus-mode control | pending | Source-mapped; must be exercised with focus mode enabled. |

## Writer controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Writer projects | New project; project cards; archived-project show/hide; restore | working | `writer.spec.ts` creates a project, archives it with confirmation, shows archived projects, and restores it. |
| Writer editor | Project title; document title; draft autosave; active document; new document; reorder | working / partial | Autosave and draft persistence are exercised in `writer.spec.ts`; multi-document order controls remain pending a distinct multi-document probe. |
| Writer editor | Citation import, insert, revision restore, DOCX/PDF export | working | `writer.spec.ts` imports BibTeX, inserts MLA text, exposes revisions, and validates actual DOCX/PDF downloads. |
| Writer editor | Library-source Cite/Read controls | pending | Source-mapped; needs a seeded Library source in Writer-specific coverage. |
| Writer editor | Desktop Library-source sidebar resize | fixed — D-19-13 | Pre-fix control was a pointer-only `<button>`: keyboard activation had no effect. It is now a `separator` with value semantics and Arrow/Home/End support; the regression verifies `aria-valuenow` and rendered width. |
| Writer editor | Archive confirmation | working | Existing Writer E2E accepts the confirmation and verifies the archive/restore result. |

## Control families queued for subsequent passes

The following are source-mapped but not yet classified by interactive evidence. They remain required Phase 19 work: landing/auth forms; upload queue, duplicate, retry, and confirmation controls; work-status/reprocess/trash controls; Library search/focus/filter/sort/pagination controls; Reader source/processed toggles, selection actions, notes, highlights, bookmarks, annotation filters, footnotes, split view, and contextual RAG sheet; Roadmap/Curriculum/Diagnostic controls; Visualization filters, graph/table/inspector/fullscreen/export/expansion controls; Ask Library conversation controls; and all empty-state calls to action.

## Defects surfaced by this tranche

- **D-19-13:** Writer sidebar resize was exposed as a button but only listened for pointer drag; keyboard users had no functional control.
- **D-19-14:** Command-palette dialog lacked a focus trap and trigger-focus restoration.
- **D-19-15:** Mobile navigation overlay lacked modal semantics, initial focus, focus containment, Escape handling, and trigger-focus restoration.

All three are repaired and regression-tested locally. The authoritative detailed record is `docs/audits/phase-19-product-audit.md`.
