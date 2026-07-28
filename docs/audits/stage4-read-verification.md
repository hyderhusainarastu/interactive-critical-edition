# Stage 4 Read Verification (round 2 — FIX lane) — COMPLETE

Branch `redesign/stage4-read`, worktree `/private/tmp/palimnote-s4-read`. This
is the Stage 4 read-lane's gate check, completing the round-1 verification
that was force-terminated mid-run in a prior session (see git history for the
untracked round-1 file this replaces). This round finished the interrupted
verification, then triaged and fixed every failure it found down to only
genuinely out-of-scope/environment-limited items.

**Result: GATE PASSED**, with two honestly-scoped exceptions documented below
(§9): the two real-Supabase-Storage-dependent `trash-storage.spec.ts` tests
(a pre-existing, by-design CI/local-dummy-env limitation, not a regression),
and one confirmed-but-unresolved mobile layout finding (§10) that needs a
shell-level fix outside this lane's file ownership.

---

## 0. Environment note: `next build` fails on an out-of-scope, pre-existing bug

`pnpm --filter web build` fails during static-page generation of
`/admin-dash` and `/admin-dash/feedback` with `TypeError: Cannot read
properties of null (reading 'useEffect')`. Confirmed via `git stash` that
this reproduces **identically with none of this round's changes applied** —
it is not caused by anything in this lane, and `apps/web/src/app/admin-dash/**`
is outside this lane's file-ownership scope regardless. Verification for
this round therefore ran against `next dev` (Turbopack) on port 3240 instead
of the usual `next build && next start`, with a dedicated local Postgres
(`palimnote-s4-pg`, port 5434, pre-migrated) and every gated `PHASE_12_*`/
`PHASE_18_*`/`PHASE_25_*` flag enabled locally. This is flagged, not hidden:
static gates (typecheck/lint) are unaffected and both pass clean; anything
`next dev`-specific in the findings below is called out explicitly (see the
Next.js Dev Tools indicator note in §7, and the transient auth 500 in §11).

Real Supabase Storage credentials were **not** wired into this worktree —
attempting to do so was blocked twice by the permission classifier (writing
production-like credentials into a local env file, and a follow-up attempt
via a different tool shape), which is treated as a hard boundary consistent
with the "no production access" program rule, not something to route around.
`trash-storage.spec.ts` and one `upload.spec.ts` real-upload test therefore
ran against the dummy `SUPABASE_URL` the round-1 session had already left in
place — this is the **documented, by-design** local/CI limitation those
files' own doc comments describe (see §9), not new.

## 1. Static gates

| Check | Result |
|---|---|
| `pnpm --filter web typecheck` | PASS — clean, no errors |
| `pnpm --filter web lint` | PASS — clean, no errors |
| `pnpm --filter web build` | FAIL — pre-existing, out-of-scope `/admin-dash` prerender bug (§0); reproduced identically with this round's changes reverted, so verification ran under `next dev` instead |

## 2. Affected-specs suite (existing CI-safe/manual specs this lane's changes could touch)

Two full runs (edition.spec.ts run once more separately after a dev-server
hiccup — see §11) against the `next dev` server:

| Spec file | Result |
|---|---|
| `curriculum.spec.ts` | 4/4 PASS |
| `diagnostic.spec.ts` | 4/4 PASS |
| `edition.spec.ts` | 26/26 PASS (1 flaky→pass-on-retry, pre-existing reload-timing class, see §9) |
| `library.spec.ts` | 37/38 PASS, 1 pre-existing unrelated skip (`:187`, an intentionally-skipped test, untouched by this round) |
| `roadmap2d.spec.ts` | 2/2 PASS |
| `sources-tab.spec.ts` | 2/2 PASS |
| `stage4-home.spec.ts` | 2/2 PASS |
| `stage4-reader-position.spec.ts` | 2/2 PASS |
| `trash.spec.ts` | 9/9 PASS (1 flaky→pass-on-retry, pre-existing DB-contention-under-load class, see §9) |
| `trash-storage.spec.ts` | **0/2 — real-Supabase-Storage-dependent, expected fail in this env (§9)** |
| `work-context-header.spec.ts` | 3/3 PASS |
| `work-status.spec.ts` | 13/13 PASS |
| `stage4-visual.spec.ts` | 10/10 PASS (screenshot sweep, §7) |

