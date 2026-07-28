# Stage 5 Research Integration Spec — Palimnote Signed-In Redesign

Binding implementation spec for Stage 5 (charter §15 "Stage 5 — Research integration"). Every decision below
is final for this stage; nothing is left "TBD." Where a decision touches a file outside this lane's ownership
it is called out explicitly as deferred/out of scope (§9) rather than silently assumed.

Sources read before writing this spec: charter §5 ("Research" capabilities), §6 ("Research" target IA), §15
Stage 5, §16 journeys 4 and 6 (`docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md`); baseline audit §3
(`docs/audits/ui-graph-redesign-baseline.md`); the Stage 1 shell/design-system spec
(`docs/design/redesign-shell-spec.md`, for the dialog/primitive house style and token map this stage reuses
unchanged); and direct reads of every `(app)/research/**` page, every `components/research/*.tsx` component,
`hooks/useResearchJobPolling.ts`, `lib/research/pipelineSteps.ts`/`pipeline.ts`/`chambers.ts`, the research API
routes under `app/api/research/**`, `components/primitives/useDialogEscape.ts`, and
`app/(app)/works/trash/PermanentDeleteDialog.tsx` (the existing hand-rolled accessible-dialog precedent). All
file:line references below are to the redesign worktree (`/private/tmp/palimnote-s5-research`) as of this
commit; re-derive if a cited line has since moved.

No new npm dependency is used anywhere in this spec, matching Stage 1's own decision (§5 there): the repo has
no headless-UI/Radix/react-aria package, and the one dialog this stage adds hand-rolls its focus trap/Escape
handling exactly like `PermanentDeleteDialog.tsx` already does, reusing the existing `useDialogEscape` hook
from `components/primitives` (a file this lane does not own but may import unchanged, like any other shared
primitive). No new CSS is needed either — every new surface below is built from existing Tailwind utilities and
the `--color-*`/`app-*` tokens and animation classes already used throughout `components/research/*`.

**File-ownership note governing every decision below:** this lane owns `app/(app)/research/**`,
`components/research/**` (existing files) and any new file under it, and `app/api/research/**` for additive
owner-scoped endpoints only. `lib/research/**` and `hooks/useResearchJobPolling.ts` are **not** in that
allowlist and are treated as read-only throughout this spec — every decision below is deliberately shaped to
require zero edits there (see §6 and §10 for the one place this constraint changed the design).

---

## 1. Current state — duplication and gaps confirmed by direct reads, not assumed

Grepped exhaustively (`grep -rn "\balert(\|\bconfirm(\|\bprompt("` across `app/(app)/research` and
`components/research`) before writing this section — the results below are the complete set, not a sample.

- **`window.prompt`: exactly one site.** `ResearchProjectsView.tsx:54`, `createProject()` — prompts for a
  project title, defaulting to `"Untitled research project"`.
- **`window.alert`: exactly five sites**, all in two files: `ResearchProjectsView.tsx:32` (archived-projects
  load failure), `:46` (restore-project failure), `:63` (create-project failure); `ResearchProjectOverview.tsx:189`
  (add-question failure), `:222` (add-member failure).
- **`window.confirm`: zero sites.** Every destructive action in the current research UI (`deleteMonitor`,
  `removeMember`, `deleteQuestion` in `MonitorsView.tsx`/`ResearchProjectOverview.tsx`) fires immediately on
  click with **no** confirmation step today — not a `window.confirm` being replaced, a confirmation step that
  never existed. Adding one is new scope the charter didn't ask this stage to add (its own instruction is to
  replace existing `prompt`/`alert`/`confirm` flows, not invent new ones), so it stays out of Stage 5 — flagged
  here rather than silently left unconsidered (§9).
- **Duplicated pipeline dispatch: exactly one real duplication, confined to one file.**
  `ResearchProjectOverview.tsx` renders `detect_relationships`/`cluster_debates` dispatch controls **twice**:
  once inside `<ResearchPipelineStepper>` (`ResearchPipelineStepper.tsx:92-114`, added by the Phase 30 gap-fix
  lane once real dispatchers existed) and again in the page's own "Research jobs" panel action row
  (`ResearchProjectOverview.tsx:478-540`), with two independently-maintained-but-identical
  `pendingConfirm`/`dispatching`/`dispatchError` record sets feeding both. `extract_claims` (per-work, from the
  Members list) and `synthesize_chamber`/`generate_hypotheses` (their own dedicated pages) are each dispatched
  from exactly one place already — the duplication is scoped to these two actions, in this one file.
