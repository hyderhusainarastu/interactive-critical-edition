# Stage 6 Write-Integration Spec — Palimnote Signed-In Redesign

Binding implementation spec for Stage 6 (charter §15 "Stage 6 — Write integration"). Every decision below
is final for this stage unless explicitly marked as a flagged follow-up outside this lane's file ownership.
Nothing is left "TBD" within scope.

Sources read before writing this spec: charter §5 "Writer" and "Ask Library"/"Account" capability-
preservation bullets, charter §6 "Write" target-IA bullets, charter §15 Stage 6 implement/gate text, charter
§16 journey 7 and the risk-based-matrix rules, charter §17 accessibility requirements
(`docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md`); `docs/design/redesign-shell-spec.md` (Stage 1,
already implemented — primitives, `ContextBar`/`ContextBarProvider`, immersive-route classification, the
`SecondaryPanelProvider` singleton); direct reads of every current Writer file: both `(app)/writer` pages,
`WriterEditor.tsx`, `WriterProjectsView.tsx`, all 11 `api/writer/**` routes' request/response shapes,
`packages/db/src/schema.ts`'s `writer_project`/`writer_document`/`writer_document_revision` tables, every
Stage 1 shell primitive (`useFocusTrap`, `useDialogEscape`, `useFocusRestoration`, `useSecondaryPanel`,
`EmptyState`, `LiveRegion`, `ContextBar.tsx`, `ContextBarProvider.tsx`, `ReadManagementSheet.tsx` as the
existing mobile-sheet pattern precedent), `ToastProvider.tsx`, and the three existing Writer E2E specs
(`writer.spec.ts`, `writer-evidence.spec.ts`, `writer-export.spec.ts`) for their exact current assertions.

No new npm dependency. No database migration. No API route is created or modified by this stage's own file
ownership (`apps/web/src/app/(app)/writer/**`, `apps/web/src/components/writer/**`, new files under those,
new E2E spec files) — every decision below either works entirely client-side within that ownership or is
explicitly flagged as a small, precisely-specified follow-up for a coordinating pass with broader file access.

---

## 1. Current state, in one paragraph