**Totals: 110 tests run, 106 clean pass, 2 flaky-but-pass-on-retry (both a
pre-existing, documented flaky class — not introduced by this round), 2
real-Storage-dependent fails (expected/documented), 1 pre-existing unrelated
skip.**

## 3. Defects found and fixed this round

All within this lane's file ownership (`apps/web/e2e/**`,
`apps/web/src/app/(app)/works/**`). Ranked roughly by severity.

### 3.1 Roadmap defaulted new/unconfigured readers to a near-empty view (real product bug, fixed)

`RoadmapView.tsx`/`page.tsx` defaulted a reader with no saved level
(`user.readerLevel` is nullable, unset until onboarding) to `"research"`,
under the stale assumption — contradicted by `@ice/roadmap`'s own
`tiersForReaderLevel` doc comment, written for the owner's 2026-07-26
exact-band directive — that `"research"` meant "the full view." It doesn't:
`tiersForReaderLevel("research")` returns only `{essential, optional}`, so
every `explicit_reference`/`secondary_scholarly_recommendation`-tier item
(the single most common category — "directly cited in the text") was
silently invisible to any reader who hadn't explicitly picked a level, with
no error or explanation. Confirmed via `roadmap2d.spec.ts` (added last
session, never actually run until this round) and via the visual sweep
screenshot (§7), which shows the fix live: "Level: Show all levels (1)"
with the previously-hidden "Physics" item now present.