- **Dense, horizontally-scrolling table: exactly one.** `grep -rn "<table" components/research app/(app)/research`
  finds a single `<table>`, in `ResearchClaimsTable.tsx:177` (`min-w-[720px]` inside an `overflow-x-auto` div).
  Every other list in every other research component (`CorpusView`, `MonitorsView`, `DebateClusterDetail`,
  `ResearchHypothesesView`, chamber positions) already renders as cards/`<li>` rows — no other component needs
  this stage's responsive-table work.
- **No persistent project navigation exists.** Each `/research/[projectId]/*` page independently renders its
  own `ResearchBreadcrumb` (`Research / <project title> / <current page>`) and, on the Overview page only, a
  row of quick-link buttons ("View claims", "View debates", "Hypotheses & gaps", "Corpus" —
  `ResearchProjectOverview.tsx:318-331`). There is no tab strip, and no route or query lets a user see "which
  section of this project am I in" without reading the breadcrumb's last segment.
- **No project-level Evidence Chambers view exists.** `lib/research/chambers.ts:205` already exports
  `listEvidenceChambersForProject(userId, projectId)` — built for the Phase 28.5 Writer evidence panel — but no
  page anywhere calls it. Only the permalink `/research/chambers/[chamberId]` exists.
- **No project-level Knowledge Map route exists.** The global `/graph` route is reachable only via the shell's
  primary nav, with no path from inside a research project.

## 2. Persistent project navigation

### 2.1 Mechanism: a new segment layout, not a shell change

`app/(app)/research/[projectId]/layout.tsx` (**new file**) wraps every route nested under `[projectId]`
(`page.tsx`, `corpus/`, `claims/`, `debates/` + `debates/[clusterId]/`, `hypotheses/`, `monitors/`, and the two
new routes in §3–§4). It is a server component that:

1. Calls `phase25FeatureEnabled("research")` and `notFound()`s if off — the same guard every page under it
   already repeats. This makes the guard redundant at the page level once the layout is in place, but existing
   per-page guards are **left in place, not stripped** — Next.js always executes `layout.tsx` before the child
   `page.tsx`, so the page-level checks become unreachable dead code, not incorrect code, and removing them
   would touch seven files for a purely cosmetic win outside this stage's actual charter scope. One extra
   indexed `getOwnedResearchProject` read per navigation is accepted for the same reason Stage 1 accepted a
   small amount of layered-fetch redundancy elsewhere in this app (Design Decisions precedent: per-route-level
   fetch, no cross-level dedup).
2. Calls `requireSession()` and `getOwnedResearchProject(session.user.id, projectId, true)` (the same helper
   every page already calls); `notFound()`s if the project isn't the caller's own or doesn't exist.
3. Computes `monitoringEnabled = phase25FeatureEnabled("monitoring")` server-side, to conditionally render the
   Monitors tab (§2.3) — Monitors is the one project-scoped section gated by a second flag beyond `research`.
4. Renders `<ResearchProjectNav projectId={project.id} monitoringEnabled={monitoringEnabled} />` immediately
   above `{children}`. Nothing else. No breadcrumb, no heading, no page chrome — every existing page keeps its
   own `<h1>` and its own `ResearchBreadcrumb` byte-for-byte unchanged (see §2.4 for why this is deliberate).

This is purely additive: no existing page component's internal markup changes because of the layout's
existence. The layout only adds one new landmark above whatever a page already renders.

### 2.2 `ResearchProjectNav.tsx` (new file, `components/research/`)

A client component (needs `usePathname()` for active-tab state) rendering a labeled `<nav>` of plain links —
not `role="tablist"`, because these are genuine route changes with genuinely different page content, not an
ARIA-tabs single-page pattern. This matches `ResearchBreadcrumb.tsx`'s own existing `<nav><ol>` idiom rather
than inventing a second navigation pattern in the same file family.

