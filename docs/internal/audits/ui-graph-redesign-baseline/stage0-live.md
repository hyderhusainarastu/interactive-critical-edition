# Stage 0 — Live Behavioral Baseline of the Current Graph (Local)

**Scope:** local-only, seeded data, against the already-built production bundle
(`apps/web/.next`) served by `next start` on `PORT=3100`. Nothing here touches
production, Vercel, Render, or the real Supabase project. No repo file was
modified, created, or deleted — all scripts/screenshots live under this
scratchpad. Local Postgres (Docker) was already running per the task's own
premise; DB writes were limited to one throwaway seeded user (plus cleanup of
one stray leftover from an interrupted earlier attempt, see "Housekeeping"
below), exactly as the read-only-lane exception permits.

## 0. Environment / housekeeping notes (verification boundary)

- `apps/web/.next` already existed (verified via `ls`) — no rebuild was needed.
- Port 3100 was **already occupied** when this lane started (`next-server`,
  PID 74776, started 16:29:39, i.e. before this lane's first tool call). The
  scratchpad directory also already contained a `seed/` folder, `manifest.json`,
  `state.json`, `capture-notes.txt`, and four screenshots (`a1-…png` …
  `b1-…png`) from an **earlier, interrupted attempt at this exact same task**
  (its own `seed/seed.ts` docstring literally says "Stage 0 baseline seed…").
  That attempt's own log (`seed/capture-notes.txt`) shows it crashed mid-run
  ("`Error: locator.click: Target page, context or browser has been closed`")
  before reaching cleanup, leaving its test user
  (`stage0-baseline-1785184282@example.com`, workIds `0d02e439…`/`8f3d4172…`/
  `82f8cf6e…`) and the `next start` process both still alive.
  This lane **reused** that already-running server (killing and restarting it
  would have been wasteful and the running binary is identical either way),
  completed its own full independent seed + capture run under a **new** test
  user, and then **deleted both test users** (its own and the orphaned one)
  and killed the server as this lane's own cleanup step. Verified zero rows
  remain matching either email pattern (`%baseline-audit%`, `%stage0-baseline%`)
  after cleanup.
- The earlier attempt's partial screenshots (`a1-graph-default-desktop-…`,
  `a2-…fullpage`, `a3-graph-explore-desktop`, `b1-after-canvas-center-click`)
  are left in `baseline-shots/` untouched (harmless, and diffing them against
  this lane's own screenshots showed them to be consistent, not contradictory)
  but are **not** the basis for any claim below — every finding here is from
  this lane's own named screenshots (`a-…` through `h-…`) and
  `capture-results.json`, both produced in this run.
- Tooling note: `tsx`/`playwright` were not on `PATH` and the repo has no
  root `node_modules/.bin`. Resolved by `npm install --prefix
  <scratchpad>/npm-tools tsx` (installs only into the scratchpad, touches
  nothing in the repo) and importing `@playwright/test`'s `.mjs` entrypoint
  and `apps/web/e2e/helpers.ts` directly by absolute path (Node's ESM loader
  resolves each file's own bare-specifier imports from *its own* location, so
  `packages/db/src/index.ts` still finds `drizzle-orm`/`postgres`/`pg-boss`
  via `packages/db/node_modules` even though the entry script itself lives
  outside the repo).

## 1. Seed data

Seeded via `apps/web/e2e/helpers.ts`'s own real fixtures (`createVerifiedTestUser`,
`seedWorkWithGraphData`, `seedWorkWithLibraryItem`, `seedDebateCluster` —
`apps/web/e2e/helpers.ts:83`, `:762`, `:1115`, `:1016`), not hand-rolled SQL:

- **Work A "On the Soul (Hub Work)"** — dense single-work graph: a cited
  bib record ("Physics", Aristotle), a review-of-Physics related resource, a
  concept ("Hylomorphism"), a section/outline node, three public D/E sources
  (YouTube/Mastodon/Bluesky), a second edge type (`cites` + `influences` on
  the same pair), and a Library-linked (`work_identity`/`learning_resource`)
  node (`seedWorkWithGraphData` options `withRelatedSource`,
  `withPublicSources`, `withSecondEdgeType`, `withLibraryResource: true`).
- **Work B "Physics (Second Work)"** and **Work C "Metaphysics (Third Work)"**
  — each a separate uploaded work, both pointed at Work A's own concept id
  (`conceptId: a.conceptId`) to create a genuine shared-concept hub (3 works
  converging on one concept node), mirroring `graph.spec.ts:370`'s "connects
  two uploaded works through one shared topic" pattern, extended to three.