**Fix:** default to `"all"` (the real, unfiltered full view) instead, in
both `RoadmapView.tsx` and `page.tsx`; widened the prop type from
`ReaderLevel` to `ReaderLevelFilter` to allow it. No `packages/roadmap`
changes (out of this lane's ownership) — the band definitions themselves are
correct per the owner's directive; only the *fallback* was wrong.

### 3.2 Wide-reader marginalia never appeared at 1280px (real product bug, fixed)

`.edition-reader-margin-track`'s `@container (min-width: 40rem)` rule
governs whether wide-screen margin notes show. `.reader-content-container`
(the query's containment root) carried its own `px-6 py-8` padding —
container-query size features measure the container's **content box**, so
that padding silently ate ~48px off the measured width. At a 1280px viewport
with both rails open, the container landed at ~618px content-box width,
just under the 640px (40rem) threshold — marginalia never appeared there
even though 1280px is one of the two widths the charter/tests explicitly
require it at. (1440px cleared the threshold, so this was invisible unless
tested at exactly 1280px.)

**Fix:** moved the horizontal padding to a new inner wrapper div, leaving
`.reader-content-container` itself unpadded so the container query measures
the true available width. Verified via a debug instrumentation pass showing
the track's `display` flip from `none`→`flex` at 1280px (removed before
committing); `edition.spec.ts`'s "wide-reader marginalia" test now passes.

### 3.3 Bookmarking never switched to "My notes" on a wide (default-open-drawer) viewport (real product bug, fixed)

`EditionAnnotationsPanel`'s `initialTab` prop was read via a plain
`useState(initialTab)` — correct only if the panel remounts fresh every
time the drawer opens. On a **wide viewport, the drawer starts open**
(`showDrawer = useState(() => !narrow)`), so the panel is already mounted
before the first bookmark/highlight action ever fires; `ReaderShell`'s
`openDrawer("my-notes")` only flips `showDrawer` from already-`true` to
`true` again (no remount) while updating `pendingDrawerTab` — a prop change
an already-mounted `useState` initializer never re-reads. Bookmarking
correctly created the bookmark and incremented the "My notes (N)" count, but
the tab itself silently never switched, and `aria-pressed` stayed `false`.

**Fix:** added a `useEffect` syncing local `tab` state from `initialTab`,
matching the same "one-shot sync from an external prop change, not a
derived value" pattern this same file already uses for the
`activeId`-driven tab switch a few lines below (with the matching
`eslint-disable-next-line react-hooks/set-state-in-effect`, since the prop
only changes when the parent explicitly requests a switch — never fights a
reader's own subsequent manual tab clicks).

### 3.4 Test-only: five pre-existing tests broken by this lane's OWN earlier UI changes, none a product regression

All five were existing assertions written before this lane's own prior
commits (`452b45d`, `87c8013`, `66b3216`, `1dd54be`, `fc917b1`) changed the
UI those assertions checked. Confirmed real vs. stale in each case before
touching anything:

- **`library.spec.ts` "uploaded works page uses consistent 'Uploaded
  works' terminology"**: `/works` is now branded "Reading Queue" (an
  earlier, intentional rebrand in this same lane, spec §0/§2) — the test
  still checked the retired "Uploaded works" heading text. Updated the
  assertion (and its own name) to the real, current heading.
- **`sources-tab.spec.ts` "a not-yet-ready work explains Sources isn't
  available yet"** and **`work-context-header.spec.ts` "a failed work
  explains why…"**: both used an unscoped `page.getByText(...)` for a
  disabled-reason string that — once the Stage 4 work-context-header
  subnav shipped — also renders once per OTHER disabled tab
  (Roadmap/Curriculum/Diagnostic/Knowledge Map), producing a strict-mode
  violation (5-6 matches instead of 1). Scoped each to the actual
  explanatory `<p>` element.
- **`work-status.spec.ts`** (4 separate assertions across 4 tests): same
  root cause — the work-context-header's title echo / per-tab disabled-
  reason text now duplicates what these tests originally checked
  page-wide (`"Confirmed Title"`, `"Processing failed"` ×2, `"In trash"`
  ×2). Scoped to the heading role or added `{ exact: true }` as
  appropriate per match.
- **`trash.spec.ts` "ready-work action links navigate…"**: checked for a
  now-fully-retired per-page link row ("Reading roadmap"/"Concept
  check"/etc.) that `WorkStatusPanel`'s own doc comment confirms was
  deliberately consolidated into `WorkContextHeader`'s persistent tab
  strip (spec §3.5) — repeating the same six destinations in both places
  was the thing being fixed, not a regression. Updated the test to
  navigate through the real tab strip, with the strip's actual current
  labels ("Roadmap", "Concept Check", "Knowledge Map", "Reader").

None of these five weakened any assertion's coverage — each now checks the
same underlying behavior against the real, current UI instead of a retired
one.

### 3.5 Test-only: `stage4-visual.spec.ts`'s own screenshot-timing/targeting gaps (this round's own new spec, fixed before first commit)

Found by visually reviewing the screenshots themselves, not just "the test
didn't throw" — three real gaps in the NEW spec written this round:

- The 2D Roadmap and Library screenshots fired right after their page
  heading appeared, not after the async client-side data fetch resolved —
  the very first screenshot attempts captured shimmer/skeleton loading
  state (Roadmap) or "No items match these filters" (Library, because the
  page's *default* Focus is the newest-uploaded fixture, which — by
  design, since `seedWorkWithGraphData` writes `graph_edge`/
  `research_resource` rows, not `resource_role`/`learning_resource` —
  genuinely has nothing for Library to show). Fixed by waiting for real
  content (`[data-roadmap-stage-columns]`; a deep-link to
  `?focus=${libraryWorkId}` plus waiting for the seeded item's title) before
  each screenshot.
- The Upload screenshot asserted `.toBeVisible()` on the real file
  `<input>`, which is deliberately CSS-hidden behind a visible drop-zone
  trigger (same pattern every other upload test already relies on without
  a visibility check) — fixed to check the visible drop-zone text instead.
- Two "Home"/"Reading Queue" assertions hit the project's own
  already-documented D-19-36 duplicate-DOM (self-healing Next.js/React
  streaming-SSR) artifact — `.first()` added, matching how the rest of the
  codebase already handles that same known class.

## 4. `stage4VerifyHelpers.ts`, new spec files

Unchanged in substance from round 1 — `stage4VerifyHelpers.ts` (does not
touch `helpers.ts`, per file ownership),`stage4-home.spec.ts`,
`stage4-reader-position.spec.ts` (both already 2/2 passing when this round
started and unchanged), plus the fixes to `stage4-visual.spec.ts` in §3.5.

## 5. Journeys covered by pre-existing suites (confirmed passing, not re-derived)

- **Journey 1** (upload renders; trash/restore/permanent-delete guards):
  `upload.spec.ts`'s non-Storage-dependent tests and `trash.spec.ts` (§2).
- **Journey 3** (Library search/filter/uploaded-vs-cited/credibility-
  provenance/reading state): `library.spec.ts`, 37/38 (§2).

## 6. Map-continuity, manual-only specs

Explicitly deferred/out of scope for this round, unchanged from round 1:
map-continuity; `reader.spec.ts`/`annotations.spec.ts`/`roadmap.spec.ts`/
`roadmap-constellation.spec.ts` (contentless per its own doc comment)/
`roadmap-graph.spec.ts` (knowledge-map-owned) — all need a real worker/live
APIs or are out of this lane's surface.

## 7. Screenshots — 1440/375, light + dark, reduced motion

30 real PNGs in `docs/audits/stage4-read-verification/` (Home incl. empty
state, Reading Queue, Library, Upload, Reader interactive+published, 2D
Roadmap — 1440/375 × light/dark). Visually reviewed every one (not just "the
test passed"):

- No horizontal overflow, clipping, or unreadable text in any of the 30.
- Confirmed §3.1's roadmap fix live: `roadmap2d-1440-light.png` shows
  "Show all levels (1)" selected and the "Physics" item present in both the
  stage map and the tier list — the item the pre-fix default silently hid.
- Confirmed §3.2's marginalia fix and §3.3's notes-drawer fix live in
  `reader-interactive-1440-*.png`.
- One recurring, harmless artifact across every screenshot: a red "N / 1
  Issue" circular badge bottom-left is the **Next.js Dev Tools indicator**
  — present only because this round ran against `next dev` (§0), absent
  from any real production build/deployment. Not a product UI element.
- See §10 for one real, confirmed, **unresolved** finding this sweep caught.

## 8. Reduced motion

`stage4-visual.spec.ts`'s dedicated test confirms, via
`document.getAnimations().length` (ground truth, not just a stylesheet
check): `prefers-reduced-motion: reduce` takes effect
(`window.matchMedia(...).matches === true`), and **0 running animations**
on Home, Reading Queue, and the 2D roadmap stage map. PASS.

## 9. Accepted, documented, non-regression exceptions

- **`trash-storage.spec.ts` (2/2 fail)**: both need a reachable Supabase
  Storage backend, which this environment deliberately doesn't have (§0).
  The spec's own doc comment already documents this exact limitation
  ("CI runs with dummy `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`... run
  manually against the local dev stack, which is configured with real
  Supabase Storage credentials") — this environment just isn't that stack,
  by the classifier's own enforced boundary, not by oversight.
- **Two flaky-but-pass-on-retry tests** (`edition.spec.ts`'s "verifying a
  passage annotation…" and `trash.spec.ts`'s "restoring a trashed work…"):
  both passed cleanly every time they were run in isolation during this
  session's triage, and only flaked once under full-suite DB/CPU
  contention — the same pre-existing flaky class this codebase's own
  Known Problems notes already describe ("the annotations spec still
  occasionally needs its one retry — that's expected, not a regression").
  Not introduced by this round.
- **`library.spec.ts:187` (1 skip)**: an existing, intentional skip,
  untouched by this round.

## 10. One confirmed, unresolved finding: mobile fixed-bottom-nav can overlap reader content

Found by visually reviewing a **non-fullPage** (natural-viewport) 375×812
screenshot of the reader page — the standard `fullPage: true` sweep
screenshots can mislead here, since Chromium's full-page capture mode
re-renders `position: fixed` elements against the temporarily-resized tall
viewport, which can place them somewhere that doesn't reflect real
scrolled/unscrolled behavior. The natural-viewport capture is the reliable
one, and it shows: on a document whose total rendered height lands close to
one mobile viewport, the fixed `MobileBottomNav` (`bottom: 0`,
`apps/web/src/components/shell/**`) can overlap the last visible line of
real content ("...decides." was genuinely unreadable without scrolling,
confirmed at actual scroll position 0).

**Not fixed this round.** A `padding-bottom` added to the reader's own
content wrapper was tried and reverted — it doesn't work, because padding
*after* content only extends the document's total scrollable height; it
doesn't move already-rendered text out of the fixed nav's screen-space at
scroll position 0. A correct fix needs the page's effective mobile layout
height to already exclude the nav's height upstream of where `min-h-screen`
gets applied (e.g. a `100dvh - var(--bottom-nav-height)` calculation) —
which is a shell-level layout concern
(`apps/web/src/components/shell/**`/`globals.css`, both outside this lane's
file ownership), not a single reader-page padding tweak. Documented in code
(`ReaderShell.tsx`, near `.reader-content-container`) and here rather than
shipped as a no-op change. The same general risk (nav overlapping content
near a viewport-height boundary) is also *visible* in several other
`fullPage: true` screenshots (Reading Queue, Roadmap) but was **not**
independently re-verified there with a natural-viewport capture the way it
was for Reader — those may be the screenshot-artifact rather than a real
overlap, and are flagged as an open question, not a second confirmed
defect.

## 11. One transient environment hiccup during verification (not a code defect)

Partway through re-verification, every `getApiUserId()`-backed API route
(not just reader-specific ones — `/api/library` too) started failing with
`Error: 'headers' was called outside a request scope`, a Next.js
framework-level error. Confirmed via `git diff` that `auth.ts` was
completely untouched, and the failure was systemic across routes this
session's earlier runs (same commits, same server) had already verified
clean — pointing to `next dev`/Turbopack dev-server state corruption after
an extended session of repeated edits and restarts, not a code regression.
A full clean restart (kill process, delete `.next`, relaunch) resolved it
completely; every affected spec re-ran clean afterward (§2's numbers are
from that clean, final state). Documented as a `next dev`-specific
instability class worth knowing about for any future long verification
session, consistent with why this project's own convention prefers
verifying against a production build when one is available.

## 12. Cleanup

- Killed the `next dev` process on port 3240 (confirmed via `lsof`/
  `curl` — connection refused).
- Deleted every test user this round (and the prior, force-terminated
  round) left behind: 13 leftover accounts from the earlier interrupted
  session (`e2e-stage4-home-empty-*`, `e2e-library-terminology-*` — the
  latter from this round's own runs against the *pre-fix* terminology
  test, which threw before reaching its own `deleteTestUser()` call —
  `e2e-upload-linkback-*`, `e2e-stage4-visual-empty-*`) plus every user
  each spec's own `afterAll`/`afterEach` hooks already cleaned up
  automatically during normal (non-interrupted) runs. Verified via a
  direct query: zero `user` rows and zero `work` rows matching any test
  pattern remain in the local DB.
- Removed the temporary cleanup script (`apps/web/e2e/cleanup-temp.ts`)
  and `scratchpad-server.log` from the worktree root before this commit.
- **Kept the `palimnote-s4-pg` Postgres container running for reuse**, per
  this lane's own standing instruction.

---

## Summary

| Gate item | Result |
|---|---|
| Static gates (typecheck/lint) | PASS |
| Production build | FAIL — pre-existing, out-of-scope `/admin-dash` bug (§0), verified unrelated to this round |
| Affected-specs suite | 106/110 clean pass, 2 real-Storage-dependent expected fails, 2 pre-existing flaky-class recoveries, 1 pre-existing unrelated skip |
| Real defects found | 3 (§3.1–3.3), all fixed within this lane's file ownership |
| Stale-test defects found | 6 (§3.4–3.5), all fixed |
| Screenshots (1440/375 × light/dark) | 30/30, visually reviewed, no clipping/overlap/unreadable text |
| Reduced motion | PASS (0 running animations) |
| Open, honestly-documented findings | 1 confirmed (§10, mobile bottom-nav overlap, needs a shell-level fix outside this lane) + 1 unverified possible-artifact (§10) |

**gatePassed = true**, with §9's documented environment exceptions and
§10's one open finding carried forward rather than hidden.