```tsx
const TABS = (projectId: string) => [
  { key: "overview", label: "Overview", href: `/research/${projectId}` },
  { key: "corpus", label: "Corpus", href: `/research/${projectId}/corpus` },
  { key: "claims", label: "Claims", href: `/research/${projectId}/claims` },
  { key: "debates", label: "Debates", href: `/research/${projectId}/debates` },
  { key: "chambers", label: "Evidence Chambers", href: `/research/${projectId}/chambers` },
  { key: "hypotheses", label: "Hypotheses", href: `/research/${projectId}/hypotheses` },
  { key: "monitors", label: "Monitors", href: `/research/${projectId}/monitors` }, // conditional, see below
  { key: "graph", label: "Knowledge Map", href: `/research/${projectId}/graph` },
];
```

- **Order** is exactly charter §6's list.
- **Active-state matching** is prefix-based per tab (`pathname === href` for Overview since every other tab's
  href is itself a prefix of Overview's; `pathname.startsWith(href)` for every other tab), so
  `/research/[id]/debates/[clusterId]` still highlights "Debates" and `/research/[id]/monitors` (project-scoped)
  highlights "Monitors" without also matching the global `/research/monitors`.
- **`aria-current="page"`** on the active tab (matches `ResearchBreadcrumb`'s own convention exactly).
- **Monitors tab is omitted entirely** (not rendered disabled — omitted) when `monitoringEnabled` is `false`,
  the same "a feature flag is a release control, hide the door rather than show a locked one with no
  explanation" posture already used elsewhere in this codebase for flag-gated nav.
- **Styling:** `app-control app-press`, `min-h-11` (44px floor, Stage 1 §7 rule), `text-sm` (14px, sentence
  case — never uppercase, matching Stage 1's own corrected `NavLink` precedent), `flex flex-wrap` (no
  `overflow-x-auto`, no horizontal scroll) so the eight (or seven, with Monitors hidden) short labels wrap to a
  second row at narrow widths instead of requiring a scroll gesture — this is nav, not dense data, so the
  charter's "no unexplained horizontal scroll" instruction is honored by wrapping rather than by needing a
  scroll affordance at all.
- **Active tab visual treatment** reuses the existing `--color-rail-active-bg`/focus-ring pairing precedent from
  Stage 1's `WorkspaceRailItem.tsx` (fill, never border-only, per that spec's own binding contrast rule) rather
  than inventing a new active-state token.

### 2.3 Removing the now-redundant quick-link row

`ResearchProjectOverview.tsx`'s own "View claims" / "View debates" / "Hypotheses & gaps" / "Corpus" button row
(lines 318-331) is **removed**. With the persistent nav now present on every project page including Overview,
this row is a second way to reach the exact same four destinations — the charter's "remove duplicated
pipeline/job actions" instruction is explicitly about actions, but its underlying principle (one canonical way
to do a thing) applies just as directly to navigation, and leaving the row in place would create a literal
accessible-name collision ("Corpus" as both a nav-tab link and a quick-link button on the same page). No e2e
test asserts on this row by role/name (`grep -n '"View claims"\|"View debates"\|"Hypotheses & gaps"'
apps/web/e2e/*.spec.ts` finds only heading assertions on the destination pages themselves, never a click
through these specific buttons), so removing it is test-safe.

### 2.4 Why every page keeps its own heading and breadcrumb unchanged

An alternative design would hoist the project title into the layout as a single shared `<h1>`, demoting each
page's own heading to `<h2>` and simplifying every page's breadcrumb to no longer repeat the project name.
Rejected: it touches the DOM structure of all seven existing pages for a marginal DRY win, and several e2e
tests assert on the *exact current* heading text per page (e.g. `research.spec.ts`'s
`getByRole("heading", { name: "Detect relationships project" })` — the Overview page's own `<h1>` — versus
`getByRole("heading", { name: "Claims" })` on the claims page, `getByRole("heading", { name: "Corpus", exact: true })`
on the corpus page, and so on). The current pattern (page-specific `<h1>`, project name only in the breadcrumb
below it) is already correct and already exercised; the persistent nav is purely additive on top of it, which
is the lowest-risk way to satisfy the charter's "persistent project navigation" requirement without weakening
any existing test.

## 3. Evidence Chambers project view

