# Stage 4 — Read Integration Spec

Status: SPEC (this lane writes no application code). Scope: the "Read"
workspace only — `/dashboard`, `/works` and `/works/[workId]/*`, `/library`,
`/upload`, plus new `apps/web/src/components/read/**` and
`apps/web/src/components/roadmap2d/**`. Written against branch
`redesign/stage4-read`, worktree `/private/tmp/palimnote-s4-read`.

Sources read before writing this spec: charter
`docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md` §5 (scope that must
not lose functionality), §6 "Read" (target IA), §15 Stage 4 (implement/gate
list), §16 "Signed-in journey tests" items 1–3 (and 5–6, which touch Read at
their edges); baseline audit `docs/audits/ui-graph-redesign-baseline.md` §3
(route/feature inventory); and the current code for `(app)/works/**`,
`(app)/library/**`, `(app)/upload/**`, `(app)/dashboard/**`, the reader
component tree, `packages/roadmap`, `packages/curriculum`, and the Stage 1
shell (`apps/web/src/components/shell/**`, read-only — confirms what already
mounts Read's subnav/context bar so this stage does not re-solve it).

---

## 0. What Stage 1 already solved (read-only confirmation, not re-decided here)

Reading the shell first, because Stage 4 must build inside it, not around it:

- `navItems.ts`'s `READ_SUBNAV` already declares `/works` → **"Reading
  Queue"**, `/library` → "Library", `/upload` → "Upload". `WorkspaceRail`
  already renders this as the Read rail item's expandable subnav; the
  command palette (`buildCommandPaletteNavItems`) already lists Reading
  Queue, Library, Upload, Trash, Knowledge Map. **This spec does not touch
  navigation chrome** — it only has to make `/works` deserve the label
  "Reading Queue" it's already been given, and keep every route these items
  point at resolving correctly.
- `ReadManagementSheet.tsx` is the charter's required "secondary
  Library/Read management menu" for Trash on mobile, already built and
  already listing `/works/trash`. **Trash reachability (§6) is therefore
  already satisfied at the shell level** — this spec's own Trash
  responsibility (§7 below) is limited to the `/works/trash` page's own
  content, not inventing a new entry point.
- `ContextBarProvider`'s `useRegisterContextBar({ title, actions })` is a
  ready, unused (Stage 1 says so directly in its own comment) seam for a
  page to set the sticky context-bar title. This spec uses it for the work
  title only; the tab strip itself renders in-page (§3), not through this
  seam, to keep every file this spec touches inside the owned tree.
  Route-changing back-forward gestures thus never fight the context bar for
  data — the page still tells the bar what to show.
- `GlobalRagSidebar` mounts at `AppShellRoot` (shell root, not touchable).
  This is why "Ask Library single-controller enforcement" is DEFERRED for
  the cross-mount half of the problem (§9) — the reader's own local RAG
  mount is the only half this lane can actually fix, and §5 below fixes it.

---

## 1. Home surface replacement (`(app)/dashboard/page.tsx`)

### 1.1 What's wrong today

`DashboardPage` (current file, 113 lines) is three stat tiles (`myWorks.length`,
`toReadCount`, `statusCounts.processing`), a single "Continue reading" card
keyed off the first `ready` work in creation order (not actual last-read
recency), and a link row duplicating the rail. The charter (§6 "Home")
explicitly asks to "replace the counter-led dashboard" with an
evidence-backed next-work surface. The counters aren't wrong data, they're
just the wrong *shape* of surface — they answer "how much do I have" instead
of "what should I do next."

### 1.2 Decision: four evidence cards + honest empty states, no new tables

`DashboardPage` (server component, still `(app)/dashboard/page.tsx`) queries
four **existing** data sources — no schema change, no new AI call, same
zero-LLM/zero-cache discipline `apps/web/src/lib/researchDashboard.ts`
already established for the Phase 29.3 module this page already mounts:

1. **Resume reading position** — `document.lastPosition` (already read by
   the reader shell) joined to the owning `work`, most recent
   `document.updatedAt` among `works.userId = self AND deletedAt IS NULL AND
   documents.processingStatus = 'ready' AND lastPosition IS NOT NULL`. If a
   reader has never opened a ready work, this card is honestly absent (not
   a placeholder card) — "Continue reading" only ever names a *real* saved
   position, never falls back to "most recently uploaded" the way today's
   card silently does.
2. **A claim or relationship awaiting attention** — one representative row
   from `research_claim` (owner-scoped through `research_project`,
   `verification_status = 'unreviewed'`, not hidden, most recent), gated
   behind `phase25FeatureEnabled("research")` exactly like the existing
   `ResearchInsightModule`. This is new *query* work (existing
   `researchDashboard.ts` only returns a *count*, `claimsAwaitingReview:
   number` — Home needs one concrete, linkable claim, not a count) but it's
   an additive sibling query over the same table, same owner-scoping
   pattern, zero new AI spend. Belongs in `apps/web/src/lib/` in the
   implementation stage — out of this lane's file ownership to write, but
   the query shape (one `research_claim` row, most-recent-unreviewed,
   owner-scoped via `research_project.userId`) is decided here so the
   Research-integration lane (Stage 5) isn't guessing at a Home-specific
   contract.
3. **A running or interrupted Research job** — reuses
   `researchDashboard.ts`'s existing `runningJobs`/`failedJobs` counts
   directly (no new query): if `runningJobs > 0`, show one running-job card
   pointing at `/research` (or the owning project once Stage 5 makes that
   resolvable); if `failedJobs > 0` and nothing is running, show a
   recoverable "processing paused" card instead. Same
   `phase25FeatureEnabled("research")` gate as above.
4. **Latest Writer draft** — most recently updated non-archived
   `writer_document` the user owns, gated behind the existing `writer`
   flag. This is a **Stage 6 (Write integration) responsibility to wire the
   actual query**, since `writer/**` is out of this lane's file ownership
   entirely; this spec records the card's existence and position in the
   Home layout so Stage 6 has a fixed slot rather than inventing its own
   Home real estate.

Below the four cards, in fixed order regardless of which cards are present:

- **Concise processing/research status, shown only when actionable** — a
  single line, not a tile grid, listing counts that need attention right
  now: `processing` works (link to Reading Queue filtered to that state)
  and (research-flag-gated) `newContradictions`/`newMonitorHits` from the
  existing `researchDashboard.ts` counts. This absorbs the old
  `statusCounts.processing` tile without resurrecting a counter-led grid —
  it's a status line, not a KPI row, and it disappears entirely (not
  renders as "0") when every count is zero.