- **Work D "Vice and Reason (Fourth Work)"** — a `prerequisite`
  `resource_role` recommending "Nicomachean Ethics" (`seedWorkWithLibraryItem`).
- **One debate cluster** (`seedDebateCluster`, Phase 28.4 shape) — two
  contradicting claims across Work A and Work B, clustered.

Total: 4 uploaded works, ~4 external reference/source nodes, 1 shared
concept, 1 section node, 1 debate cluster — a genuine "several works, edges
of multiple types, one dense hub" graph as requested. Seed script:
`/private/tmp/.../scratchpad/seed.mjs`; DB ids in
`/private/tmp/.../scratchpad` command output (also reproducible from that
file). Both test users and everything each seeded (work_identity,
learning_resource rows matching the test-only key patterns) were deleted via
`deleteTestUser` before this lane finished — verified with a follow-up query
returning zero rows.

## 2. `/graph` default load, desktop 1440×900 — is it readable?

**File:** `baseline-shots/a-default-desktop-1440x900.png`

**Key finding — the default layout is "Roadmap", not "Explore".** This is
not a guess: `GraphView.tsx:92` (`layoutModeFromParams`) returns `"roadmap"`
unless the URL literally has `?layout=explore`, and the code comment at
`GraphView.tsx:76` confirms this is deliberate (Phase 22.8). Every one of
`graph.spec.ts`'s ~20 tests navigates with `?layout=explore` explicitly
(e.g. `graph.spec.ts:46`, `:77`, `:87`…) — **none of the existing Playwright
coverage exercises the page's own actual default view**, only the
non-default "Explore" mode. This is a real coverage gap, not just a curiosity:
the two modes look and behave differently (see below), and the one users
actually land on by clicking "Visualization" in the nav is the one with
zero direct E2E assertions.

**In Roadmap mode (the real default), the initial scene is readable**: a
vertical list of 4 work nodes with visible text labels ("Vice and Reason
(Fourth Work)", "Physics (Second Work)", "On the Soul (Hub Work)",
"Metaphysics (Third Work)"), each with a small orbiting-ring decoration, plus
a small unlabeled cluster of dots bottom-left (the bib/concept/section nodes,
too small/close together to read at this zoom). It is **not** blank and
**not** perfectly edge-on, but roughly half the visible nodes have no legible
label at this default camera distance.

A roadmap-progress banner ("0 of 0 essential works read… Next up: Physics",
with Prerequisites/Formative context/Core engagement/Interpretation &
context/Extension pill counts) renders above the canvas — this UI only
exists in Roadmap mode.

**Contrast — Explore mode's default zoom is NOT readable.**
**File:** `baseline-shots/h-explore-mode-default-1440x900.png`. Navigating
directly to `/graph?layout=explore` (what every existing test does) renders
all seeded nodes collapsed into one small, unlabeled clump near canvas
center with no text visible at all — the user would have to manually
scroll-to-zoom before any node label becomes legible. This is a real,
observable "is it readable" answer: **no, not without a manual zoom-in
action**, for the mode all current tests actually cover.

**Roadmap-mode default also silently narrows the node set.** The accessible
table's own summary row read "5 of 14 shown" with **no filter active** (the
"Clear all filters" control was visible and the table's filter selects were
all at "All"/default) — see `d-accessible-table-fullpage.png`. 9 of the 14
graph nodes `buildGraph()` produced were not present in the Roadmap-mode
table/canvas at all. I did not trace the exact server-side mechanism
(`GraphView.tsx`'s `fetchUrl` appends `roadmapRoot`/reader-level params only
in roadmap mode, per `GraphView.tsx:202-208`, and the roadmap endpoint likely
returns a curriculum-scoped subgraph rather than the full one) — **COULD NOT
VERIFY the precise root cause without reading `roadmapGraph.ts`/the
`/api/works/.../roadmap`-adjacent endpoint in more depth than this pass
covered** — but the *behavior* is directly observed and reproducible: default
load shows a materially smaller graph than Explore/the full accessible table
would.

## 3. After clicking a node — where does the camera go?

**File:** `baseline-shots/b-after-node-click.png`, compare to
`a-default-desktop-1440x900.png`.