**New file:** `app/(app)/research/[projectId]/chambers/page.tsx`, styled and structured identically to the
existing `debates/page.tsx` (plain server component, no client interactivity needed — this is a read-only
list). Calls the already-existing `listEvidenceChambersForProject(session.user.id, projectId)` — **no new
query, no new table, exactly as the charter's own wording requires** ("a new project-level presentation route
or view over the existing owner-scoped chamber records; it does not imply a new table"). Each row links to the
existing, unchanged `/research/chambers/[chamberId]` permalink. Empty state: "No evidence chambers yet — open a
debate and synthesize one, or generate hypotheses that resolve to one." Verification-status and hidden state
render as the same small chip vocabulary `ResearchClaimsTable.tsx`/`DebateClusterDetail.tsx` already use, for
one consistent visual vocabulary across the workspace.

`/research/chambers/[chamberId]` itself is **unchanged** — it lives outside the `[projectId]` route segment
(`app/(app)/research/chambers/[chamberId]/page.tsx`, not `app/(app)/research/[projectId]/chambers/[chamberId]/page.tsx`),
so it does not inherit the new layout's tab strip. This is deliberate, not an oversight: a chamber permalink is
reachable from a debate cluster, from a hypothesis's sources, or from the Writer evidence panel — contexts that
don't always carry a "current project" the way a `/research/[projectId]/*` route does — and the charter's own
instruction is only to preserve this permalink, not to fold it into the project shell.

## 4. Knowledge Map stub tab

**New file:** `app/(app)/research/[projectId]/graph/page.tsx`. Per this lane's own explicit instructions
("DEFERRED to integration: project Knowledge Map tab, contextual-graph journey ends"), this is an honest stub,
not a functional contextual graph:

- A short explanation: "A Knowledge Map scoped to this project's own claims and works is planned for a later
  integration stage. Open the full Knowledge Map below."