- **Direct access to Library, Upload, and recent projects** — one action
  row, same three links `DashboardPage` already has today (`/library`,
  `/upload`, and — once Stage 5/6 exist — recent Research/Writer projects),
  kept exactly because the charter's own Home bullet list asks for it
  verbatim ("Retain direct access to Library, Upload, and recent
  projects").

**Empty-state discipline:** a brand-new account (the case
`ResearchInsightModule`'s `hasResearchInsightSignal` gate already handles
correctly for its own module) sees zero of the four evidence cards and the
status line collapses to nothing — what remains is the eyebrow/title, the
action row, and one honest sentence ("Nothing to resume yet — upload a work
to get started," linking to `/upload`). No card ever renders in a
"nothing here" state; a card's presence *is* its own signal, matching the
pattern `continueReading &&` already uses today, just applied to all four
surfaces instead of one.

### 1.3 Non-decision (explicitly deferred, not silently dropped)

The Writer-draft card's real query is Stage 6's to write (file ownership).
This spec fixes its *position* (fourth card, same visual treatment as the
other three) and its *gate* (`writer` flag) so Stage 6 doesn't have to
renegotiate Home's layout — it only has to fill in one query.

---

## 2. Reading Queue as `/works` redesign

### 2.1 What's wrong today

`WorksPage` (current file) is a flat `<ul>` of every non-deleted work,
title + status only, no search, no filter, no ordering choice, no
distinction between "needs your attention" (needs_review, failed, stalled)
and "just sitting there ready." It's technically already reachable as
"Reading Queue" (Stage 1's subnav label), but its content doesn't earn that
name — it's an inventory list, not a queue.

### 2.2 Decision: status-grouped queue, same data source, richer client shell

Keep `WorksPage` a server component at the same route computing the same
base query (`works` LEFT JOIN `documents`, owner-scoped, `deletedAt IS
NULL`) — no new table, no new join beyond what's already there
(`processingRuns` for the stage detail, already fetched per-work today by
`WorkStatusPanel`, not by this list). Change the **rendering**, not the
data model:

- **Attention-first grouping**, not raw creation-date order: three
  sections, each collapsible but open by default when non-empty —
  "Needs your attention" (`needs_review`, `failed`, or `stalled`, computed
  the same way `WorkStatusPanel`'s own `stalled` flag already is — reuse,
  don't reinvent), "In progress" (`uploaded`, `processing`), "Ready to
  read" (`ready`). Within "Ready to read," default sort is most-recently-
  updated first (closest available proxy for "what you'd naturally pick up
  next" without inventing a recency table); a sort control (Recent /
  Title / Author) lets the reader override it, client-side only — this is
  a display list, not `/library`'s server-authoritative search, so no new
  API route.
- **A one-line search-as-you-type filter** (client-side substring match on
  title/author over the already-fetched list — this list is one user's own
  uploads, realistically dozens not thousands, so a server round-trip per
  keystroke is unjustified complexity `/library`'s own richer search
  earns from real corpus scale that this page doesn't have).
- **Each row keeps its existing status pill and gains a one-line "what to
  do" affordance** drawn from the same status the pill already encodes:
  `needs_review` rows link straight to the work (Details tab, where the
  confirm form already lives — see §3); `failed`/`stalled` rows surface a
  "Retry" action inline (calling the same `/api/works/:id/reprocess` the
  status panel already calls, so this list can trigger it directly instead
  of forcing a click-through); `ready` rows link straight to `/works/:id`
  (which now opens on the Reader tab by default — §3.3).
- **Batch-upload continuity**: `/upload`'s existing batch queue already
  writes each finished item as its own `work` row; this page doesn't need
  to know anything about batches — a batch's five works just appear as five
  ordinary "In progress" → "Needs your attention"/"Ready" rows as they
  individually resolve, which is the correct behavior already and needs no
  change.

**File:** `(app)/works/page.tsx` keeps doing the DB query (server
component); a new client component `(app)/works/ReadingQueueView.tsx`
takes the fetched rows and owns grouping/search/sort/retry as local state
— same server-fetch/client-interaction split every other list page in this
tree already uses (`LibraryView.tsx` next to `library/page.tsx`).

### 2.3 Non-decision

No new "priority" or "recommended next" ranking algorithm. The charter asks
for Reading Queue to organize by state and let the reader act on it — it
does not ask this page to duplicate `@ice/roadmap`'s ranking logic, which
answers a different question (what to read *relative to one particular
work*) than this page's question (what's actionable *right now, across
every upload*). Keeping them distinct avoids two components silently
disagreeing about "what's next."

---

## 3. Work context header (persistent tabs)

### 3.1 What's wrong today

Every one of `/works/[workId]`, `/works/[workId]/reader`,
`/works/[workId]/roadmap`, `/works/[workId]/curriculum`,
`/works/[workId]/diagnostic`, and `/works/[workId]/graph` is an
**independent route** that separately fetches `getOwnedDocument`/
`getOwnedWork`, separately renders the work's title, and offers no way to
move between them except `WorkStatusPanel`'s own link row (visible only
from the Details page, and only once the work is `ready`) or browser
back/forward. There is no persistent sense of "I am inside this work" while
reading, checking the roadmap, and reviewing curriculum in the same
session — exactly the gap charter §6 names.

### 3.2 Decision: `layout.tsx` + `WorkContextHeader`, seven tabs, one shared identity fetch

New file: `apps/web/src/app/(app)/works/[workId]/layout.tsx` (server
component). It does the **one** ownership/identity fetch every child route
currently duplicates — `getOwnedWork(workId, userId)` (not
`getOwnedDocument`; per the codebase's own documented design decision,
`getOwnedWork` is the one that still resolves a *trashed* work, which the
Details tab and the trashed-state banner both need to keep working) — and
renders:

```
<WorkContextHeader work={...} activeTabHref={...} />
{children}
```

`children` is still each existing page component, doing its own additional
fetch as needed (edition payload, roadmap items, curriculum result) — this
spec does **not** try to lift those fetches into the layout, since several
of them are genuinely tab-specific (the reader's edition payload is heavy
and irrelevant to the Roadmap tab) and Next's per-segment fetch model
already parallelizes this correctly. The layout only removes the
*duplicated identity fetch and title render*, not each tab's real content
fetch.

**New file:** `apps/web/src/app/(app)/works/[workId]/WorkContextHeader.tsx`
(server component — no client state needed; it's a title + a set of
`<Link>`s with `aria-current="page"` on the active one, matching the
landing-page tab convention `ReaderShell`'s own Published-edition/
Interactive-reader toggle already uses). It also calls
`useRegisterContextBar` — wait, that hook is client-only (`"use client"`
in `ContextBarProvider.tsx`); so the title-registration half moves into a
tiny client leaf (`WorkContextHeaderTitle.tsx`, `"use client"`, just calls
`useRegisterContextBar({ title: work.title })` and renders nothing) that
`WorkContextHeader` mounts alongside its own server-rendered tab strip —
this keeps the tab strip itself a zero-JS server component while still
satisfying Stage 1's context-bar seam.

**Seven tabs, exact charter order** (§6: "Reader, Sources, Roadmap,
Curriculum, Concept Check, Knowledge Map, Work details/status"):

| Tab | Route | Enabled when | Notes |
|---|---|---|---|
| Reader | `/works/[id]/reader` | `processingStatus === "ready"` and not deleted | Existing `ReaderPage`'s own `redirect` (§3.3) becomes unreachable once the tab is disabled instead, so the redirect can be deleted rather than fired |
| Sources | `/works/[id]/sources` | `processingStatus === "ready"` and not deleted | **New route**, §3.4 |
| Roadmap | `/works/[id]/roadmap` | same | Existing route, unchanged page, new 2D visual (§6) |
| Curriculum | `/works/[id]/curriculum` | same | Existing route, unchanged |
| Concept Check | `/works/[id]/diagnostic` | same | Existing route, unchanged |
| Knowledge Map | `/works/[id]/graph` | same | Existing route, unchanged component (owned by `components/graph/**`, out of scope) — **not stubbed disabled**, since disabling a route that already works would be a functionality *loss*, which charter §5 forbids. Deeper work-context integration (synced camera focus, passage continuity) is the deferred item, not reachability. See §9. |
| Details | `/works/[id]` | always | Existing `WorkStatusPanel`, trimmed (§3.5) |

Non-Details tabs render **disabled** (not hidden — charter's own "stubbed
reachable-later, honestly disabled" phrasing for Knowledge Map applies
equally well to every processing-gated tab here) with an inline reason
drawn from the work's actual status: "Available once processing finishes"
for `uploaded`/`processing`/`needs_review`, "Unavailable — processing
failed" (linking to Details, where Retry lives) for `failed`, and "This
work is in Trash — restore it to continue" for a trashed work. This
directly implements the charter's "For any unsupported action, test the
explicit unavailable explanation" standard (§16 item 6) applied to
navigation, not just corrections.

### 3.3 Reader-tab consequence: retire the page-level redirect

`ReaderPage`'s current `if (doc.processingStatus !== "ready") redirect(...)`
becomes dead code once the Reader tab is disabled for exactly that
condition — a reader can no longer land on `/works/:id/reader` for a
not-ready work through the UI. It stays as a defensive guard (someone
could still type the URL directly) but changes from `redirect` to
rendering the **same disabled-tab explanation** inline instead of bouncing
away silently, so a direct URL visit is at least as informative as clicking
the disabled tab would have been.

### 3.4 New route: Sources tab

`(app)/works/[workId]/sources/page.tsx` (new) +
`(app)/works/[workId]/sources/SourcesView.tsx` (new). Charter lists
"Sources" as its own persistent tab, parallel in rank to Roadmap/
Curriculum — not merely "click into the Reader, then find the Sources tab
buried in its side drawer," which is where this content lives *today*
(`EditionAnnotationsPanel.tsx`'s existing `"sources"` tab, rendering
`SourcesTab`, over `edition.resources`). This is a genuine value-add the
charter is asking for, not a cosmetic move: it makes credibility,
provenance, and license/access status reachable without opening the
Reader at all, and makes "acquire a missing source" (`LibrarySourceAttach`,
already built for `/library/[resourceId]`) reachable in a work-scoped
context.

Data source: `resource_role` rows keyed on this work's `workIdentityId`
(same join `library/[resourceId]/page.tsx` already performs from the
other direction), joined to `learning_resource` for credibility/license/
popularity, rendered as the same card treatment `LibraryView.tsx` already
uses for a Library row (reuse the visual language, not the component
directly — `LibraryView` is a full search/filter surface over the *whole*
library; this page is one work's own resolved sources, unfiltered,
un-paginated at realistic single-work scale). Each card links to
`/library/[resourceId]` for the full detail/attach flow rather than
duplicating `LibrarySourceAttach`'s upload-missing-source logic on this
page too.

**Non-decision:** the Reader's own in-drawer Sources tab (§4) is **not**
removed — a reader mid-passage still wants sources without leaving the
text. The two views read the same underlying data through different
fetches (this page: a dedicated `/api/works/:id/sources` route, new,
owned by this lane; the reader drawer: the existing `edition.resources`
already embedded in the edition payload) — no risk of disagreement since
both ultimately read the same `resource_role`/`learning_resource` rows,
just through two different query shapes for two different contexts (a
full page vs. a cramped sidebar).

### 3.5 Details tab: trim, don't rebuild

`WorkStatusPanel.tsx` keeps every piece of state it owns today (poll,
confirm form, reprocess, trash/restore, error handling) — none of that is
navigation, so none of it moves. What's **removed**: the link row
(`Reading roadmap` / `Concept check` / `Curriculum` / `Visualization` /
`Open reader` buttons in the terminal "Ready" state, lines ~349–379 of the
current file) — those five links are now the tab strip one level up, and
leaving them duplicated in the Details tab content would put the same six
destinations in two different places on the same screen, which is exactly
the kind of redundant chrome charter §6 is trying to eliminate elsewhere
(pipeline actions, RAG mounts). The trash/restore controls, the
reprocess button, and the trashed-state banner (with its own `Trash` link
to `/works/trash` — unaffected, still needed since Details is reachable
even when every other tab is disabled) all stay exactly as they are.

---

## 4. Simplified Reader chrome

### 4.1 Panel inventory (what exists today, read from `ReaderShell.tsx` directly)

| Surface | Component | Position (wide) | Position (narrow) | Can currently coexist with |
|---|---|---|---|---|
| Toolbar | inline in `ReaderShell` | sticky top bar | same | everything (always visible) |
| Outline | `ReaderOutlineSidebar` | left sticky column | left drawer via `ReaderSidebarFrame` | Analysis, Notes, RAG |
| Analysis/Generated notes/Apparatus/Terms/Sources/Claims | `EditionAnnotationsPanel` (6 internal tabs) | right sticky column, via `ReaderSidebarFrame` | right bottom-sheet | Outline, Notes, RAG |
| My notes/highlights/bookmarks | `NotesSidebar` | right sticky column, via `ReaderSidebarFrame` | right bottom-sheet | Outline, Analysis, RAG |
| Ask Library (reader-local) | `RagChatPanel` | fixed overlay, right edge | fixed bottom sheet | Outline, Analysis, Notes (independently toggled, no mutual exclusion today) |
| Footnote popup | `FootnoteModal` | centered dialog | same | everything (short-lived, self-closing) |

Confirmed by reading the state: `showAnalysis`, `showNotes`, and
`showRagChat` are three fully independent booleans in `ReaderShell.tsx`.
At a wide viewport this can render **two sticky flex-width columns
(Analysis + Notes) simultaneously**, each fighting the reading column for
horizontal space, plus a third fixed-overlay RAG panel on top — the exact
"multiple side panels crush the reading measure" failure mode charter §6
names. At a narrow viewport it's three independently-triggerable bottom
sheets, which the charter's "one bottom sheet at a time" line directly
forbids, and which today's code does not prevent (each sheet's own
`ReaderSidebarFrame`/`RagChatPanel` markup has no awareness of the other
two).

### 4.2 Decision: one right drawer with a "My notes" tab added, mutual exclusion with RAG

**Merge `NotesSidebar`'s content into `EditionAnnotationsPanel` as a
seventh tab**, rather than building a new container component. This is
additive to an existing, already-tabbed, already-`ReaderSidebarFrame`-based
component (§3.4 note above already confirmed `SourcesTab` lives there the
same way) — the least invasive change that satisfies "ONE right analysis/
notes drawer" literally:

- New tab: `"my-notes"` alongside the existing `annotations | notes |
  apparatus | terms | sources | claims`. Renders exactly what
  `NotesSidebar.tsx` renders today (highlights list, notes list, bookmarks
  list, delete/select handlers) — those handlers already live in
  `ReaderShell` and already get passed down to `NotesSidebar` as props
  today, so this is a prop-plumbing change (route the same callbacks into
  `EditionAnnotationsPanel` instead of a separate component), not new
  business logic.
- `NotesSidebar.tsx` and its own `ReaderSidebarFrame` mount are retired.
  `showNotes` state collapses into the existing `showAnalysis` boolean
  (one `showDrawer` state) plus an `activeDrawerTab` that opening from
  "+ Bookmark" or "My notes" sets to `"my-notes"`, exactly the same
  `setActiveId`-on-open pattern the drawer's other six tabs already use
  when `openAnnotation` is called (auto-switching tab to whatever was
  clicked). The toolbar's two separate "Analysis"/"My notes" buttons
  become one "Notes" button (opens the drawer to whatever tab was last
  active, or `annotations` by default) plus the existing per-tab counts
  already computed for each tab today stay exactly where they are, just
  inside one drawer instead of two.
- **Ask Library stays visually separate** (an overlay/chat surface is a
  different interaction model than a tabbed reference drawer — folding it
  in as an eighth tab would make "ask a question" and "read a footnote"
  compete for the same fixed-width column, which is worse, not better).
  Instead: **mutual exclusion**. Opening RAG while the notes/analysis
  drawer is open closes the drawer first (and vice versa) — implemented as
  one more case in the same toggle handlers `ReaderShell` already owns
  (`setShowRagChat` and the merged `setShowDrawer` each close the other
  before opening themselves). This is the Reader-local half of "Ask
  Library... exactly one mounted assistant/conversation controller at a
  time" the charter's Stage 4 bullet asks for; the cross-shell half (RAG
  panel vs. `GlobalRagSidebar`) is deferred (§9) because it requires a
  shell-level seam this lane cannot add.
- **Outline stays a separate left rail**, unaffected — charter's own
  Reader-chrome bullets list "optional outline on the left" and "one
  contextual analysis/notes drawer on the right" as two different
  allowances, not one that has to also absorb the other.

Net toolbar button count: `Outline | Notes | Ask Library` (down from
`Analysis | My notes | Ask Library`, outline toggle unchanged) — three
top-level toggles instead of four, and only ever one right-side surface
showing at once, both narrow and wide.

### 4.3 Reading measure never crushed

With Analysis+Notes merged into one drawer, the wide-viewport worst case
becomes: Outline (left, fixed width) + one drawer (right, fixed width,
`w-80`–`w-96` range matching `NotesSidebar`'s existing `w-72` and
`EditionAnnotationsPanel`'s existing width class) — same two-column-plus-
reader layout the reader already supports today when only Outline+Analysis
were open simultaneously (the common case already), just now the
*maximum* case instead of a possible-but-untested triple-column one. No
new CSS is needed beyond removing `NotesSidebar`'s now-dead second mount
point; `--reading-measure` (globals.css, out of scope to touch, already
theme/preference-driven) is unaffected either way since neither rail was
ever laid out by squeezing that token — they're `shrink-0` siblings in the
existing flex row.

### 4.4 File plan for this section

- Edit `EditionAnnotationsPanel.tsx`: add `"my-notes"` tab, its render
  branch (port `NotesSidebar`'s JSX body in, keep its existing prop
  contract), extend the tab union type.
- Edit `ReaderShell.tsx`: collapse `showAnalysis`/`showNotes` into one
  drawer-open boolean + `activeDrawerTab`; add RAG/drawer mutual
  exclusion; update toolbar button count/labels; delete the `<NotesSidebar
  .../>` render branch and its now-unused imports/refs
  (`notesTriggerRef`, `closeNotesPanel` — fold into the single drawer's
  trigger/close, matching the pattern the other five tabs already share
  one trigger for).
- Delete `NotesSidebar.tsx` once its content is ported (no other caller —
  confirmed only `ReaderShell.tsx` imports it).
- `ReaderSidebarFrame.tsx`, `AnnotationsPanel.tsx` (legacy non-edition
  reader path), `matchNoteToBlock.ts`, `highlightDom.ts`: unchanged.

---

## 5. Preserved representations

Charter requirement: "Preserve and clearly distinguish Published Edition,
Interactive Reader, original PDF/file access, and split-view reading" and
"Preserve outline, apparatus, terms, generated critical notes, claims,
annotations, sources, highlights, notes, bookmarks, and saved position
while switching representation or split state."

**Decision: no behavior change, only chrome consolidation.** Reading
`ReaderShell.tsx` end to end confirms every one of those already survives a
representation/split-state switch today — `data`, `edition`, `claims` are
all held in `ReaderShell`'s own state above the toggle, never re-fetched or
reset by `setShowInteractive`/`setSplitWorkId`; highlights/notes/bookmarks
live in `data` and render into whichever reader (`EditionReader`,
`OriginalTextReader`, `PdfReader`) is currently mounted via shared props;
`savePosition` fires from whichever reader is active regardless of
representation. **§4's drawer merge does not touch any of this state** —
it only changes which component renders the *display* of
apparatus/terms/claims/my-notes, not what's fetched or when. The one
concrete verification this lane owes (not a code change): after the §4
merge, re-run `reader.spec.ts`'s existing "switch Published edition ↔
Interactive reader, notes/highlights survive" assertions and confirm they
still pass unmodified in *content* (only their button-name selectors need
updating per §8's IA-impact table) — proving the merge really is chrome-
only.

---

## 6. 2D stage-column Roadmap (`roadmap2d/`)

### 6.1 What exists today is not this, and must not be confused for it

`RoadmapConstellation.tsx` (654 lines) is a hand-rolled yaw/pitch/zoom
canvas projection: concentric **rings** per tier (`ringRadius`), a
deterministic **depth hash per node** (`hashDepth`, ±40 units, explicitly
"decorative depth"), and pointer/wheel/keyboard **rotation** controls
(`DEFAULT_YAW`/`DEFAULT_PITCH`). Its own doc comment already distinguishes
it from the WebGL Knowledge Map — correctly — but it is *itself* a pseudo-
3D (extruded, rotatable) visualization, which is exactly what charter §6
says the Roadmap must **not** be ("It is not a mode inside the 3D
Knowledge Map" — and by the same logic, not a rotatable pseudo-3D
companion to it either). This is a genuine defect against the charter, not
a style preference: `RoadmapConstellation` is retired, not kept as an
option.

### 6.2 Data reality: no item-to-item edges exist

`RoadmapItem` (`packages/roadmap/src/index.ts`) carries `tier`, `sequence`,
`category`, `confidence`, `centrality`, `estimatedMinutes`, `known`,
`overridden`, `reason` — **no `dependsOn`/prerequisite-of field between
items**. The DB-side traversal (`apps/web/src/lib/roadmap.ts`, out of
scope) reaches every candidate from the root work by one hop of
`graph_edge`; `RoadmapConstellation` itself only ever draws root→item
edges (confirmed: "Edges: one per item, root → item," its own comment).
`packages/curriculum`'s `stageDependencyEdges()` looks like a richer
source at first glance but its own doc comment says otherwise: it
generates a dense **complete bipartite graph** (every item in a stage
depends on *every* item in *every* earlier stage) purely to feed
`hasCycle()`'s unit-test proof that stage order is acyclic — drawing that
edge set on screen would be an unreadable hairball, not a DAG diagram, and
using it for that would misrepresent invented edges as real, individually-
reasoned prerequisites, which this dataset does not actually contain.

**Decision: the DAG is column = tier, edge = root→item (reusing what the
data actually supports), never node-to-node.** This is not a downgrade
from "real DAG to fake DAG" — it's the same honest position the codebase
already takes about roadmap transitivity ("degrades to a leaf otherwise,"
Design Decisions table) applied to this visualization: showing invented
inter-item edges would be less honest than showing what's real (a
priority/dependency-tier assignment, not a fully reasoned prerequisite
graph).

### 6.3 Layout

`TIER_ORDER` (7 tiers, already exported by `@ice/roadmap`, already the
`RoadmapView.tsx` tier-grouped list's own grouping key) becomes the 7
stage-columns, in their existing dependency-priority order (essential →
high → strongly_recommended → interpretive_aid → contextual → comparative
→ optional — i.e., *read this first* on the left). Root work renders as
one fixed node at column 0 ("You are here"). Every `RoadmapItem` renders
as a node in its tier's column, stacked vertically within the column
(simple flow layout — y-position by index within tier, no force
simulation, no physics). One straight edge per item, root → item, colored
by `category` reusing the existing `CATEGORY_META` palette
`RoadmapConstellation`/`EditionAnnotationsPanel` already share — same
visual vocabulary, flat instead of radial. On narrow viewports, columns
stack top-to-bottom instead of left-to-right (a vertical stage list,
still genuinely 2D, still no rotation) rather than forcing horizontal
scroll of 7 columns on a phone.

This is deliberately **not** a generic DAG-layout algorithm (no Sugiyama/
layered-graph solver) — with only root→leaf edges and a fixed 7-column
assignment already known in advance, a general solver would be solving a
problem this data doesn't have (there are no crossing item-to-item edges
to minimize). A plain CSS grid (columns = tiers, rows = index) is the
correct-complexity implementation.

### 6.4 Interaction and accessibility

- Click/Enter/Space on a node opens the same detail treatment
  `RoadmapConstellation`'s existing click-to-inspect pane already provides
  (title, authors, year, tier, category, reason, "why this, here" line,
  status/override controls via the existing `mutate` callback
  `RoadmapView.tsx` already owns) — ported, not redesigned.
- Full keyboard operability: nodes are real focusable elements in DOM tab
  order (grid reading order: column by column, top to bottom within a
  column) — no canvas hit-testing, no synthetic roving-tabindex needed
  given the modest node count (`RoadmapView`'s own comprehensive-mode cap
  already bounds this). This directly satisfies charter §17
  ("Canvas must not create a keyboard trap") by not using canvas at all
  for this component — SVG or plain positioned DOM nodes, either is fine,
  decided at implementation time by which renders the connecting lines
  more cheaply; no canvas either way.
- Zoom/pan is **not** required — charter doesn't ask for it for this
  component (unlike the Knowledge Map, §10–11 of the charter, out of
  scope here), and a fixed 7-column grid at realistic single-work item
  counts (tens, not thousands — `RoadmapView`'s comprehensive-mode cap)
  doesn't need it. If a future dense-fixture measurement proves otherwise,
  that's Stage 7's full-verification problem to raise, not a speculative
  feature to build now.
- The existing accessible tier `<ol>` list in `RoadmapView.tsx` **remains
  the default, always-rendered view**, exactly as
  `RoadmapConstellation`'s own doc comment already establishes for itself
  ("The always-visible, never-collapsed accessible view... remains the
  tier list — nothing here replaces or gates that"). `roadmap2d/` becomes
  the opt-in companion visualization in the same "Map"/"Table" toggle slot
  `RoadmapConstellation` already occupies — one component swapped for
  another behind an unchanged toggle, not a new interaction pattern.

### 6.5 File plan

- New: `apps/web/src/components/roadmap2d/RoadmapStageColumns.tsx` (the
  component itself), `apps/web/src/components/roadmap2d/roadmap2d.css`
  (new stylesheet per the program rules — `globals.css` is off limits),
  `apps/web/src/components/roadmap2d/roadmapStageLayout.ts` (pure
  column/row position function, unit-testable without DOM — mirrors the
  existing `roadmapLayout.test.ts` precedent for the 3D graph).
- Edit: `apps/web/src/app/(app)/works/[workId]/roadmap/RoadmapView.tsx`
  swaps its `<RoadmapConstellation .../>` render for
  `<RoadmapStageColumns .../>`, same props shape it already assembles
  today (`items`, `mutate`, tier/category color maps).
- Delete: `RoadmapConstellation.tsx` (confirmed sole caller is
  `RoadmapView.tsx`, and its own doc comment already frames it as a
  Reading-Roadmap-only companion, not shared with any other route).

---

## 7. Trash reachability

Already solved at the shell level (§0). This lane's only remaining
responsibility: `(app)/works/trash/page.tsx` and `TrashView.tsx` keep
their exact current behavior (list, restore, guarded permanent-delete via
`PermanentDeleteDialog.tsx`) — no functional change. The one visual-
language task is bringing this page's styling in line with whatever Stage
1 token cleanup did to `PageHeader`/card treatments elsewhere in this
tree, which is a mechanical pass, not a design decision this spec needs to
make ahead of time.

---

## 8. File plan (summary) and e2e IA impact

### 8.1 New files

- `(app)/works/[workId]/layout.tsx`
- `(app)/works/[workId]/WorkContextHeader.tsx`
- `(app)/works/[workId]/WorkContextHeaderTitle.tsx`
- `(app)/works/[workId]/sources/page.tsx`
- `(app)/works/[workId]/sources/SourcesView.tsx`
- `(app)/works/ReadingQueueView.tsx`
- `components/roadmap2d/RoadmapStageColumns.tsx`
- `components/roadmap2d/roadmapStageLayout.ts` (+ `.test.ts`)
- `components/roadmap2d/roadmap2d.css`
- `components/read/` — reserved for any cross-page primitive this stage's
  implementation discovers it needs (e.g., a shared disabled-tab-reason
  component used by both `WorkContextHeader` and `ReadingQueueView`'s
  attention badges); no file is pre-specified here since none was found
  necessary during spec-writing — an implementation-time decision, not
  deferred scope.
- New e2e: `apps/web/e2e/work-context-header.spec.ts` (tab strip presence/
  disabled-reason/keyboard nav), `apps/web/e2e/sources-tab.spec.ts`,
  `apps/web/e2e/roadmap2d.spec.ts` (keyboard-only node traversal + detail
  pane, replacing `roadmap-constellation.spec.ts`'s scope).

### 8.2 Edited files

- `(app)/dashboard/page.tsx` (§1)
- `(app)/works/page.tsx` (§2, query trimmed to grouping-relevant fields)
- `(app)/works/[workId]/page.tsx` → folded into the new `layout.tsx` +
  `WorkStatusPanel.tsx` trim (§3.5)
- `(app)/works/[workId]/reader/page.tsx` (§3.3, redirect → inline
  explanation)
- `(app)/works/[workId]/reader/ReaderShell.tsx`,
  `EditionAnnotationsPanel.tsx` (§4)
- `(app)/works/[workId]/roadmap/RoadmapView.tsx` (§6.5)

### 8.3 Deleted files

- `(app)/works/[workId]/reader/NotesSidebar.tsx` (§4.4)
- `(app)/works/[workId]/roadmap/RoadmapConstellation.tsx` (§6.5)

### 8.4 Existing e2e specs needing IA updates (selector/flow, not intent)

| Spec | What breaks | Fix |
|---|---|---|
| `reader.spec.ts` | `getByRole("button", { name: "My notes" })` (line 143), separate Analysis/My-notes toggles assumed elsewhere | Update to the merged "Notes" toggle + tab-switch-to `my-notes` interaction |
| `annotations.spec.ts` | Any direct `showAnalysis`-only toggle assumptions | Same drawer-merge update |
| `work-status.spec.ts` | Asserts the "Reading roadmap"/"Concept check"/"Curriculum"/"Visualization"/"Open reader" link row exists inside the Details panel's Ready state | Move those existence assertions to the new tab strip (`WorkContextHeader`); trashed-state `Trash` link assertion (line 250) is unaffected, stays in Details |
| `roadmap-constellation.spec.ts` | Tests the retired rotate/yaw/pitch canvas component directly | Replaced by new `roadmap2d.spec.ts` (§8.1); this file is deleted, not left failing |
| `roadmap.spec.ts` | Heading assertions (`"Reading roadmap"`, `"Visualization"` toggle label) stay valid; only the Map/Table toggle's underlying visualization changes | No selector change expected — verify at implementation time that the "Map" toggle's target content swap doesn't rename the toggle's own label |
| `curriculum.spec.ts`, `diagnostic.spec.ts` | Heading assertions unaffected — tab strip is additive chrome above existing content | No change expected, verify only |
| `trash.spec.ts`, `trash-storage.spec.ts` | Unaffected (§7: no behavior change) | No change expected |
| `upload.spec.ts`, `upload-integrity.spec.ts` | Unaffected (§2.2: batch queue behavior unchanged) | No change expected |
| `library.spec.ts`, `source-attach.spec.ts` | Unaffected directly; `source-attach.spec.ts` may gain a companion path once the Sources tab links to `/library/[resourceId]` | No required change; optional new assertion that the Sources-tab link round-trips correctly |
| `rag.spec.ts` | New reader-local mutual-exclusion behavior (drawer closes when RAG opens, §4.2) is new *coverage*, not a breakage | Add assertions, don't need to fix existing ones |

---

## 9. Deferred — recorded, not built (per this lane's explicit instructions)

These three items are named in the charter's Stage 4 "Implement" list but
were explicitly called out by the orchestrating task as **out of scope for
this lane**, to be picked up in the post-merge integration pass once the
Knowledge Map rebuild (Stage 3, `components/knowledge-map/**`) and the
shell (`components/shell/**`) are both stable enough to extend safely:

1. **Knowledge Map work-context tab wiring beyond a plain link.** §3.2
   above makes the tab reachable (linking to the existing, functioning
   `/works/[workId]/graph` route, preserving current capability) but does
   *not* attempt the deeper integration charter §15 Stage 4 calls
   "Passage-to-claim/evidence/map continuity" — a Knowledge Map view that
   opens already-focused on the passage/claim the reader was just looking
   at, or a context chooser aware of "I got here from this work's Reader
   tab." That needs Stage 3's context-chooser/entry-context machinery
   (`components/knowledge-map/**`, out of this lane's ownership) to exist
   and be stable first.
2. **Passage→claim/evidence/map continuity** (charter §16 journey 5:
   "Passage → claim → evidence → disagreement → graph → 2D learning
   Roadmap/Curriculum → Writer insertion, with reversible navigation").
   This lane's Reader chrome consolidation (§4) and Sources tab (§3.4)
   are necessary groundwork for that journey (a single coherent drawer to
   click a claim in, a Sources tab that could deep-link a disagreement to
   its source), but wiring the actual cross-surface navigation (Reader →
   Knowledge Map → Roadmap → Writer, each hop preserving context) touches
   `components/knowledge-map/**`, `research/**`, and `writer/**` — three
   trees this lane cannot edit. Recorded as the concrete next step for
   whichever lane owns that integration pass.
3. **Ask Library single-controller enforcement across the shell boundary.**
   §4.2 fixes the Reader-local half (drawer ↔ RAG mutual exclusion within
   `ReaderShell`). The cross-mount half — the Reader's `RagChatPanel`
   vs. `AppShellRoot`'s `GlobalRagSidebar` (confirmed as two independent
   `useState` instances by the baseline audit, §3 of that document) —
   needs either a shared open/closed signal lifted into
   `ContextBarProvider` (or a sibling shell-level context) or the Reader
   route deferring entirely to the global sidebar instead of mounting its
   own. Either fix touches `components/shell/**`, which this lane cannot
   edit; recorded here so the integration pass has the exact mechanism
   (two independent `useState`s, not a deeper architectural problem) ready
   to act on rather than re-diagnosing it from scratch.

None of these three are silently dropped from charter scope — they are
Stage 4's own explicit instruction to defer, and this section is the
record the orchestrating task asked for.

---

## 10. Non-goals (this spec deliberately does not decide)

- Visual/token-level styling specifics (exact spacing, the "scholarly
  atlas" palette's application to new components) — charter §7 already
  fixes the palette; applying it is implementation-time work, not a
  decision this document needs to pre-make.
- Stage 5/6 (Research/Write) integration content — only the Home surface's
  fixed slots for their cards (§1.2 items 2–4) are decided here, since
  Home is inside this lane's file ownership even though the query logic
  for two of its four cards belongs to later stages.
- Any change to `packages/roadmap` or `packages/curriculum` themselves —
  both packages are read-only inputs to this spec; §6.2's "no item-to-item
  edges" finding is a documented data-shape fact, not a request to add one
  (adding real prerequisite edges would be a `graph_edge`/schema-level
  decision for a different phase, well outside a UI-redesign lane).