Clicked the first node exposed via the "Accessible node browser" `<details>"
(the "Physics" bib-record row's button). Result: the `GraphInspector` panel
opens on the right showing the node's full dossier (credibility
dimensions, source access/license, provenance) — but **the 3D camera framing
in the screenshot is visually near-identical to the pre-click frame**; there
is no dramatic pan/zoom-to-node visible in a static screenshot 1.2s after the
click. This is consistent with `GraphView.tsx`'s comment describing selection
as a "focus" (dimming/emphasis of non-neighbors) rather than a camera
fly-to — I did not find code confirming an intentional camera move on select,
and the screenshot evidence supports "selection changes emphasis + opens the
inspector; it does not obviously relocate the camera." COULD NOT VERIFY
whether a subtle camera drift happens over a longer window than the ~1.2s
this capture waited.

## 4. After "Reset view"

**File:** `baseline-shots/c-after-reset-view.png`.

Clicking "Reset view" reproduced almost exactly the same framing as (b) —
node positions unchanged — and, importantly, **the inspector panel/selection
was NOT cleared by Reset view** (the "Physics" dossier with its "Close"
button is still open in the screenshot). This matches the codebase's own
documented distinction (`graph.spec.ts:834`, "selecting a node does not
clear active filters, and clearing filters does not clear a selection") —
Reset view appears to be a camera-only action, separate from selection
state, exactly as designed rather than a bug — but flagging it here since a
user unfamiliar with that distinction could reasonably expect "Reset" to
also clear the open inspector.

## 5. Accessible table view

**Files:** `d-accessible-table-viewport.png` (in-viewport), 
`d-accessible-table-fullpage.png` (full page), 
`d-accessible-table-scrolled-right.png` (scrolled to right extreme).

At 1440px the table did **not** overflow horizontally — `table_scroll_info`
in `capture-results.json` shows `scrollWidth === clientWidth === 1440` for
the nearest scrollable ancestor, i.e. no horizontal scrollbar appeared at
this viewport width with this column set (Title/Kind/Status/Stage/
Priority/Order/Known/Connections/Why/Reader level/Credibility). The
"Connections"/"Why" columns wrap text rather than forcing horizontal scroll.
This may differ at narrower desktop widths or with longer real-world
connection lists — not tested at intermediate widths (e.g. 1024/768) in this
pass.

The table itself is legible and includes a legend (node-state dot colors,
edge-type line colors) and the full filter-control panel (Scope/Attributes/
Edge types groups, "Clear all filters", "Pinned uploaded works", and an
"Expand from work" / "Queue expansion" control) all below the canvas —
consistent with the "mandatory accessible table fallback" the project log
claims, **when WebGL is available** (see §7 below for what happens when it
is not).

## 6. Mobile viewport (375×812), default load

**Files:** `e-mobile-375x812.png` (viewport), `e-mobile-375x812-fullpage.png`
(full page).

Renders responsively: single-column stack, nav collapses to a hamburger,
Roadmap/Explore toggle and all the mode-toolbar buttons wrap to fit, the
canvas itself resizes to the narrower viewport and still shows the same 4
labeled work nodes plus the unlabeled cluster, legend and full filter panel
below (all visible in the fullpage capture). No obvious mobile-specific
breakage was observed in this single static capture (no interaction/touch
gestures were driven in this pass — only the default load was screenshotted).

## 7. `--disable-webgl --disable-webgl2` — what does the user see?

**File:** `baseline-shots/f-no-webgl-1440x900.png`.

**This is the most significant behavioral finding in this baseline.** With
WebGL unavailable, the page does **not** degrade to the accessible table
fallback the project log documents as "mandatory" (PROJECT-LOG.md's Design
Decisions table: "3D graph via `react-force-graph-3d`... with a **mandatory**
accessible table as the default view"). Instead:

- Real console errors were thrown and captured (`capture-results.json`'s
  `no_webgl` array):
  ```
  THREE.WebGLRenderer: A WebGL context could not be created. Reason:  disabled by enterprise policy or commandline switch
  THREE.WebGLRenderer: A WebGL context could not be created. Reason:  disabled by enterprise policy or commandline switch
  THREE.WebGLRenderer: THREE.WebGLRenderer: Error creating WebGL context.
  Error: THREE.WebGLRenderer: Error creating WebGL context.
      at new WebGLRenderer (.../chunks/25--ht3ol7tpe.js:1373:60360)
      at g.init (.../chunks/25--ht3ol7tpe.js:1373:100101)
      ...
  ```
- No `<canvas>` element ever attached to the DOM (`waitForSelector("canvas")`
  timed out at 15000ms, `no_webgl_canvas_attached: {"found": false, "elapsedMs": 15002}`).
- The **entire page body** was replaced by a generic error-boundary screen:
  > **"This workspace view could not load"**
  > "Your work is safe. Check your connection, then try this view again."
  > `[Try again]`

  (full body text captured in `capture-results.json`'s
  `no_webgl_body_text_excerpt`). Neither the accessible table, the filter
  panel, nor any node data is present anywhere on the page — the whole
  Visualization surface is gone, replaced by a message that is actively
  **misleading** for this cause (it reads as a network/connectivity problem;
  the real cause is a client-side WebGL-context failure, unrelated to
  connectivity).
- Confirmed the browser context genuinely had no WebGL (`no_webgl_context_report:
  {"webgl": false, "webgl2": false}` from a manual `canvas.getContext("webgl")`
  probe), so this is a faithful "user on a machine/policy without WebGL"
  simulation, not a false negative from some other cause.

**Conclusion:** the "mandatory accessible table fallback" is not actually
reachable when the 3D renderer throws during construction — the whole
component (or an ancestor error boundary) fails closed into a generic,
wrongly-worded error screen instead of degrading to table-only. This
directly contradicts the project's own stated design intent and is a prime
candidate for the redesign to fix.

## 8. Reduced motion (`prefers-reduced-motion: reduce`)

**File:** `baseline-shots/g-reduced-motion-1440x900.png`.

Visually near-identical to the default (a) screenshot — same readable
vertical node list. Behaviorally: the 3D canvas element's own
`data-graph-effects` attribute read `"paused"` **immediately on load**, with
no interaction at all (`capture-results.json`:
`reduced_motion_effects_attr_on_load: "paused"`). This matches
`graph.spec.ts:341`'s assertion (`emulateMedia({reducedMotion:"reduce"})` →
`data-graph-effects` = `"paused"`, there triggered by a keyboard select
rather than checked on cold load) — confirms the reduced-motion respect
holds even before any user interaction, not just after a selection. No
console errors were logged in this context.

## 9. Timing (local approximation only — single sample, not a benchmark)

From `capture-results.json`'s `timings_default_load` (default Roadmap-mode
load, desktop, warm Next.js server after ~1 prior request from login):

- Navigation → `domcontentloaded`: **~64ms**
- `waitForSelector("canvas")` (attached, not necessarily first-paint-with-content):
  **~1977ms** after navigation start
- In-page Performance API: `domContentLoaded` 62.9ms, `loadEvent` 126.5ms,
  `responseStart` (TTFB) 17.8ms — these are for the *document* request only,
  not for when the WebGL scene actually becomes visually populated; the
  ~1977ms canvas-attach figure is the more meaningful "time to first
  graph paint" proxy here.
- Explore-mode load (`h-explore-mode-default-1440x900.png`'s capture run):
  canvas attached at **~2123ms** after navigation start — comparable to
  Roadmap mode, i.e. layout mode doesn't materially change load latency,
  only what's shown once loaded.
- An earlier, independent partial capture attempt in this same scratchpad
  (`seed/capture-notes.txt`, from the interrupted prior lane described in
  §0) recorded a similar order of magnitude on the same machine/build
  ("first non-empty canvas ~744ms" for default, "~558ms" for explore, with
  slightly different wait semantics — "first non-empty" vs. this lane's
  "attached"), and additionally logged repeated
  `GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall
  due to ReadPixels` console warnings on that run that this lane's own
  `default_desktop`/`mobile`/`reduced_motion` console-error capture did
  **not** reproduce (this lane's `console.error`/`pageerror` listeners caught
  zero entries for those three contexts — driver warnings of that kind are
  typically logged at `console.warn`, which this lane's listener did not
  capture; not a contradiction, just a narrower capture filter). No console
  errors were observed in the normal-WebGL contexts (default desktop,
  mobile, reduced-motion) with this lane's own listener.

**All timing figures above are local-machine approximations only** (single
run, on a laptop, against a warm dev-mode-adjacent `next start` build, with
no attempt at cold-cache/production-CDN conditions) — not to be treated as a
production performance benchmark.

## 10. Console errors summary

- **Default desktop, mobile, reduced-motion contexts: zero console errors or
  page errors** captured (`capture-results.json`: `default_desktop: []`,
  `mobile: []`, `reduced_motion: []`).
- **No-WebGL context: 4 console errors**, all THREE.js/WebGLRenderer
  construction failures, quoted in full in §7 above.

## 11. Keyboard behavior

- **Can you Tab to the graph?** Yes, indirectly. The first ~25 Tab stops
  (`capture-results.json`'s `tab_sequence_first_25`, captured *after* a node
  was already selected and the accessible table opened, since this ran after
  steps (b)/(c)/(d)) landed on: Fullscreen, Export PNG, the open
  inspector's Previous/Next/Close buttons, an "open licensed source" link,
  a "Why this, here" `<summary>`, a node's own inspector button (appeared
  twice — once for the currently-open inspector context, once elsewhere),
  the "Accessible node browser" `<summary>`, then the table's own sortable
  column-header buttons (Title/Kind/Status/Order/Connections/Reader
  level/Credibility), and finally into individual **node row buttons**
  (`data-graph-node="external:bib:…"`, `data-graph-node="work:…"` — confirmed
  via the `dataGraphNode` field on each tab-stop snapshot). So yes: a
  keyboard-only user reaches individual graph nodes, but only by tabbing
  through the *table* rows' own buttons (the accessible-table path), not by
  tabbing "into" the WebGL canvas itself — consistent with the project's own
  documented design (3D canvas is decorative/pointer-driven; the table is
  the keyboard-operable surface).
- **Is there a keyboard path to select a node?** Yes — every
  `data-graph-node` row exposes a real `<button>` (e.g. "Physics (-350)",
  "Metaphysics (Third Work)") that Tab reaches and Enter/click activates;
  `graph.spec.ts:341`'s own coverage already confirms Enter on a focused row
  opens the same inspector this lane observed by mouse click.
- **Does focus get trapped?** No evidence of a trap in this pass. Pressing
  Tab 40 more times after the initial 25 moved `document.activeElement` from
  a `<button>` inside the selected-node's dossier context to a **different**
  element entirely — the mobile-nav hamburger button (`class="app-control
  app-icon-button md:hidden"`, `data-tooltip="Open navigation"`) — i.e. focus
  continued advancing through the page (past the graph card, into the
  header) rather than cycling within the graph region. This is inconsistent
  with a focus trap. (Not exhaustively fuzzed — only forward Tab was
  exercised, not Shift+Tab, and not from every possible starting element.)