`WriterEditor.tsx` (330 lines) already implements everything charter §5 "Writer" requires functionally:
projects/documents, 750ms-debounced autosave with a `role="status"` indicator, document reorder/archive,
revision list + restore, a resizable Library-sources sidebar with inline citation import (DOI/ISBN/title/
BibTeX/RIS), a flag-gated Research-evidence sub-panel (link a research project, filter by work/nature, insert
a claim's excerpt as a real ProseMirror blockquote), a citations panel with MLA in-draft insertion and a
4-format export link, and per-document DOCX/PDF export. What it does **not** yet do is what charter §6
"Write" asks for structurally: both side "panels" are two independent, always-two-simultaneous, non-
collapsible `<aside>` elements that stack full-width on top of each other (not the draft) below `lg`
(1024px) — the opposite of "ONE side panel on narrow widths" — and the page renders its own full local
`<header>` (project title, save status, Archive, DOCX/PDF) stacked directly beneath the already-existing
`ContextBar` (56px desktop / 52px mobile), which charter's "minimize global chrome in ... Writer" and
"central draft" language argues against doubling up. This spec fixes both, plus the autosave/conflict/error-
state and export-surfacing decisions charter's own Stage 6 bullet list calls out by name.

---

## 2. Layout: focused editor, two collapsible panels, one open under 1024px

### 2.1 Breakpoint

Reuses the exact `1024px` (`lg:`) threshold already used throughout `WriterEditor.tsx` today and by the
Stage 1 shell rail — no new breakpoint invented.

| Viewport | Panel behavior |
|---|---|
| `>=1024px` | Both panels are independent, inline, resizable-or-fixed-width flex siblings of the central draft — same physical arrangement as today. Each has its own collapse toggle; **both default open** (preserves today's default exactly, so the existing 1280px-viewport resizer E2E test in §8 keeps working against an already-open sidebar without needing a new "open it first" step). Collapsing one does **not** affect the other — a user may have both open, one open, or neither. |
| `<1024px` | Neither panel renders inline. A single-open **bottom sheet**, built on the exact `ReadManagementSheet.tsx` pattern (role="dialog", `aria-modal`, `useFocusTrap`+`useDialogEscape`+`useFocusRestoration`, `app-panel-enter` slide-up, safe-area padding), presents whichever panel is open. Opening one closes the other — enforced by routing through the shell's existing app-wide `SecondaryPanelProvider` singleton (`useSecondaryPanel("writer-sources")` / `useSecondaryPanel("writer-citations")`), the same one `ReadManagementSheet`/preferences/profile/RAG already share. This is a deliberate reuse, not a new mechanism: it also means opening a Writer panel on mobile correctly closes the RAG sidebar or preferences menu if either was left open, which is the charter's global "never more than one secondary drawer or bottom sheet on mobile" rule (§6), applied for free rather than re-implemented narrowly for Writer alone. **Both panels default closed** on first entry to a narrow viewport (the draft is the primary content; nothing forces a sheet open unasked). |

### 2.2 Why viewport-dependent state, not one state model

The charter requires *both* "both collapsible" (wide) *and* "at most one open" (narrow) — these are
genuinely different interaction models, not the same toggle rendered two ways. Reusing the global
`useSecondaryPanel` singleton unconditionally would make opening Sources on a 1280px screen also force-close
Citations, which regresses today's default (both visible) and breaks the existing resizer test's assumption
that the Library sidebar is already visible at that viewport with no "open" step. The decision: call **both**
state sources unconditionally (no conditional hook calls — rules-of-hooks safe) and select which one drives
rendering based on a `useIsNarrowViewport()` read:

```ts
// apps/web/src/components/writer/panels/useIsNarrowViewport.ts (new)
// matchMedia("(max-width: 1023.98px)") listener. SSR/first-paint default is
// `false` (wide) — same lazy-correct-after-mount technique WorkspaceRail.tsx
// already uses for its own localStorage-backed collapse state (redesign-
// shell-spec.md §2.5), so this is a reused pattern, not a new one. Defaulting
// wide means the SSR-rendered markup matches today's shipped output (both
// panels open, non-sheet) until the client corrects itself pre-paint — never
// a visible content flash, and never a hydration mismatch since the server
// has no viewport to guess wrong.
```

```ts
// apps/web/src/components/writer/panels/panelState.ts (new) — pure, unit-tested
export type WriterPanelId = "sources" | "citations";

/** Given which panel a toggle click targets, whether the viewport is narrow,
 * and the current independent wide-mode booleans, returns the next
 * wide-mode state. Narrow mode does not call this — it goes straight through
 * `useSecondaryPanel`, which already has its own tested reducer
 * (`secondaryPanelReducer`, Stage 1). This function exists so the *wide*
 * toggle-independently rule has one pure, directly-testable place to live,
 * matching the codebase's existing convention of testing interaction logic
 * as plain functions (see `useFocusTrap.test.ts`'s own comment on why). */
export function toggleWidePanel(
  current: { sources: boolean; citations: boolean },
  panel: WriterPanelId,
): { sources: boolean; citations: boolean } {
  return { ...current, [panel]: !current[panel] };
}
```

`WriterEditor.tsx` composes these: `isNarrow ? sourcesSecondaryPanel.isOpen : wideState.sources` decides what
actually renders, and the toggle button's `onClick` branches the same way. This is the one piece of new
interaction logic Stage 6 owns; everything else is straight reuse of Stage 1 primitives.

### 2.3 Persistence

Wide-mode open/closed state persists in `localStorage` (`palimnote:writer-panels`, JSON
`{sources: boolean, citations: boolean}`), read synchronously in the initializer exactly like
`GlobalRagSidebar.tsx`'s own stored-width read and `WorkspaceRail.tsx`'s stored-collapsed read
(redesign-shell-spec.md §2.5's own precedent: viewport-chrome density is not a `WorkspacePreferences`
DB field). Narrow-mode open/closed state is **not** persisted — it always starts closed on a fresh narrow
mount, matching §2.1's "both default closed" decision and avoiding a sheet popping open unasked on load.

### 2.4 Panel renaming (deliberate, charter-driven)

The current left `<aside aria-label="Library source sidebar">` already contains both the Library-sources
list **and** the flag-gated Research-evidence sub-section (`aria-label="Research evidence"`) — i.e. it is
*already* the charter's "Sources/Evidence panel" in content, just not in name or collapsibility. Renamed to
match charter §6's own vocabulary:

| Current accessible name | New accessible name | Rationale |
|---|---|---|
| `"Library source sidebar"` (aside) | `"Sources and evidence panel"` | Matches charter "Collapsible Sources/Evidence panel"; the name now honestly describes both sub-sections it has always contained. |
| `"Resize Library source sidebar"` (separator) | `"Resize Sources and evidence panel"` | Kept in lockstep with the aside's own rename — same element, same resize mechanism (§2.5), unchanged behavior. |
| `"Citations and revision recovery"` (aside) | `"Citations and revision history panel"` | Matches charter "Collapsible Citations/History panel" almost verbatim; "history" replaces "recovery" for the same literal-term match, content unchanged. |

No other accessible name changes. `"Research evidence"` (the evidence sub-section heading), `"Draft"`,
`"Active document"`, `"Citation import format"`, `"Citation metadata"`, `"Citation export format"`, and every
button/link name (`"Insert"`, `"Cite"`, `"Read"`, `"Add"`, `"Export"`, `"Restore"`, `"New document"`,
`"Move earlier"`/`"Move later"`, `"DOCX"`/`"PDF"`, `"New project"`, `"Archive"`, `"Show archived projects"`,
`"Restore project"`) are all preserved verbatim — every one of these is asserted by name in the existing
E2E specs (§8), and none of their underlying behavior changes in this stage, so there is no reason to rename
them.

### 2.5 Resize, widths, and the freed-space rule

- Left panel keeps its existing keyboard- and pointer-resizable width (220–460px, `SIDEBAR_WIDTH_STEP` 20px,
  `Home`/`End` to min/max) — unchanged mechanism, just renamed per §2.4.
- Right panel stays fixed-width (`lg:w-80`, 320px, not resizable) — unchanged; charter does not ask for
  right-panel resizability, only collapsibility, and inventing a second resizer for a panel that's never
  needed one would be scope the charter didn't ask for.
- Central draft's `max-w-3xl` wrapper widens to `max-w-4xl` **only** when both panels are collapsed at
  `>=1024px` (a `data-panels-collapsed` attribute driven by the same two booleans, styled with a plain
  Tailwind conditional class — no new CSS token, no `globals.css` edit). This is the charter's "central
  draft" intent made concrete: collapsing chrome actually gives the draft more room, not just hides
  metadata while the draft stays pinned to the same width.

### 2.6 Toggle buttons

Two `44px+`-target buttons render in the central column's existing document toolbar row (next to the
document `<select>`/"New document"/"Move earlier"/"Move later" controls already there), each
`aria-expanded={open}` and `aria-controls={panelId}`, labelled `"Sources and evidence"` /
`"Citations and history"` (matching the panel names in §2.4 minus "panel", i.e. the button names the
destination the same way `ContextBar`'s own icon buttons name theirs — "Workspace preferences" trigger,
"Workspace preferences" dialog — a consistent trigger/target naming convention already established in this
codebase). On narrow viewports these are the *only* way to reach either panel (no persistent inline chrome
competes with the draft); on wide viewports they're an explicit collapse/expand control alongside the
always-available panels themselves.

---

## 3. Context bar integration — what Stage 6 can and cannot do here

`ContextBar.tsx` (owned by the shell lane, off-limits to this lane) already renders `{title ?? fallbackTitle}`
from `useContextBarState()` — confirmed by direct read. It does **not** render `actions` even though
`ContextBarProvider.tsx`'s `ContextBarState` type already carries an `actions: ReactNode | null` field —
that field is defined but not yet wired into any JSX in `ContextBar.tsx`. This matters for Stage 6 because
charter's "minimize global chrome ... in Writer" argues for not stacking `WriterEditor`'s own local header
directly under the already-immersive (`isImmersiveRoute` already matches `/writer/[projectId]`, confirmed by
direct read of `immersive.ts` — no change needed there) `ContextBar`.

**Decision, scoped to what this lane can actually do:**

- `WriterEditor.tsx` calls `useRegisterContextBar({ title: <ProjectTitleField /> })` (the seam Stage 1
  shipped for exactly this purpose, unused by any page until now) so the project title lives in the one
  place a title is already rendered, instead of a second title appearing directly beneath it. The project-
  title `<input>` (rename-on-blur, unchanged logic from today) becomes the registered title node itself —
  `ContextBar`'s title slot accepts any `ReactNode`, and an `<input>` is valid phrasing content inside the
  `<span>` it's rendered in.
- Save status, Archive, and export controls **cannot** move into `ContextBar` in this stage, because the
  `actions` slot that would host them is defined but not rendered by a file this lane cannot edit. They stay
  in `WriterEditor.tsx`'s own chrome, but as a single **slim** action row (not a second full header) directly
  below the registered title's context, carrying only: `SaveStatus` (§4), `Archive`, and nothing else — DOCX/
  PDF export moves to the central document toolbar (§5.2) since export targets the *active document*, not
  the project, and doesn't belong beside project-level chrome.
- **Flagged follow-up (outside this lane, not fabricated here):** once a coordinating pass adds `actions`
  rendering to `ContextBar.tsx`, `WriterEditor.tsx`'s slim action row can register into that slot too,
  removing the last remaining local chrome row entirely. This spec intentionally does not pretend that
  rendering path exists yet.

---

## 4. Autosave and revision status: saved / saving / failed+retry / conflict

### 4.1 Preserve the existing contract exactly where it's already tested

`page.getByRole("status")).toHaveText("Saved", ...)` is asserted today (`writer.spec.ts:36`, `:107`). The new
`SaveStatus` component keeps the exact three base strings unchanged — `"Saved"`, `"Saving…"`, `"Editing"` is
not itself shown as status text today (it's an internal state name, not rendered) and stays that way — so
every existing settled-state assertion keeps passing unmodified.

### 4.2 What's new: honest failure with retry

Today, `"Save failed"` is a dead end — no retry affordance, the user's only recourse is editing again (which
re-triggers the debounce) or reloading and losing anything since the last successful save. New:

- The PATCH call is extracted into one `saveNow()` function (currently inlined in the debounce `useEffect`)
  so both the debounce timer *and* an explicit control can call the identical save path — no duplicated fetch
  logic.
- `"Save failed"` renders with an adjacent `"Retry"` button (`app-control`, 44px target) that calls
  `saveNow()` again with the draft's **current** content (not a stale snapshot from the moment of failure) —
  correct because the user may have kept typing while the failed save's error was showing.
- A `beforeunload` guard fires only while status is `"Editing"`, `"Saving…"`, or `"Save failed"` (i.e. there
  is real unsaved-or-unconfirmed content) — not while `"Saved"` or during a conflict banner (§4.3), where the
  guard would be redundant or misleading. This directly serves "honest failure" — the browser's own native
  "leave site?" prompt is the most honest signal available without inventing a custom modal for it.

### 4.3 Conflict: scoped to what's actually detectable without an API change

The `writer_document` table already has `updated_at` (confirmed in `packages/db/src/schema.ts`), but
`saveWriterDocument`/the PATCH route (both in `apps/web/src/lib/writerData.ts` and
`apps/web/src/app/api/writer/**`, **outside this lane's file ownership**) perform no optimistic-concurrency
check today — every save is unconditional last-write-wins, and a genuine same-document double-save race
(e.g. two browser tabs autosaving within the same 750ms window) can even throw a `writer_document_revision`
unique-constraint violation server-side, which today surfaces only as an undifferentiated `"Save failed"`.

Building a real cross-device conflict contract (client sends `expectedUpdatedAt`, server 409s with the
current content on mismatch) is a small, well-specified change — but it touches
`apps/web/src/lib/writerData.ts` and the PATCH route, both outside `apps/web/src/app/(app)/writer/**` /
`apps/web/src/components/writer/**`. **Decision: specify the contract now so a coordinating pass can add it
as a two-line diff, but do not depend on it existing for Stage 6's own deliverable.**

```
// Flagged follow-up, NOT implemented by this lane:
// PATCH .../documents/:id body gains an optional `expectedUpdatedAt: string`.
// saveWriterDocument compares it against the row's current `updated_at`
// before writing; on mismatch, respond 409 with `{ conflict: true, latest: <document> }`
// instead of writing. Absent the field (older client, or this field simply
// not sent), behavior is byte-for-byte identical to today — fully backward compatible.
```

What Stage 6 **does** ship, entirely within its own file ownership, using only a native Web API (no new
dependency): a same-browser, cross-tab conflict signal via `BroadcastChannel`.

- `apps/web/src/components/writer/useDocumentBroadcast.ts` (new): on every successful `saveNow()`, posts
  `{ documentId, updatedAt }` on a `BroadcastChannel("palimnote-writer")`. Every mounted `WriterEditor`
  instance (any tab, same browser, same origin) listens; if a received message names the **currently open**
  document and the receiving tab has unsaved local edits (`status !== "Saved"`), it shows a
  `"Edited in another tab"` status variant instead of continuing the normal Saving/Saved cycle.
- That variant offers two actions: `"Keep editing here"` (dismiss the banner; behavior reverts to plain
  last-write-wins, exactly like today — no capability regresses) and `"Reload this document"` (discards local
  edits and re-fetches the project workspace via a full `router.refresh()` plus remounting the editor keyed
  on the document id, picking up the other tab's saved content).
- **Explicit limitation, stated honestly rather than silently solved:** this detects only same-browser,
  multi-tab conflicts. Two different browsers/devices editing the same document is not detectable without
  the server-side contract above, and Stage 6 does not claim otherwise anywhere in its UI copy.

### 4.4 `SaveStatus` component states (exhaustive)

| State | Text (unchanged from today unless noted) | New affordance |
|---|---|---|
| Idle/settled | `"Saved"` | — |
| In flight | `"Saving…"` | — |
| Failed | `"Save failed"` | `"Retry"` button (§4.2) |
| Cross-tab signal | `"Edited in another tab"` *(new string)* | `"Keep editing here"` / `"Reload this document"` (§4.3) |

Every transition is additionally announced through the existing `LiveRegion` primitive (`role="status"`
already on the visible element itself satisfies this without a second hidden announcer — `LiveRegion` is
used instead only for the one moment `SaveStatus`'s own `role="status"` node isn't the most natural
announcement point: the cross-tab conflict, since that event originates from a **different** tab and the
receiving tab's status node changing color/text is itself already inside a `role="status"` container, so no
additional `LiveRegion` mount is actually needed — noted here so a later reviewer doesn't wonder why one
wasn't added.).

---

## 5. Insertion flows and export — as currently reachable

### 5.1 Insertion: unchanged mechanics, relocated chrome only

Per the task's explicit scope boundary, insertion entry points *from* Reader/Knowledge Map (cross-surface)
and Research-evidence deep links needing Stage 5's not-yet-built views are **out of scope**, deferred to
integration. What Stage 6 does: keep every existing handler (`importCitation`, `insertEvidence`,
`insertCitation`, `linkResearchProject`, `unlinkResearchProject`) byte-for-byte unchanged, and move their
existing JSX unchanged into the newly-collapsible/renamed panels (§2.4) — a pure container change, zero
behavior change. The "Cite"/"Read" links per Library source, the DOI/ISBN/title/BibTeX/RIS import form, the
work/nature evidence filters, and the claim "Insert" buttons all render exactly as they do today, just inside
a panel that can now collapse and (on narrow viewports) present as a sheet instead of a stacked block.

### 5.2 Export: every currently supported document/citation export, enumerated from code

| Export | Source route | Scope | Formats | New placement |
|---|---|---|---|---|
| Document export | `GET /api/writer/projects/:id/export?documentId=&format=` (`export/route.ts`) | The **active document** only (`documentId` required, validated `z.string().uuid()`) | `docx`, `pdf` (`z.enum(["docx","pdf"])`) | Moves from the old project-level header into the central document toolbar (§2.6), next to the document switcher — document-scoped chrome next to document-scoped controls, not beside project-level Archive. |
| Citation-list export | `GET /api/writer/projects/:id/citations/export?format=` (`citations/export/route.ts`) | The **whole project's** citation list | `bibtex`, `ris`, `apa`, `chicago` (`z.enum([...])`) — note MLA is the in-draft *insertion* style (`mlaParenthetical`/`mlaWorksCited`), not one of the four export formats; this is a pre-existing, correct distinction, not something to reconcile | Unchanged placement — stays in the (renamed) Citations and revision history panel, exactly as today. |

No export capability is added, removed, or renamed — the enumeration above is what already exists in code,
confirmed by reading both route handlers' zod schemas directly, and this table is the "export surfacing"
decision the task asked for: two document-format links plus a four-format citation-list link, at the two
placements above.

---

## 6. `window.alert`/`confirm`/`prompt` — a scoped, explicit decision

Charter §6 mandates replacing `window.prompt`/`window.alert` with accessible dialogs **for Research**
specifically (that exact sentence appears only under the "### Research" heading, not "### Write"). Stage 6
makes an explicit, scoped decision rather than silently importing Research's rule or silently ignoring the
question:

- **`window.alert(...)` calls convert to `toast(message, "error")`.** `ToastProvider`/`useToast()`
  (`apps/web/src/components/app/ToastProvider.tsx`) is already mounted app-wide (confirmed: `AppShell.tsx`
  wraps everything in `ToastProvider` → `WorkspacePreferencesProvider` → `AppShellRoot`) and already used
  elsewhere in the shell for exactly this kind of non-blocking error report (`AppShellRoot.tsx`'s reader-
  level-save failure). Using it from `WriterEditor.tsx`/`WriterProjectsView.tsx` is a pure import of an
  existing, already-shared hook — no file outside this lane's ownership is modified. Every current
  `window.alert(error.message ?? "Could not ...")` call (project create, document create, project rename
  revert, project archive, citation import, revision restore, research-project link/unlink) converts
  one-for-one to the equivalent `toast(..., "error")` call. This directly satisfies "explain what happened"
  (the message is preserved verbatim) without inventing new copy.
- **`window.prompt(...)` and `window.confirm(...)` are kept as native dialogs, unchanged.** Rationale: (1)
  charter's replacement mandate is textually scoped to Research, not Write; (2) native prompt/confirm are
  themselves keyboard- and screen-reader-operable (OS-level modal, not a custom-built one WCAG 2.2 AA would
  flag) — the charter's actual complaint about them (implicit, inferred from the Research section) is that
  they're unstyled/off-brand and block the JS thread, not that they're inaccessible; (3) replacing them would
  require a new accessible-dialog-with-text-input primitive this lane doesn't own the seam for (`ContextBar`/
  shell dialogs are the natural home for a reusable prompt-replacement primitive, and that's shell-lane
  territory); (4) the existing E2E specs assert against `page.once("dialog", (dialog) => dialog.accept(...))`
  for every create/archive/restore/unlink flow — keeping native dialogs here means **zero** of those
  assertions need to change, which is the "don't weaken tests, don't rewrite what doesn't need it" reading of
  the program rules. This is a considered "no" to scope creep, not an oversight — recorded here so a future
  reviewer doesn't reintroduce the question without seeing this reasoning.

---

## 7. Empty, loading, and error states

| Surface | Today | Stage 6 |
|---|---|---|
| Sources and evidence panel, zero Library sources | Empty `<ul>`, no message | Reuse `EmptyState` (imported, not modified) above the "Add citation" form: heading `"No Library sources yet"`, body `"Connect a source from a work's Reader, or add a citation below."` |
| Research evidence, no linked project, no available projects | Existing `app-empty` inline paragraph `"No research projects yet. Create one in the Research workspace first."` | Unchanged — already explains what happened and what to do; not worth replacing a correct existing message with a heavier component for its own sake. |
| Research evidence claims, filtered to zero | Existing inline `<li className="app-empty">"No claims match the current filters."` | Unchanged — same reasoning as above. |
| Citations panel, zero citations | No explicit empty message today (empty `<ul>`) | Add one inline `app-empty` line, matching the existing house style used elsewhere in this same file rather than introducing `EmptyState` for a single list row: `"No citations yet. Import one from the panel on the left, or from a Library source."` |
| Revision list, zero revisions (only possible before the first autosave completes) | No explicit message | Add the same inline `app-empty` treatment: `"No saved revisions yet."` |
| Whole project, zero documents (defensive-only branch — `createWriterProject`/`createWriterDocument` always insert one document, confirmed by reading `writerData.ts`; realistically unreachable today since there is no per-document archive/delete endpoint) | Bare `<p className="p-6">This project has no active documents.</p>` | Reuse `EmptyState`: heading `"No documents in this project"`, body `"This project has no active documents to display."` — kept as a genuine (if currently unreachable) defensive state rather than assumed impossible, consistent with the file's own existing defensive-branch style. |
| Autosave failure | `"Save failed"`, no retry (§4.2 fixes this) | See §4.4. |
| Document/citation export request failure | Browser's own native download-failure handling (a plain `<a href>` to an API route — a non-2xx response renders as an error page/blocked download, no in-app messaging at all) | **Not changed in this stage** — converting these to `fetch`-then-`Blob`-download would change the download mechanism itself (currently a plain anchor click, testable via `page.waitForEvent("download")` in `writer.spec.ts`/`writer-export.spec.ts`) for a failure case that requires being signed out or losing project ownership mid-session to trigger, i.e. already covered by the global 401/404 handling every other API route gets. Not worth the download-mechanism risk for this stage; noted as a considered "no," not an oversight. |

---

## 8. File plan

### New files, all under `apps/web/src/components/writer/`

| File | Purpose |
|---|---|
| `panels/SourcesEvidencePanel.tsx` | Extracted left-panel content (renamed per §2.4), wraps the unchanged Library-sources + Research-evidence JSX/handlers from today's `WriterEditor.tsx`. Renders either inline (wide) or inside the shared mobile-sheet shell (narrow) depending on a prop the parent supplies. |
| `panels/CitationsHistoryPanel.tsx` | Same extraction for the right panel (renamed per §2.4), citations list + revision list, unchanged handlers. |
| `panels/WriterPanelSheet.tsx` | The narrow-viewport bottom-sheet chrome, built directly on the `ReadManagementSheet.tsx` pattern (`role="dialog"`, `useFocusTrap`/`useDialogEscape`/`useFocusRestoration`, `app-panel-enter`), parameterized by title/children/close so both panels share one sheet shell instead of two copies. |
| `panels/useIsNarrowViewport.ts` | §2.2's `matchMedia` hook. |
| `panels/panelState.ts` + `panelState.test.ts` | §2.2's pure `toggleWidePanel` reducer and its unit tests (plain-function tests, matching this codebase's established convention for interaction logic — see `useFocusTrap.test.ts`'s own comment on why). |
| `SaveStatus.tsx` | §4.4's four-state status component, `saveNow()`-aware Retry button, conflict-banner actions. |
| `useDocumentBroadcast.ts` + `useDocumentBroadcast.test.ts` | §4.3's `BroadcastChannel` wrapper; the pure "does this message apply to me" predicate is unit-tested the same plain-function way as the rest of this file plan. |
| `ExportLinks.tsx` | The two DOCX/PDF anchors (§5.2), relocated, markup unchanged. |
| `ProjectTitleField.tsx` | The rename-on-blur `<input>` (§3), extracted so it can be passed as `useRegisterContextBar`'s `title` value from `WriterEditor.tsx` without inlining a stateful input directly in a hook call. |

### Modified

| File | Change |
|---|---|
| `apps/web/src/components/writer/WriterEditor.tsx` | Composes the new panel/sheet/status/export/title components; removes the old inline `<aside>` JSX (moved, not duplicated) and the old local project-title header row (moved into `ContextBar` via §3); converts every `window.alert` to `toast(...)` (§6); adds `saveNow()` extraction, `beforeunload` guard, and the `BroadcastChannel` wiring (§4). `window.prompt`/`window.confirm` calls are untouched. |
| `apps/web/src/components/writer/WriterProjectsView.tsx` | `window.alert` calls convert to `toast(...)` per §6. No other change — the project-list page's own layout is not part of charter §6 "Write"'s focused-editor ask, and is left alone rather than assumed to need matching treatment it wasn't asked for. |

### Explicitly unchanged

Every `api/writer/**` route, `apps/web/src/lib/writerData.ts`, `apps/web/src/lib/writer/*` (MLA/CSL
formatting, ProseMirror plain-text conversion), `apps/web/src/lib/writerExport.ts`,
`apps/web/src/lib/research/writerEvidence.ts`, `packages/db/src/schema.ts` — none of this stage's decisions
require touching any of them (the one genuine follow-up that would, §4.3's conflict contract, is explicitly
deferred, not silently done here).

---

## 9. Affected E2E specs

### Existing specs needing a deliberate rewrite (accessible-name changes only, same precedent Stage 1 used for `graph.spec.ts`/`workspace-shell.spec.ts` — an IA-structure rewrite of the assertion, not a deletion of coverage)

| Spec | Current assertion | Why it must change |
|---|---|---|
| `writer.spec.ts:69-70` | `getByRole("complementary", {name:"Library source sidebar"})`, `getByRole("separator", {name:"Resize Library source sidebar"})` | §2.4 rename to `"Sources and evidence panel"` / `"Resize Sources and evidence panel"`. |
| `writer.spec.ts:132` | `getByRole("complementary", {name:"Citations and revision recovery"})` | §2.4 rename to `"Citations and revision history panel"`. |
| `writer.spec.ts:46,53` | `getByRole("link", {name:"DOCX"})`/`"PDF"` clicked from the old project header | Names unchanged, but the click target moves to the document toolbar (§5.2) — locator still resolves by accessible name, so this is a location assumption, not a name assumption; verify no test currently scopes these to the old header container specifically (confirmed by direct read: it does not — the locator is unscoped `page.getByRole(...)`, so this row needs no edit at all beyond the two renames above). |

### New coverage needed (new spec file, within this lane's ownership)

`apps/web/e2e/writer-panels.spec.ts` (new):

- At `1024px+`: both panels open by default; each collapse toggle hides only its own panel; central draft
  widens when both are collapsed; collapsed state survives a reload (localStorage persistence, §2.3).
- At `768px`/`375px`: neither panel renders inline; opening Sources via its toggle presents a
  focus-trapped, Escape-closing sheet; opening Citations while Sources is open closes Sources first (§2.1's
  singleton-governed one-at-a-time rule); reduced motion suppresses the sheet's slide-in per the existing
  blanket `data-motion="reduced"` override (no new motion vocabulary, §1.6 of the shell spec already
  established this holds site-wide).
- Autosave failure shows `"Save failed"` with a working `"Retry"` that reaches `"Saved"` on a subsequent
  successful call (mock or force one failed PATCH, matching how other specs already simulate failure paths
  in this codebase).
- Two-tab same-document edit: opens the same document in two `BrowserContext` pages, edits+saves in one,
  asserts the other shows `"Edited in another tab"` and that `"Reload this document"` picks up the saved
  content.
- Keyboard-only pass through: toggle Sources open → Tab through its contents → Escape (narrow) or blur
  (wide) → toggle Citations → insert a citation → restore a revision, with focus verified returning to each
  toggle button per the `useFocusRestoration` contract.

This satisfies charter §16 journey 7's own list (create → reorder/archive → link evidence → insert citation →
autosave → restore revision → run every export) plus the risk-matrix rows specific to Write (1024/768
cross-workflow coverage, reduced motion, keyboard-only Write journey) without re-running the full journey at
every viewport combination redundantly — the existing `writer.spec.ts`/`writer-evidence.spec.ts`/
`writer-export.spec.ts` already cover the functional journey end-to-end at default viewport; this new file
adds exactly the panel/status/conflict coverage that's new in Stage 6, at the viewports where that coverage
is meaningfully different (narrow vs. wide panel behavior).

No existing spec loses assertions — every rename above preserves the same underlying capability check
(the sidebar/aside is still located, still asserted resizable/visible/interactable), just against its new,
charter-aligned name.

---

## 10. Accessibility checklist (charter §17, applied to this stage's own surface)

- Every new toggle/sheet/status control is a real `<button>` with `aria-expanded`/`aria-controls` where
  applicable, 44×44px minimum target (`app-icon-button`/explicit sizing, matching existing shell convention).
- Sheet (narrow) is focus-trapped, Escape-closes, restores focus to its trigger — identical mechanism to
  `ReadManagementSheet.tsx`, not a new one.
- `SaveStatus`'s `role="status"` node itself carries every state change (§4.4) — no separate live region
  needed beyond what already exists.
- Color is never the only cue: the conflict variant (§4.3) changes both text and an icon/border treatment
  using existing `--color-status-highlight-text`/`--color-credibility-critical`-style tokens already proven
  AA-compliant elsewhere in this codebase (no new token, no `globals.css` edit — this lane cannot make one
  anyway).
- Reduced motion: the sheet's `app-panel-enter` class already respects the site-wide `data-motion="reduced"`
  override; the panel-collapse width transition (wide mode) uses the same existing spring tokens
  (`--spring-fast`) already blanket-disabled under reduced motion — no new motion is introduced that isn't
  already covered by the existing global rule.
- Light/dark: every new component uses existing `--color-*` tokens exclusively (`app-card`, `app-control`,
  `app-empty`, `--color-text-muted`, etc.) — zero new colors, so no new contrast computation is needed beyond
  what Stage 1 already verified for these exact tokens.

---

## 11. Stage boundary — what Stage 6 does not touch

- **Insertion entry points from Reader/Knowledge Map** (cross-surface) — explicitly deferred to integration
  per the task's own framing; no Reader or graph file is read or written by this lane.
- **Research-evidence deep links needing Stage 5's new views** — the evidence panel keeps linking to
  `/research/:id/debates/:clusterId` and `/research/chambers/:chamberId` exactly as today; if Stage 5 changes
  those routes' own shape, this panel's links are unaffected since they're plain `<Link href>`s to routes
  this lane doesn't own.
- **The `ContextBar` `actions` slot** — flagged in §3, not built here; this lane cannot edit `ContextBar.tsx`.
- **True cross-device conflict detection (409 contract)** — flagged in §4.3, specified but not implemented;
  touches files outside this lane's ownership.
- **`WriterProjectsView.tsx`'s own layout** — only its `window.alert` calls change (§6); its grid-of-cards
  presentation is not part of charter §6 "Write"'s focused-editor ask and is left as-is.
- **Any database migration, new npm dependency, or production deploy** — none needed; every decision above is
  either a pure client-side/CSS change or a `localStorage`/`BroadcastChannel`-only addition, consistent with
  this worktree's standing constraints.

---

## Summary of files this spec commits to creating/modifying in Stage 6 implementation

New: `apps/web/src/components/writer/panels/{SourcesEvidencePanel,CitationsHistoryPanel,WriterPanelSheet}.tsx`,
`apps/web/src/components/writer/panels/{useIsNarrowViewport,panelState,panelState.test}.ts`,
`apps/web/src/components/writer/{SaveStatus,ExportLinks,ProjectTitleField}.tsx`,
`apps/web/src/components/writer/{useDocumentBroadcast,useDocumentBroadcast.test}.ts`,
`apps/web/e2e/writer-panels.spec.ts`.

Modified: `apps/web/src/components/writer/WriterEditor.tsx`, `apps/web/src/components/writer/WriterProjectsView.tsx`,
`apps/web/e2e/writer.spec.ts` (three accessible-name updates only, §9).

Unchanged: every `api/writer/**` route, `apps/web/src/lib/writerData.ts`, `apps/web/src/lib/writer/*`,
`apps/web/src/lib/writerExport.ts`, `apps/web/src/lib/research/writerEvidence.ts`, `packages/db/src/schema.ts`,
`apps/web/src/components/shell/**`, `apps/web/src/components/primitives/**` (imported from, never edited),
`apps/web/e2e/writer-evidence.spec.ts`, `apps/web/e2e/writer-export.spec.ts` (no assertion in either file
depends on anything this stage renames or restructures, confirmed by direct read).
