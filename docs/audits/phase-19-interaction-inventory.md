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
| Desktop shell | Preferences text size, reading width, script display, and focus-mode checkbox | pending | Source-mapped and backed by the same persistence API, but each user-visible effect needs a distinct assertion in a later inventory pass. |
| Desktop shell | Desktop logout | pending | Source-mapped form action; needs an explicit logout→protected-route journey assertion. |
| Mobile shell | Open/close navigation, nav links, mobile logout | fixed — D-19-15 | Pre-fix overlay was a non-modal `aside` with no focus placement, trap, Escape, or restoration. It is now an accessible modal dialog; narrow-viewport Playwright test verifies initial focus, Shift+Tab containment, Escape, and trigger restoration. |
| Focus mode | Enable/exit focus mode | fixed — D-19-20 | Pre-fix, enabling Focus mode left keyboard focus on the now-visually-hidden preferences checkbox, and Tab could still reach the hidden shell. The real Chromium regression proves entry focus moves to Exit focus mode, the hidden shell is inert, and exit restores Workspace preferences focus. |

## Writer controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Writer projects | New project; project cards; archived-project show/hide; restore | working | `writer.spec.ts` creates a project, archives it with confirmation, shows archived projects, and restores it. |
| Writer editor | Project title; document title; draft autosave; active document; new document; reorder | working / partial | Autosave and draft persistence are exercised in `writer.spec.ts`; multi-document order controls remain pending a distinct multi-document probe. |
| Writer editor | Citation import, insert, revision restore, DOCX/PDF export | working | `writer.spec.ts` imports BibTeX, inserts MLA text, exposes revisions, and validates actual DOCX/PDF downloads. |
| Writer editor | Library-source Cite/Read controls | pending | Source-mapped; needs a seeded Library source in Writer-specific coverage. |
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
| Library | Focused-work title, recommended-for chips, external resource links, and empty-state upload CTA | pending | Rendered/partially asserted, but their navigation targets have not yet been clicked through in this literal inventory. |

## Work-status and trash controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Ready work | Roadmap, Concept check, Curriculum, work Visualization, and Open reader action links | working / fixed | New CI-safe `trash.spec.ts` journey clicks each route from a ready work and returns. The work Visualization action is fixed as D-19-17, now exposed as “Visualization for [work title]” so it does not collide with the global link. |
| Ready work | Move-to-trash confirmation and Cancel | working | New journey opens the inline confirmation, verifies the irreversible-action message, and cancels it without mutating the work. |
| Trash | Move, restore, permanent-delete confirmation and Delete now | working | Existing `trash.spec.ts` covers normal-list removal, route protection, 30-day messaging, restore, and actual database deletion; full suite is 4/4 after the new journey. |
| Work status | Metadata-confirm form, reprocess action, processing progress, failed-state recovery, and trashed-work Undo/Trash link | pending | Source-mapped but needs distinct fixtures that can safely exercise each state without depending on the live analysis pipeline. |

## Reader controls

| Surface | Control family | Classification | Evidence / disposition |
|---|---|---|---|
| Reader | Published edition / Interactive reader view switch | working | Existing seeded `edition.spec.ts` exercises both modes and verifies the labelled reader-view group’s pressed state and content. |
| Reader | Annotation markers; Annotations, Notes, Apparatus, and Sources sidebar controls | working | Existing seeded Edition E2E opens in-text markers, follows a quote-matched note to its owning tab, and exercises apparatus/notes/sources content and their `aria-pressed` state. |
| Reader | Split-view chooser open/close disclosure | fixed — D-19-18 | Pre-fix trigger had no state/relationship or Escape behavior. It now exposes `aria-expanded`/`aria-controls`, a labelled chooser group, and Escape focus restoration; the regression proves the empty chooser path. Selecting a second work remains pending. |
| Reader | Highlight creation/color, bookmark, notes sidebar, reader analysis toggle, contextual Ask Library, footnote modal, and non-empty split selection | pending | Source-mapped; the remaining required interactions need purpose-built seeded fixtures or live-pipeline-independent APIs. |

## Control families queued for subsequent passes

The following are source-mapped but not yet classified by interactive evidence. They remain required Phase 19 work: landing/auth forms; upload queue, duplicate, retry, and confirmation controls; remaining work-status/reprocess states; remaining Library navigation/CTA links; remaining Reader selection/actions/notes/highlights/bookmarks/filters/footnotes/non-empty split/RAG controls; Roadmap/Curriculum/Diagnostic controls; Visualization filters, graph/table/inspector/fullscreen/export/expansion controls; Ask Library conversation controls; and all other empty-state calls to action.

## Defects surfaced by this tranche

- **D-19-13:** Writer sidebar resize was exposed as a button but only listened for pointer drag; keyboard users had no functional control.
- **D-19-14:** Command-palette dialog lacked a focus trap and trigger-focus restoration.
- **D-19-15:** Mobile navigation overlay lacked modal semantics, initial focus, focus containment, Escape handling, and trigger-focus restoration.
- **D-19-16:** Library’s active reading-status filter state was visual-only and unlabelled for assistive technology.
- **D-19-17:** Global and work-specific Visualization links shared an ambiguous accessible name.
- **D-19-18:** The Reader split-view picker omitted programmatic disclosure state and Escape dismissal.
- **D-19-19:** The Workspace preferences popup lacked accessible dialog/focus lifecycle.
- **D-19-20:** Focus mode visually hid the shell while leaving its current checkbox and navigation focusable, with no focus transfer to its Exit control.

All eight are repaired and regression-tested locally. The authoritative detailed record is `docs/audits/phase-19-product-audit.md`.