## 12. What was NOT verified (explicit boundary)

- **Production was not visually verified at all.** Everything above is
  against a **local** `next start` build (`apps/web/.next`) with **seeded,
  synthetic** local data over local Docker Postgres. No claim here describes
  `https://interactive-critical-edition.vercel.app`'s live behavior, real
  user data, or the Render worker.
- Camera-move-on-select was only checked via a single static screenshot
  ~1.2s after the click — a slow or delayed animation outside that window
  would not be visible here. COULD NOT VERIFY absence of any camera motion,
  only absence of an obviously different final frame at that sampling point.
- The exact mechanism behind Roadmap mode's "5 of 14 shown" narrowing was
  observed but not traced into `roadmapGraph.ts`/the roadmap API route in
  this pass — flagged as COULD NOT VERIFY (mechanism), though the *symptom*
  is directly reproduced and screenshotted.
  Table overflow behavior was only checked at 1440px and 375px, not at
  intermediate desktop breakpoints.
- Only forward-Tab was exercised for the focus-trap check; Shift+Tab and
  screen-reader-specific behavior (VoiceOver/NVDA) were not tested — this
  project's own Known Problems already records a standing gap here ("manual
  VoiceOver pass" not yet done).
- GPU driver warnings noted only in the earlier interrupted attempt's log,
  not independently reproduced by this lane's own (narrower) console
  listener — reported as a secondary, unverified-by-this-lane data point,
  not a first-party finding.

## Files produced (all in `baseline-shots/`)

- `a-default-desktop-1440x900.png` — default `/graph` load, Roadmap mode, desktop
- `b-after-node-click.png` — after clicking a node (bib "Physics")
- `c-after-reset-view.png` — after "Reset view"
- `d-accessible-table-viewport.png`, `d-accessible-table-fullpage.png`,
  `d-accessible-table-scrolled-right.png` — accessible table
- `e-mobile-375x812.png`, `e-mobile-375x812-fullpage.png` — mobile default load
- `f-no-webgl-1440x900.png` — WebGL disabled (chromium launched with
  `--disable-webgl --disable-webgl2`)
- `g-reduced-motion-1440x900.png` — `prefers-reduced-motion: reduce`
- `h-explore-mode-default-1440x900.png` — `?layout=explore` default zoom, for contrast
- (pre-existing, from the interrupted prior attempt, left untouched:
  `a1-graph-default-desktop-1440x900.png`, `a2-graph-default-desktop-fullpage.png`,
  `a3-graph-explore-desktop.png`, `b1-graph-after-canvas-center-click.png`)

Raw structured data: `capture-results.json` (console logs, timings, tab
sequence, focus-trap check, no-WebGL body text/context report).