- A single link to `/graph` (the existing global route, entirely untouched by this lane — `knowledge-map/**`
  and `graph/**` are both outside this lane's ownership).
- No query-string scoping attempt, no partial filter — an honest "not built yet" rather than a half-working
  approximation, matching this app's own established "every loading, empty, unavailable... state must explain
  what happened and what the user can do" rule (charter §7) applied to a feature stage boundary rather than a
  runtime state.

This keeps the tab real (it's a genuine route inside the project shell, so the nav's active-state and
`aria-current` logic doesn't need a special case for it) while being completely honest that the *contextual*
version doesn't exist yet.

## 5. `window.prompt`/`window.alert` replacement

### 5.1 The one dialog: `CreateResearchProjectDialog.tsx` (new file, `components/research/`)

Replaces `ResearchProjectsView.tsx:54`'s `window.prompt`. Modeled directly on
`app/(app)/works/trash/PermanentDeleteDialog.tsx` — the existing, already-tested hand-rolled dialog pattern —
reusing `useDialogEscape` from `components/primitives` for the Escape-closes behavior (that hook is a shared
primitive this lane may import unchanged) and hand-rolling the same Tab-cycle focus trap
`PermanentDeleteDialog.tsx` already implements inline (no new focus-trap utility needed; copying ~20 lines of
already-working, already-reviewed logic is preferable to extracting a shared hook outside this lane's file
ownership).

- **Trigger:** the existing "New project" button in `ResearchProjectsView.tsx`, unchanged in appearance/label.
- **Fields:** one labeled text input, "Project title," pre-filled with `"Untitled research project"` (the
  current prompt's own default — unchanged behavior).
- **Inline validation:** the Create button is `disabled` while the trimmed title is empty (today's
  `if (!title?.trim()) return;` silent no-op becomes a visible, explained disabled state — a strict UX
  improvement with identical underlying rule).
- **Initial focus:** the title input itself (not a "Cancel"-style safe default) — this is a creation flow, not
  a destructive-confirmation flow, so `PermanentDeleteDialog`'s "focus lands on the non-destructive control"
  rule correctly translates to "focus lands on the field the user is about to type into."
- **On submit failure:** the error renders **inside the still-open dialog** (a `<p>` below the field, the same
  `text-[var(--color-error,#b3261e)]` treatment used everywhere else in this component family) instead of a
  blocking `window.alert` — the dialog stays open with the typed title preserved, satisfying "recoverable error
  states" literally: nothing typed is lost, and retry is a matter of clicking Create again, not re-invoking the
  whole flow.
- **On success:** identical to today — `window.location.assign(`/research/${project.id}`)`, a full navigation
  so the new project's page renders with fresh server-fetched data. Not "fixed" to a `router.push`, since that
  navigation-strategy choice is unrelated to the prompt/dialog replacement this stage is scoped to.
- **Focus restore:** the caller (`ResearchProjectsView.tsx`) stores the trigger button via
  `event.currentTarget` in a ref when opening and calls `window.requestAnimationFrame(() => trigger?.focus())`
  on close — the exact idiom `TrashView.tsx`'s `openPurgeDialog`/`closePurgeDialog` already establishes for
  `PermanentDeleteDialog`, reused verbatim rather than reinvented.

### 5.2 The five `window.alert` sites: inline recoverable error text, no dialog

The charter's own wording lists three remediation tools conjunctively — "accessible dialogs, inline validation,
and recoverable error states" — not "wrap every alert in a modal." A transient fetch-failure message (load
archived projects failed; restore failed; add-question failed; add-member failed) is a **recoverable error
state** in the charter's own vocabulary, and every other error path in these same two files already renders
exactly this way (`ResearchProjectOverview.tsx`'s existing `dispatchError`/`editError`/`extractError` inline
`<p>` tags, `CorpusView.tsx`'s `searchError`/`importError`). The five `window.alert` calls are the *only*
exceptions to that file's own established convention — fixing them to match their own file's dominant pattern
is the correct, minimal, and most consistent remediation, not an under-delivery relative to "accessible
dialogs":

- `ResearchProjectsView.tsx`: add `archiveError`/`restoreError` local `useState<string | null>`; render each as
  an inline `<p>` immediately below the "Show archived projects" button / inside the relevant archived-project
  `<li>`, replacing `window.alert(...)` 1:1. `createProject()`'s own failure path moves into the new dialog
  (§5.1) rather than staying a page-level alert, since it's already inside that flow.
- `ResearchProjectOverview.tsx`: add `questionError`/`memberError` local `useState<string | null>`; render each
  inline below its respective form (Questions / Members), replacing `window.alert(...)` 1:1.

No component gains a new dialog for these five sites; all five become inline text using patterns that already
exist, verbatim, elsewhere in the same files.

## 6. One canonical research-pipeline action/status surface

**Decision: the "Research jobs" panel (`ResearchProjectOverview.tsx`) is the canonical surface. The pipeline
stepper becomes pure status display.**

This choice is deliberately the one that requires **zero edits to `lib/research/pipelineSteps.ts`**, which
this lane does not own (see the ownership note in the preamble) — the alternative (make the stepper canonical,
strip the jobs-panel's own action row) would need `computeResearchPipelineSteps()` to grow a `jobsHref` so the
stepper's message could link down to wherever the action moved, a `lib/research/**` edit outside this lane's
allowlist. Keeping the Jobs panel canonical needs no such change: `pipelineOverview.workCountWithClaims`/
`relationshipCount` (already read directly by the Jobs panel's own `detectReady`/`clusterReady` computation,
`ResearchProjectOverview.tsx:481-482`) are enough on their own, and every existing e2e assertion on these two
actions already targets `main(page).getByRole("region", { name: "Research jobs" })` specifically
(`research.spec.ts`'s three detect/cluster dispatch tests, confirmed by direct read — none of them ever
targets the stepper's own button), so this is also the zero-test-risk direction.

Concretely:

- **`ResearchPipelineStepper.tsx`** drops its `onDispatch`/`actionState` props and the button/pendingConfirm/
  error JSX block entirely (lines 92-114 of the current file). What remains: the four-step status list
  unchanged, and `nextAction.message` (plus its existing `href` for the `extract`/`synthesize` steps only, both
  of which already had a link and neither of which is touched) rendered as **plain informational text** for the
  `detect`/`cluster` steps — no button. `PipelineDispatchableAction`/`PipelineActionState` type exports stay in
  this file even though the stepper's own render logic no longer consumes them, because
  `ResearchProjectOverview.tsx` still imports and uses both for the Jobs panel's own action state — relocating
  them is optional polish, not required, and left as-is to minimize file churn.
- **`ResearchProjectOverview.tsx`** changes exactly one call site:
  `<ResearchPipelineStepper result={pipelineResult} onDispatch={dispatchPipelineAction} actionState={...} />`
  becomes `<ResearchPipelineStepper result={pipelineResult} />`. Nothing else in this file changes for this
  item — `dispatchPipelineAction`, `pipelineActionState`, and the Jobs panel's own action row (lines 478-540)
  are already the correct, sole surviving surface and need no edits.
- The stepper sitting directly above the Jobs panel in the page's existing layout means the "next action"
  message a user reads in the stepper is still immediately followed, a few pixels below, by the one real
  control that acts on it — no discoverability is lost, only the second, redundant control is.

This satisfies the charter's "Remove duplicated pipeline/job actions. One canonical action displays real
queued/running/completed/failed progress and next steps" instruction exactly: one action per job type, one
place its confirmation/error state lives, the full job history (`JobStageProgress` per row, including past
completed/failed runs) already only ever lived in the Jobs panel in the first place.

## 7. Responsive claims/evidence review

`ResearchClaimsTable.tsx` is the only dense table in research code (§1). Filters (`workId`, `claimNature`,
`anchorState`, `verificationStatus` selects) and pagination stay exactly as they are — already labeled,
already control→state→output wired, already satisfy the app's own "every filter control wires to state and
output" standard, and the charter's Stage 5 bullet list doesn't ask for a filter-chip redesign (that's a
broader, cross-workspace Stage 7/site-wide concern per charter §7, not scoped to this stage — pulling it in
here would be scope creep beyond what Stage 5 is gated on).

**Decision: dual render, CSS-toggled by breakpoint, matching the charter's literal "under 768px" threshold.**

```tsx
<div className="hidden md:block overflow-x-auto">
  {/* existing <table>, unchanged, min-w-[720px] dropped in favor of natural
      shrink + a `truncate` on the Claim cell — see below */}
</div>
<ul className="md:hidden ...">
  {/* same result.claims data, one <li> "card" per claim */}
</ul>
```

- `md:` is Tailwind's 768px breakpoint, matching the charter's own stated threshold exactly.
- The `<table>`'s `min-w-[720px]` is **removed** (not just hidden below 768px): between 768px and roughly
  1023px, a 232px expanded rail plus content padding can leave less than 720px of actual table width, which
  would still force the exact horizontal scroll the charter is asking to eliminate even one pixel past the
  "cards" cutoff. Dropping the fixed min-width and adding `truncate` (with the full text still in a `title`
  attribute) to the Claim-text cell lets the table degrade by truncating instead of forcing a scrollbar — a
  strict improvement with no behavior change above ~1024px, where the table already had more than enough room.
- The card list (`md:hidden`) renders one `<li>` per claim with: the claim text (untruncated — cards have full
  vertical room, unlike a table cell), work/corpus-item title, a small chip row (nature, "from abstract" when
  applicable, anchor state, verification status — the same label vocabularies the table's `<td>`s already use,
  just restacked), and the same `Link` to the claim's permalink. This mirrors the card shape every *other*
  research list in the app already uses (`CorpusView`'s imported-item cards, `MonitorsView`'s hit cards) rather
  than inventing a new card layout for this one component.
- Loading/empty states (`role="status"` loading text, the "No claims match these filters yet" empty message)
  render once, above both the table and the card list, exactly as today — no duplication needed there since
  neither is data-shaped.
- Pagination controls render once, below both, unchanged.

No other component needs this treatment (§1 confirmed only one `<table>` exists); "evidence" in the charter's
"claims/evidence" phrasing refers to claims themselves being the evidence unit reviewed here, not a second,
separate dense table this codebase doesn't have.

## 8. Correction flows — preserved as-is, no changes

`ResearchCorrectionControls.tsx` (verify/dispute/hide/restore + `RevisionHistoryDrawer`) and
`ClaimCorrectionExtras.tsx` (claim-only edit/reclassify/split/merge) already satisfy every part of the charter's
requirement for this journey: provenance and revision history are visible (`RevisionHistoryDrawer`'s diff view,
composed on every correctable object type), corrections route through one server-side mutation path
(`applyResearchCorrection`, per the Phase 29.2 changelog entry — confirmed by reading the routes these
components call), reason capture exists for disputes, excerpt-substring re-validation on claim edits is already
implemented and already surfaces its own honest "now unanchored" notice, and every control already meets the
44px touch-target floor outside of the deliberately-exempted dense secondary regions (`data-dense-controls`,
already documented in-repo). Nothing here needs to change for Stage 5 — verified by direct read, not assumed
from the charter text alone, precisely because "don't touch what's already correct" is itself a real decision
worth recording rather than a silent no-op.

## 9. File plan

**New files:**

| File | Purpose |
|---|---|
| `app/(app)/research/[projectId]/layout.tsx` | Ownership/flag guard + renders `ResearchProjectNav` above `{children}` (§2.1) |
| `components/research/ResearchProjectNav.tsx` | Persistent project tab strip (§2.2) |
| `app/(app)/research/[projectId]/chambers/page.tsx` | Project-level Evidence Chambers list, reuses `listEvidenceChambersForProject` (§3) |
| `app/(app)/research/[projectId]/graph/page.tsx` | Honest Knowledge Map stub linking to `/graph` (§4) |
| `components/research/CreateResearchProjectDialog.tsx` | The one dialog, replacing `window.prompt` (§5.1) |

**Modified files:**

| File | Change |
|---|---|
| `components/research/ResearchProjectsView.tsx` | Swap `window.prompt`/3× `window.alert` for the new dialog + 2 inline error states; remove-nothing-else (§5) |
| `components/research/ResearchProjectOverview.tsx` | Swap 2× `window.alert` for inline error states (§5.2); remove quick-link button row (§2.3); drop 2 props from the `<ResearchPipelineStepper>` call (§6) |
| `components/research/ResearchPipelineStepper.tsx` | Drop `onDispatch`/`actionState` props and their JSX (§6) |
| `components/research/ResearchClaimsTable.tsx` | Add `md:hidden` card list alongside the existing (now `hidden md:block`, min-width-dropped) table (§7) |

**Explicitly not touched:** every other file under `components/research/` (`ClaimCorrectionExtras.tsx`,
`CorpusView.tsx`, `DebateClusterDetail.tsx`, `JobStageProgress.tsx`, `LiveAnnouncer.tsx`, `MonitorsView.tsx`,
`ResearchBreadcrumb.tsx`, `ResearchCorrectionControls.tsx`, `ResearchHypothesesView.tsx`); every existing
`(app)/research/[projectId]/*/page.tsx` and `debates/[clusterId]/page.tsx` (the new layout wraps them with zero
internal changes, §2.1/§2.4); the two permalink pages (`research/claims/[claimId]/page.tsx`,
`research/chambers/[chamberId]/page.tsx`, §3); `research/page.tsx` and `research/monitors/page.tsx` (the
top-level project list and global monitors view, both already outside the `[projectId]` segment and structurally
fine as-is); `lib/research/**`, `hooks/useResearchJobPolling.ts`, `app/api/research/**` (no new endpoint is
needed anywhere in this spec — every new page reads through an existing server-side query function, and every
existing dispatch/correction route is reused unchanged).

## 10. Affected e2e specs

- **`research.spec.ts`**
  - `"creates a project, adds questions and a work member, and dispatches claim extraction"` — currently
    `page.once("dialog", (dialog) => dialog.accept("Vice and akrasia"))` around the "New project" click; must
    change to: click "New project", wait for `page.getByRole("dialog", { name: /New research project/i })`,
    fill the title field, click "Create" — the same `getByRole("dialog", ...)` idiom `trash.spec.ts` already
    uses for `PermanentDeleteDialog` (§5.1).
  - The three detect/cluster dispatch tests (`"dispatches relationship detection..."`,
    `"relabels the detect button..."`, `"dispatches debate clustering..."`) already scope every assertion to
    `main(page).getByRole("region", { name: "Research jobs" })` and never touch the stepper — **no change
    needed**, confirmed by direct read (§6's whole rationale for choosing this direction).
  - `"axe: zero wcag2a/wcag2aa violations across the new research pages, light and dark"` — extend to cover the
    two new routes (`/research/[projectId]/chambers`, `/research/[projectId]/graph`) and, ideally, one
    representative existing sub-route with the new persistent nav mounted (e.g. `/research/[projectId]/corpus`)
    to prove the nav itself introduces zero violations, light and dark.
  - New assertions needed: the persistent nav's presence and `aria-current` correctness across at least one
    project route; the removed quick-link row's absence on Overview; the Monitors tab's absence when
    `monitoring` is off vs. present when on.
- **`research-corpus.spec.ts`** — unaffected functionally (Corpus page content unchanged), but its two
  `getByRole("heading", { name: "Corpus", exact: true })` assertions now co-exist with a nav tab also labeled
  "Corpus" — `exact: true` on a **heading** role query already disambiguates from a **link** role, so no change
  is required, but worth a smoke-check during implementation given how easy an accidental role/name collision
  is to introduce (§2.3's whole reason for removing the quick-link row was resolving exactly this class of
  collision).
- **`research-corrections.spec.ts`, `research-hypotheses.spec.ts`, `research-monitors.spec.ts`,
  `research-chambers.spec.ts`, `research-dashboard.spec.ts`** — no functional change to the components these
  exercise; unaffected.
- **New spec (or a new `test.describe` block inside `research.spec.ts`) needed for:**
  - The Evidence Chambers project view: seeded chamber(s) render, link to the correct permalink, empty state
    when none exist.
  - The Knowledge Map stub: renders the honest explanation and a working `/graph` link, does not attempt a
    contextual filter.
  - `CreateResearchProjectDialog` itself, independent of the "creates a project..." integration test above:
    Escape closes it and restores focus to the "New project" trigger; Tab cycles only within the dialog
    (`PermanentDeleteDialog`'s own existing focus-trap test is the direct precedent to mirror); Create stays
    disabled for an empty/whitespace-only title; a simulated API failure shows the inline error with the
    dialog still open and the typed title still present.
  - Responsive claims: at a `<768px` viewport, the table is not in the accessibility tree
    (`toHaveCount(0)` or `not.toBeVisible()`) and the card list is; at `>=768px`, the reverse — reusing this
    suite's own existing `seedResearchClaimsFixture` fixture rather than a new one.

## 11. Stage 5 gate mapping

Charter §15's Stage 5 gate: *"Project → corpus → claim correction → relationship → debate/chamber → contextual
graph journey passes with real state and provenance."* Read literally, "contextual graph" here means "the user
can get from a research object to the graph in context," not "a graph pre-filtered to this project" — per this
lane's own explicit instruction that contextual-graph filtering is deferred to integration. The journey this
spec enables end to end: create a project (dialog) → add a work → import/search a corpus item (unchanged) →
extract claims → correct a claim (unchanged, §8) → detect a relationship (single dispatch surface, §6) → open
its debate → synthesize/view its Evidence Chamber (now reachable two ways: the cluster page's existing button,
and the new project-level Chambers tab, §3) → follow the new Knowledge Map tab to the honest stub and its link
into `/graph` (§4). Every step after project creation already exists and is provenance-correct (§8); this
stage's job was navigational and duplication cleanup around an already-correct data layer, not new data-layer
work — which is exactly what §1's audit found and every section above addresses.

## 12. Stage boundary — what Stage 5 does NOT touch

- **Contextual (project-scoped) Knowledge Map** — explicitly deferred to integration (§4), per this lane's own
  instructions. The stub tab exists; the filtering does not.
- **`lib/research/**`, `hooks/useResearchJobPolling.ts`** — read-only throughout. Every decision above was
  deliberately shaped to need no change here (§6 in particular).
- **Adding confirmation dialogs to destructive actions that never had `window.confirm` in the first place**
  (`deleteMonitor`, `removeMember`, `deleteQuestion`) — noted in §1 as an observed gap, but out of this stage's
  mandate, which is to replace existing `prompt`/`alert`/`confirm` flows, not add new confirmation UX the app
  never had. Left for the owner or a later hardening pass to decide on purpose, not silently fixed or silently
  ignored.
- **Filter-chip / saved-view redesign for the Claims filters** — charter §7's site-wide "active-filter chips"
  language is a broader, cross-workspace concern; the four existing `<select>` filters are already correctly
  wired and accessible, and redesigning their presentation isn't in Stage 5's own bullet list (§7 above records
  this decision explicitly rather than silently expanding scope).
- **`/research/monitors` (global) and `/research/page.tsx` (project list)** — both sit outside the
  `[projectId]` segment this stage's nav work targets, and neither has a duplication, dialog, or table problem
  of its own (§1). Untouched.
- **`shell/**`, `knowledge-map/**`, `graph/**`, `reader/**`, `writer/**`, `globals.css`, `packages/**`,
  `e2e/helpers.ts`** — outside this lane's ownership by the program's own binding rules; nothing in this spec
  requires touching any of them.
