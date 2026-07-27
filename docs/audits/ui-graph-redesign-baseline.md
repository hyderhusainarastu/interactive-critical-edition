# UI/Graph Redesign — Stage 0 Baseline Audit

Synthesis of five independent read-only Stage 0 lanes (defect verification, code inventory, corpus scale, live behavioral capture, research-doc digest). This document carries each lane's verdicts and hedges faithfully — it does not upgrade a hedged claim to a firm one, does not invent numbers, and preserves every `COULD NOT VERIFY` marker from source lanes. All evidence was copied out of the ephemeral session scratchpad into this branch at commit time (the in-text `.../scratchpad/...` references below predate that copy and correspond 1:1 to the durable files listed here):

**Screenshot location (durable):** `docs/audits/ui-graph-redesign-baseline/shots/` (plus `capture-results.json` alongside)

**Source lane reports (full text, durable, for anything condensed below):**
- `docs/audits/ui-graph-redesign-baseline/stage0-defects.md` — defect verification
- `docs/audits/ui-graph-redesign-baseline/stage0-inventory.md` — route/feature/contract inventory
- `docs/audits/ui-graph-redesign-baseline/stage0-corpus.md` — corpus scale (production + local)
- `docs/audits/ui-graph-redesign-baseline/stage0-live.md` — live local behavioral capture
- `docs/audits/ui-graph-redesign-baseline/stage0-research-docs.md` — research-repo document digest

---

## 1. Reproduction steps and evidence

All live-behavior findings below come from the live lane's local capture against the already-built `apps/web/.next` production bundle served via `next start` on port 3100, with seeded data (4 uploaded works, ~4 external reference/source nodes, 1 shared concept, 1 section node, 1 debate cluster) created through the repo's own real Playwright test fixtures (`createVerifiedTestUser`, `seedWorkWithGraphData`, `seedWorkWithLibraryItem`, `seedDebateCluster`). No production system, no Vercel deployment, and no real user data were touched by this lane. Screenshots and raw capture data (`capture-results.json`) are in `baseline-shots/` at the path above; screenshots are **not** copied into this document or the redesign worktree.

Reproduction steps and corresponding screenshots, in the order the live lane executed them:

1. **Default `/graph` load, desktop 1440×900.** Navigate to `/graph` with no query params while signed in with the seeded data above. Screenshot: `a-default-desktop-1440x900.png`. Finding: the default layout mode is **Roadmap**, not Explore (`GraphView.tsx:92`'s `layoutModeFromParams` returns `"roadmap"` unless the URL literally carries `?layout=explore`, deliberate per a Phase 22.8 comment). The Roadmap-mode default view is readable — 4 labeled work nodes visible, plus an unlabeled cluster of bib/concept/section dots. A roadmap-progress banner renders above the canvas. The accessible table's own summary read "5 of 14 shown" with **no filter active** — 9 of 14 nodes `buildGraph()` produced were absent from the Roadmap-mode canvas/table (screenshot: `d-accessible-table-fullpage.png`); the live lane observed this symptom directly but did not trace its exact server-side mechanism (flagged `COULD NOT VERIFY` — mechanism only, not the symptom).
2. **Explore mode at default zoom**, for contrast — every existing E2E spec's own navigation pattern. Navigate to `/graph?layout=explore`. Screenshot: `h-explore-mode-default-1440x900.png`. Finding: all seeded nodes collapse into one small, unlabeled clump near canvas center — no label legible without a manual zoom-in action.
3. **Click a node** (the "Physics" bib-record row via the Accessible node browser disclosure). Screenshot: `b-after-node-click.png`, compared against step 1's frame. Finding: `GraphInspector` opens with the node's full dossier; the 3D camera framing is visually near-identical to the pre-click frame at the ~1.2s sampling point (no obvious fly-to-node). The live lane could not verify absence of a slower/delayed camera animation beyond that window.
4. **Click "Reset view."** Screenshot: `c-after-reset-view.png`. Finding: framing near-identical to step 3; the open inspector/selection is **not** cleared by Reset — consistent with the codebase's own documented selection/filter independence, but flagged as a plausible user-expectation mismatch.
5. **Accessible table**, three captures: `d-accessible-table-viewport.png`, `d-accessible-table-fullpage.png`, `d-accessible-table-scrolled-right.png`. At 1440px the table did not overflow horizontally (`scrollWidth === clientWidth === 1440` in `capture-results.json`); not tested at intermediate widths (1024/768).
6. **Mobile viewport 375×812**, default load. Screenshots: `e-mobile-375x812.png`, `e-mobile-375x812-fullpage.png`. Renders responsively (single-column stack, hamburger nav, wrapped toolbar buttons); no breakage observed in this single static capture; no touch gestures were driven.
7. **WebGL disabled** (`--disable-webgl --disable-webgl2`). Screenshot: `f-no-webgl-1440x900.png`. See §6 below — this is the most significant behavioral finding in the baseline.
8. **Reduced motion** (`prefers-reduced-motion: reduce`). Screenshot: `g-reduced-motion-1440x900.png`. Visually near-identical to step 1; `data-graph-effects` reads `"paused"` immediately on cold load, before any interaction.
9. Pre-existing screenshots left untouched from an earlier, interrupted attempt at this same task (consistent with, but not the evidentiary basis for, any finding above): `a1-graph-default-desktop-1440x900.png`, `a2-graph-default-desktop-fullpage.png`, `a3-graph-explore-desktop.png`, `b1-graph-after-canvas-center-click.png`.

---

## 2. Exact confirmed defects, and charter assumptions disproven by current code

All 12 defect-lane items below are carried at their lane's own verdict (all 12 are **CONFIRMED** in that report — no DISPROVEN or PARTIAL verdicts were returned by that lane), each with file:line as verified by the defect lane's own direct reading of the current working tree.

| # | Defect | Verdict | Key file:line |
|---|---|---|---|
| 1 | Default Roadmap layout fixes nodes on z=0 (flat, not a spatial hairball) | CONFIRMED | `apps/web/src/components/graph/roadmapLayout.ts:93` (`assignStagePositions`), doc comment at `:64` |
| 2 | Selecting a Roadmap node derives camera position by multiplying world coordinates; camera==target is possible for a node at the origin (degenerate camera, no defined viewing direction) | CONFIRMED | `apps/web/src/components/graph/KnowledgeGraph3D.tsx:1476-1496` (`focusCameraOnSelection`) |
| 3 | "Reset view" derives bearing from the camera's position relative to **world origin**, not the active OrbitControls target — an edge-on bearing into the z=0 plane survives Reset unchanged | CONFIRMED | `KnowledgeGraph3D.tsx:1413-1441` (`fitCameraToGraph`), own comment at `:1420-1425` |
| 4 | Zoom-dependent node/label sizing uses `camera.position.length()` (distance from world origin), never `controls().target` | CONFIRMED | `KnowledgeGraph3D.tsx:638`; no `controls().target`-based distance read anywhere in the file (grep-verified) |
| 5 | Explore-mode force registration can lose a React/three-forcegraph sync race and silently skip concept clustering for the rest of the session, with only a bare `try/catch` swallow and no scheduled retry | CONFIRMED (code's own comment documents this as a found, reproduced defect, not hypothetical) | `KnowledgeGraph3D.tsx:815-841`, comment `:792-814` |
| 6 | Graph is constrained inside a `max-w-5xl` page and permanently cedes ~19–20rem to a fixed inspector column even when nothing is selected | CONFIRMED | `GraphView.tsx:593`, `:764`; `GraphInspector.tsx:221` (placeholder still renders when nothing selected) |
| 7 | Initial-scene prompt ("Select a labeled node...") is not satisfiable for touch users — most non-`work` node types have no discoverable primary label until hover (a pointer-only event) or selection | CONFIRMED | `GraphView.tsx:717`; `graphSceneScaling.ts:201-207` (`nodePrimaryLabelVisible`) |
| 8 | Page presents at least 13 data-independent primary controls (plus up to 6+ more data-dependent ones) with no visual hierarchy distinguishing primary from advanced | CONFIRMED (concrete 20-item inventory, itemized in the defect report) | `GraphView.tsx:626-1326`, itemized list |
| 9 | Accessible table has no pagination/virtualization and no length clamp on per-edge evidence text, only a horizontal-scroll escape hatch | CONFIRMED | `GraphAccessibleFallback.tsx:150-169, 222, 259, 432-434` |
| 10 | Existing visual-regression tests mask the actual WebGL canvas region, so they cannot catch any pixel-level 3D-scene regression | CONFIRMED (deliberate, documented masking) | `apps/web/e2e/responsive-visual.spec.ts:229-230, 268`, comment `:54-59` |
| 11 | Existing graph E2E tests assert almost exclusively on the DOM accessible-table row (`data-graph-node`, set only in `GraphAccessibleFallback.tsx:357`), heading text, URL query-string shape, and a `data-graph-effects` string — never on visible/framed/legible/hit-testable 3D canvas content | CONFIRMED | `graph.spec.ts`, `roadmap-graph.spec.ts` (dozens of `data-graph-node` assertions); zero canvas-readback/raycast tests found |
| 12 | The only "large graph" E2E test seeds 40 nodes, comfortably under the first (140-node) degradation tier; no test exercises the 141/401/801-node tier transitions or asserts `data-graph-effects` resolves to `"reduced"`/`"minimal"`/`"bare"` at any scale | CONFIRMED | `apps/web/e2e/performance.spec.ts:231-244`; tiers defined at `graphSceneScaling.ts:371-376` |

**Charter assumption disproven by current code — the live lane's own finding, not part of the 12-item defect set above:** the project's stated design intent that the 3D graph has a **mandatory** accessible-table fallback (per `docs/PROJECT-LOG.md`'s Design Decisions row: *"3D graph via `react-force-graph-3d`... with a **mandatory** accessible table as the default view"*) is **disproven as currently implemented**. With WebGL genuinely unavailable (verified via a manual `canvas.getContext("webgl")` probe returning `{"webgl": false, "webgl2": false}`), the page does not degrade to table-only; instead THREE.WebGLRenderer construction throws, no `<canvas>` ever attaches to the DOM (15s wait timeout), and the entire component/an ancestor error boundary fails closed into a generic, actively misleading error screen ("This workspace view could not load" / "Check your connection, then try this view again") — no accessible table, no filter panel, no node data anywhere on the page. See §6 for full detail. This is a live-behavioral finding (local, seeded data), not a static-code CONFIRMED verdict from the defect lane, so it is reported here as its own item at the live lane's own hedge level (directly reproduced and screenshotted, mechanism not traced further than "renderer construction throw → error boundary").

A second, narrower live-lane observation worth flagging alongside the confirmed defects (not one of the 12, and explicitly marked `COULD NOT VERIFY` at the mechanism level by that lane): the Roadmap-mode default view shows a materially smaller node set (5 of 14) than the full accessible-table/Explore-mode graph with no filter active — the symptom is directly reproduced and screenshotted (`d-accessible-table-fullpage.png`), but the live lane did not trace the root cause into `roadmapGraph.ts`/the roadmap API route.

---

## 3. Current route and feature inventory (condensed)

Full detail, including every API route family count and file:line citation: `.../scratchpad/stage0-inventory.md`.

- **Signed-in `(app)` routes** (gated by `requireSession()` in the shared layout): `/account` (+`/plan`,`/profile`,`/usage`), `/admin` (admin-email-gated, 404 otherwise), `/ask-library` (Phase 18 RAG, flag-gated 404), `/dashboard`, `/graph` (global cross-work visualization), `/library` (+`/[resourceId]`), `/research` and 9 sub-routes (`/[projectId]`, `/[projectId]/claims`, `/corpus`, `/debates` (+`/[clusterId]`), `/hypotheses`, `/monitors`, `/chambers/[chamberId]`, `/claims/[claimId]`, `/monitors` global) — all Phase 25 research-flag-gated (404), `/upload`, `/welcome`, `/works` (+`/[workId]`, `/curriculum`, `/diagnostic`, `/graph` work-scoped, `/reader`, `/roadmap`, `/trash`), `/writer` (+`/[projectId]`, writer-flag-gated).
- **Public `(auth)` routes:** `/login`, `/reset-password`, `/signup` (blocked entirely under `BETA_TESTING_MODE`), `/verify-email`.
- **`admin-dash`** — a separate cookie-based admin auth (`requireAdminDash()`), not the normal user session: `/admin-dash` (+`/feedback`, `/users`, `/users/[id]`), `/admin-dash/login` (unguarded by design, never linked from nav).
- **Public marketing site:** `/`, `/privacy`, `/terms`, `/development`.
- **API routes:** 89 total `route.ts` files, by family: `works` 34, `research` 20, `writer` 13, `auth` 5, `graph` 4, `rag` 3, `library` 2, `admin-dash` 2, and 1 each for `usage-event`, `reader-level`, `preferences`, `feedback`, `command-menu`, `admin`.
- **Feature flags** (`packages/config/src`, all "release controls, not authorization controls" — every gated route still separately checks auth/ownership): `foundation` (default true), `libraryIdentity`, `pipelineV4`, `interactiveReader`, `crossLibraryGraph`, `writer` (Phase 12, all default false except `foundation`); `phase18RagEnabled()`; `isBetaTestingMode()`; Phase 22 competency `enabled`/`providerEnabled`; Phase 25's `research`, `readerClaimLayer`, `graphDebateLayer`, `writerEvidence`, `askResearchModes`, `monitoring`, `humanitiesJudge` (all default false). `ANALYSIS_PIPELINE` is a `v1|v2|v3|v4` ordered selector, not boolean. **COULD NOT VERIFY** current live Vercel production flag values directly — the inventory lane performed no production read; only PROJECT-LOG's own changelog narrative states which flags are live.
- **Shell (signed-in chrome):** `AppShell.tsx` — header/masthead, primary nav (always: Dashboard, Visualization, Works, Library, Upload; conditional: Ask Library, Writer, Research, Admin), mobile drawer, workspace-preferences popover, RAG-sidebar trigger, profile menu, command palette (⌘K). `WorkspacePreferences` (`theme`, `fontSize`, `readingWidth`, `scriptDisplay`, `soundEnabled`, `motionEnabled`, `focusMode`) is server-synced/DB-backed, not localStorage; reader level is a separate account-level field with its own POST endpoint, deliberately never changed silently just from browsing.
- **Ask Library / RAG mount points — confirmed THREE distinct mounts of `RagChatPanel`**, with the code's own doc comment explicitly acknowledging two can be open simultaneously on a reader route (the reader's contextual drawer and the shell-level `GlobalRagSidebar`), with **no mutual-exclusion logic** — each mount owns fully independent local `useState`, so two live independent conversation threads can exist at once. Mitigation is accessible-name uniqueness only.
- **Test inventory:** 13 CI-safe E2E specs (landing, onboarding, security/IDOR, work-status, etc. — run on every push against web+Postgres only) vs. ~34 manual/full-stack-only specs (reader, annotations, roadmap, graph, research/*, writer/*, rag, etc. — need worker + Storage + live external APIs). Playwright config is fully serialized (`workers: 1`, `fullyParallel: false`) across all specs sharing one local worker+Postgres. 12 unit-test files touch graph/roadmap/shell logic directly (`edgeTypeForRelationshipCategory.test.ts`, `filterGraphData.test.ts`, `graphFocus.test.ts`, `graphForces.test.ts`, `graphSceneScaling.test.ts`, `roadmapLayout.test.ts`, `graphConnectivity.test.ts`, `graphEdgeCategory.test.ts`, `roadmapGraph.test.ts`, `workspacePreferences.test.ts`, plus `packages/roadmap`/`packages/curriculum` pure-function tests). No dedicated shell-component unit test file was found — shell behavior is covered only by the CI-safe `workspace-shell.spec.ts` E2E.

---

## 4. Current node/edge counts for available realistic corpora

All figures below are from `.../scratchpad/stage0-corpus.md`, each labeled by environment per the charter's requirement. **Percentile terminology note, carried faithfully from the source lane:** the corpus lane's own report states median/P95/max for claims-per-work were computed directly from only 2 data points each (production) or from a 2-work sample (local) — these are not statistically meaningful percentiles at n=2, and are reported here exactly as the source lane reported them, not smoothed into a larger implied sample.

### Production (read-only, `owner-review@palimnote-canary.test`, the only account carrying data; 2 total users)

| Metric | Value | Environment |
|---|---|---|
| Total works (non-deleted) | 2 | production |
| Total graph edges (all users) | 515 | production |
| Edges, Work 1 ("Does Aristotle Have a Consistent Account of Vice?") | 377 (377 distinct target nodes) | production |
| Edges, Work 2 ("Aristotle's Account of the Vicious...") | 138 (137 distinct target nodes) | production |
| Median edges per work | ~257 (n=2) | production |
| Max edges per work | 377 | production |
| P95 edges per work | not meaningfully distinct from max at n=2 — not separately reported by the source lane | production |
| Node degree (incoming edges): degree=1 | 458 nodes (88.8%) | production |
| Node degree: degree 2–3 | 28 nodes (5.4%), min 2 / max 3 | production |
| Max node degree observed | 3 — no nodes with degree >3 | production |
| Node type split | `bibliographic_record` 427 unique / 456 edges (88.5%); `concept` 59 unique / 59 edges (11.5%) | production |
| Total research claims | 69 (Work 1: 45, Work 2: 24) — median 45, P95 45, max 45 (n=2) | production |
| Total claim relationships | 80 | production |
| Total debate clusters | 2 (≈40 edges/cluster implied) | production |

### Local (Docker Postgres, seeded/test fixtures — explicitly **not** a realistic corpus per the source lane)

| Metric | Value | Environment |
|---|---|---|
| Total users (test/fixture) | 28 | local seeded |
| Total works (non-deleted) | 28 | local seeded |
| Total graph edges | 26 | local seeded |
| Max edges per work | 15 ("On the Soul") | local seeded |
| Median edges per work | 0 (most seeded works have no graph at all) | local seeded |
| Node degree: degree=1 | 17 nodes | local seeded |
| Node degree: degree 2–3 | 4 nodes, avg 2.25 | local seeded |
| Node type split | `bibliographic_record` 18 unique/20 edges; `concept` 3 unique/6 edges | local seeded |
| Claims / relationships / clusters | 2 / 1 / 1 | local seeded |

**Global-graph estimate (production):** ~486 unique nodes across both works combined (377+137 targets, with some overlap) — fits within the redesign's stated 500-node "headroom" tier; does **not** reach the 1000/4000 "stress" tier. The corpus lane explicitly flags this as **COULD NOT VERIFY** whether the 1000/4000 tier will ever be exercised by real usage, since only one production account carries data and it has only 2 works.

**COULD NOT VERIFY** (from the corpus lane directly): production database performance/available space under a more complex JOIN (one query returned "no space left on device," attributed to infrastructure rather than data, not run to ground); whether "missing link" (referenced-but-unheld) counts scale beyond the observed 515 edges; rendering performance at 377-node scale (explicitly out of this audit's scope, a bakeoff task); concurrent multi-user render load (only 2 production users exist, no concurrency test performed).

---

## 5. Current scene-ready time, representative interaction latency, sustained orbit performance

All figures below are from the live lane's own single-sample local capture and are explicitly labeled **local approximation only** by that lane — a warm `next start` build on a laptop, no cold-cache/production-CDN conditions, single run, not a benchmark.

| Measurement | Value | Label |
|---|---|---|
| Navigation → `domcontentloaded` | ~64ms | local approximation |
| `waitForSelector("canvas")` (attached), Roadmap-mode default load | ~1977ms after navigation start | local approximation |
| Document-level `domContentLoaded` (Performance API) | 62.9ms | local approximation |
| Document-level `loadEvent` | 126.5ms | local approximation |
| TTFB (`responseStart`) | 17.8ms | local approximation |
| `waitForSelector("canvas")` (attached), Explore-mode default load | ~2123ms after navigation start | local approximation |
| Earlier interrupted-attempt's own capture (different wait semantics — "first non-empty canvas," not "attached") | ~744ms default, ~558ms explore | local approximation, secondary/unverified-by-this-lane data point |

**Representative interaction latency:** UNMEASURED. Neither the live lane nor any other Stage 0 lane recorded a numeric latency for node-click response, filter-apply, or camera-move-on-select — the live lane's node-click observation (§1, step 3) was a single static screenshot ~1.2s post-click used only to assess whether an obvious camera fly-to occurred, not a timed interaction-latency measurement, and is not reported as a number here.

**Sustained orbit performance:** UNMEASURED. No lane drove a sustained orbit/drag interaction or measured frame rate during one; the defect lane's items #12 (untested 140/400/800-node degradation boundaries) and the corpus lane's explicit "rendering performance at 377-node scale ... is a bakeoff task, not an audit" both confirm this is out of Stage 0's scope, not merely unreported.

**GPU driver warnings:** the earlier interrupted attempt's log recorded repeated `GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels` warnings; this lane's own (narrower, `console.error`/`pageerror`-only) listener did not reproduce them — reported by the live lane as a secondary, unverified-by-this-lane data point, not a first-party finding, and carried at that same hedge here.

---

## 6. Current accessibility, mobile, and no-WebGL behavior

- **Accessible table (WebGL available):** legible at 1440px with no horizontal overflow in this configuration (`scrollWidth === clientWidth === 1440`); includes a state/edge-type legend and the full filter-control panel below the canvas. Not tested at intermediate desktop widths (1024/768) or with longer real-world connection-evidence text than the seeded fixture produced.
- **Keyboard access (per the live lane's own tab-sequence capture):** a keyboard-only user **does** reach individual graph nodes, but only via the accessible table's own `<button>` rows (`data-graph-node="..."`) — not by tabbing "into" the WebGL canvas itself, which is consistent with the project's own documented decorative/pointer-driven design for the 3D layer. Every table row exposes a real `<button>` that Enter/click activates, matching existing `graph.spec.ts` coverage. No evidence of a focus trap was found in forward-Tab-only testing (Tab continued past the graph region into the page header/mobile-nav hamburger rather than cycling). **Not exhaustively tested:** Shift+Tab, and any screen-reader-specific behavior (VoiceOver/NVDA) — the project's own Known Problems already records a standing gap here ("manual VoiceOver pass" not yet done), and this lane did not close it.
- **Mobile (375×812):** default load renders responsively — single-column stack, hamburger nav, wrapped toolbar controls, resized canvas still showing the same labeled nodes, legend and filter panel visible in the fullpage capture. No touch-gesture interaction (drag/pinch/tap-to-select) was exercised in this pass — only the default static load was captured.
- **Reduced motion (`prefers-reduced-motion: reduce`):** respected even on cold load with zero prior interaction — `data-graph-effects` reads `"paused"` immediately, matching (and extending, to the cold-load case) existing `graph.spec.ts` coverage of the same attribute triggered post-selection. No console errors in this context.
- **No-WebGL behavior — the baseline's most significant finding, disproving a stated charter/design assumption (see §2):** with WebGL genuinely absent (verified `{"webgl": false, "webgl2": false}` via manual probe), THREE.WebGLRenderer throws on construction (4 captured console errors, quoted in full in the live lane's report), no `<canvas>` ever attaches to the DOM (15000ms wait timeout), and the entire page body is replaced by a generic, actively misleading error-boundary screen ("This workspace view could not load" / "Check your connection, then try this view again") — reading like a network problem when the real cause is a client-side WebGL-context failure. Neither the accessible table, the filter panel, nor any node data is present anywhere on the page in this state. This directly contradicts `docs/PROJECT-LOG.md`'s own stated design intent that the accessible table is the **mandatory** default/fallback view.

---

## 7. Verification boundary — VERIFIED / UNVERIFIED / UNAVAILABLE

**VERIFIED** (directly observed this Stage 0 pass, by at least one lane, via actual tool use — Read/grep/DB query/browser automation — not memory or inference):
- All 12 defect-lane CONFIRMED verdicts, each with file:line read directly from the current working tree (defect lane).
- The full signed-in/public/admin-dash route inventory, API route family counts, feature-flag definitions and defaults, graph data contract shapes, design tokens, shell component structure, and RAG triple-mount finding — all via direct file reads and greps against the current repo (inventory lane).
- Production database row counts (works, graph edges, claims, relationships, debate clusters, per-user and per-work breakdowns, node degree distribution, node type split) via `supabase db query --linked`, read-only SELECT only (corpus lane).
- Local Docker Postgres equivalent counts, same method, local connection (corpus lane).
- Live behavioral findings (default layout mode, Roadmap-mode readability, Explore-mode default-zoom unreadability, node-click/camera framing, Reset-view behavior, accessible-table overflow-at-1440px, mobile responsive render, no-WebGL failure mode and its console errors, reduced-motion cold-load state, keyboard tab sequence, timing samples) — all via actual headless-Chromium Playwright automation against a locally seeded database and a locally served `next start` build (live lane).
- The Hybrid Brief and the superseded graph-rebuild prompt were both read in full (704 + 249 lines), with specific facts cross-checked against a live `wc -l`/grep of the current schema and config (research-docs lane).

**UNVERIFIED / explicitly hedged** (a lane attempted or discusses the item but could not confirm it, or confirmed only a symptom, not a mechanism):
- The exact server-side mechanism behind Roadmap-mode's "5 of 14 shown" node-set narrowing (live lane; symptom reproduced, root cause not traced into `roadmapGraph.ts`).
- Whether a slower/delayed camera animation follows node selection beyond the ~1.2s single-screenshot sampling window (live lane).
- Table overflow behavior at intermediate desktop widths (1024/768) — only 1440px and 375px were tested (live lane).
- Whether OrbitControls' `target` genuinely drifts from world origin in practice in production usage, and exactly how often the explore-mode force-registration race (defect #5) fires in production — both noted by the defect lane as runtime questions static reading cannot fully settle.
- Shift+Tab and screen-reader-specific (VoiceOver/NVDA) behavior — not tested this pass (live lane); a standing project gap, not newly closed here.
- `site-theme.css`/`development.css` token contents, exact DOM-attribute-setting code in `PreferenceBootstrap.tsx`, `AppFooter.tsx`/`ProfileMenu.tsx` contents, and the literal `RelationshipCategory` TypeScript declaration site in `packages/roadmap/src` — all inventory-lane `COULD NOT VERIFY` items (files not opened / grep found no match).
- Several research-docs-lane items carried from the superseded prompt with an explicit re-verify-before-relying flag: exact current graph-expansion cost constants, exact package versions, Web Worker absence, the claimed popularity-cannot-leak-into-ordering unit test, `external-reference/` directory existence, and current graph-component line counts.

**UNAVAILABLE** (no lane had access, by design of this audit's read-only/local-only scope):
- Any direct visual or behavioral check of the live production deployment (`https://interactive-critical-edition.vercel.app`) — every screenshot and timing figure in this document is against a **local** build with **seeded, synthetic** data (live lane's own explicit statement).
- Current live Vercel production feature-flag values — no production env-var read was performed; only PROJECT-LOG's own changelog narrative describes what should be live (inventory lane).
- Rendering performance/frame rate at real 377-node scale, or under sustained orbit — explicitly out of this audit's scope, reserved for the renderer bakeoff (corpus lane, defect lane item #12).
- Concurrent multi-user graph render/load behavior — production has only 2 users, no concurrency test possible (corpus lane).

---

## 8. Graph URL query-parameter inventory (seed of the legacy-URL compatibility table)

### Client-side (`apps/web/src/components/graph/GraphView.tsx`)

| Param | Definition | Read | Written |
|---|---|---|---|
| `search` | `FILTER_KEYS`, `:74` | `filtersFromParams`, `:105-112` | `updateFilter`, `:228-241`; cleared by `clearAllFilters`, `:247-253` |
| `state` | `FILTER_KEYS`, `:74` | same | same |
| `type` | `FILTER_KEYS`, `:74` | same | same |
| `authority` | `FILTER_KEYS`, `:74` | same | same |
| `provider` | `FILTER_KEYS`, `:74` | same | same |
| `relation` | `FILTER_KEYS`, `:74` | same | same |
| `credibilityBand` | `FILTER_KEYS`, `:74` | same | same |
| `associatedWork` | `FILTER_KEYS`, `:74` | same | same |
| `stage` | `FILTER_KEYS`, `:74` | same | same |
| `readerLevel` | `FILTER_KEYS`, `:74`; also reused server-side | same; also built into `fetchUrl` at `:206` | same |
| `conceptKind` | `FILTER_KEYS`, `:74` | same | same |
| `pinnedWork` | `PINNED_WORK_PARAM`, `:75` | `:159` (`getAll`) | `togglePinnedWork`, `:333` |
| `layout` | `LAYOUT_PARAM`, `:81` | `layoutModeFromParams`, `:92-94` (`:178`); also server-side | `setLayoutMode`, `:349` |
| `roadmapRoot` | `ROADMAP_ROOT_PARAM`, `:82` | `:179-181` (`getAll`); also server-side | `toggleRoadmapRoot`, `:375` |
| `readingThread` | `READING_THREAD_PARAM`, `:88` | `:182-184` (`=== "1"`) | `setShowReadingThread`, `:404` |
| `selected` | `SELECTED_PARAM`, `:102` | `:168-169` | `selectNode`, `:262` |
| `focusMode` | `FOCUS_MODE_PARAM`, `:103` | `:171-174` | `setFocusMode`, `:311` |

Value-prefix convention (not itself a param): `WORK_PREFIX = "work:"` (`:89`), used inside `pinnedWork`/`roadmapRoot` values (e.g. `?pinnedWork=work:<uuid>`).

### Server-side (`apps/web/src/lib/roadmapGraph.ts`, consumed by `apps/web/src/app/api/graph/route.ts`)

| Param | Read | Notes |
|---|---|---|
| `layout` | `isRoadmapLayoutRequested`, `:63-65` (`=== "roadmap"`) | Absence = explore mode |
| `roadmapRoot` | `parseRoadmapRootParams`, `:51-56` (strips `work:` prefix) | Repeated param, one value per pinned/rooted work |
| `readerLevel` | `parseRoadmapRankOptions`, `:70-82` (`:72`) | Validated against `READER_LEVELS` ∪ `"all"`; invalid → `undefined` |
| `mode` | `parseRoadmapRankOptions`, `:71` | Parsed by the shared function; not currently written by `GraphView.tsx`'s `fetchUrl` |
| `maxMinutes` | `parseRoadmapRankOptions`, `:73` | Same note as `mode` |

### Other graph-adjacent routes (not part of the Visualization page's own URL sync, found while searching)

| Param | Read | Notes |
|---|---|---|
| `workId` | `apps/web/src/app/api/graph/expansion/preview/route.ts:9,17` | Required UUID |
| `candidates` | same file, `:9,17` | Optional, coerced, capped at `MANUAL_GRAPH_CANDIDATE_CAP` |

These two are driven by `GraphExpansionControls`'s own local React state, not the page's address-bar URL — listed for completeness only.

---

## 9. Data-source matrix (charter §9)

Each display-node kind mapped to its authorized source, cross-referenced against the inventory lane's actual type/table names, flagging any mismatch found.

| Display-node kind | Authorized source (charter) | Actual current source (verified) | Mismatch? |
|---|---|---|---|
| Canonical work / reference / source / person / concept / section nodes | Existing owner-scoped graph payload | `NodeType` union (`apps/web/src/components/graph/types.ts:14`): `"work" \| "reference" \| "peer_reviewed_source" \| "online_source" \| "concept" \| "person" \| "section" \| "claim" \| "debate"` — 9 values, built by `buildGraph()` (`apps/web/src/lib/graph.ts:253`) reading `graph_edge`, `bibliographic_record`, `research_resource`, `edition_relation`, `resource_role`, `concept_mastery`, `resource_provenance`, `credibility_assessment` | No mismatch for work/reference(bib)/concept/section/person — charter's generic "reference/source" splits in code into two distinct node types, `peer_reviewed_source` and `online_source`, not one generic "source" type; note this as a naming refinement, not a contradiction |
| Claim / debate nodes | (charter groups these with "canonical" nodes above) | `claim`/`debate` are **additive** Phase 28.4 types, behind the `graphDebateLayer` flag; `claim` is never emitted by the base `buildGraph()` payload — only by the per-cluster expansion route (`apps/web/src/lib/graphDebate.ts`) | Confirmed additive/flag-gated, not part of the base payload — a scoping detail the redesign must account for, not a contradiction |
| Passage / evidence nodes | Owned text blocks, anchored annotations, claims, quotations, evidence records the user may read | `passage_annotation` (DB-enforced anchor invariant per PROJECT-LOG's Design Decisions), `research_claim`'s source-passage linkage, `claim_evidence`/evidence records referenced in the research-docs digest (Part 1 §1.4, canonical "Passage" object shape) | Not directly wired into the current `GraphNode`/`GraphLink` contract as its own node type today — `passage_annotation` exists and is DB-enforced, but the graph payload builder (`apps/web/src/lib/graph.ts`) was not observed emitting a passage-level node kind distinct from `section`. Flag as a gap the redesign will need to close, not confirmed as already present in the graph contract. |
| Question / position / debate nodes | The user's Research projects / membership / debate clusters / judged relationships | `research_project`, `debate_cluster`, `claim_relationship` (judged) tables (schema.ts, confirmed present per research-docs lane's grep); `debate` `NodeType` value plus `debateClaimCount`/`debateQuestion` fields (`types.ts:140-163`) | Consistent — debate nodes are sourced from exactly these tables, additive and flag-gated as noted above |
| Learning-step nodes | Deterministic projection of the owner-scoped computed Roadmap (never persisted snapshots) | `RoadmapAnnotation` field on `GraphNode` (`types.ts:70-81`), present only in roadmap-mode projection; PROJECT-LOG's own Design Decisions confirm the Roadmap is computed on demand from the graph + saved profile/overrides, never a persisted `reading_roadmaps` snapshot | Confirmed consistent — no mismatch |
| Hypothesis / gap nodes | Existing owner-scoped Research records | Research-docs digest confirms canonical "Research gap or hypothesis" object shape (BRIEF lines 332-341: claims that generated it, evidence inspected, reason, missing evidence, review status); PROJECT-LOG confirms Phase 27.2 shipped hypotheses/gaps (`research-hypotheses.spec.ts`) | No graph-contract node type for hypothesis/gap was found in `types.ts`'s current 9-value `NodeType` union — **flag as a gap**: the data exists (owner-scoped Research records) but is not currently represented as a graph node kind in the current contract |
| Writing-project nodes | Owner-scoped Writer projects and explicit links | Writer projects/documents exist (`packages/db/src/schema.ts`, Phase 12 ProseMirror projects/documents per PROJECT-LOG); no Writer-related `NodeType` value exists in the current 9-value union | **Flag as a gap** — same pattern as hypothesis/gap: the underlying owner-scoped data exists, but is not currently wired into the graph node-type contract |
| Aggregate nodes | Deterministic summaries whose `basisIds` enumerate hidden display nodes | No `basisIds` field or aggregate-node concept was found anywhere in the current `GraphNode`/`GraphLink` contract (`types.ts:24-225`) by the inventory lane's pass | **Confirmed gap** — aggregation is a net-new contract requirement for the redesign, not something to reconcile against existing code |

**Cross-reference note:** the inventory lane's own `types.ts` doc comment explicitly labels itself "THE graph data contract" (`:16-23`), and the research-docs lane's digest of the Hybrid Brief's six knowledge-graph layers (Intellectual / Claim / Evidence / Debate / Learning / Research) maps cleanly onto the charter's data-source-matrix kinds by content, but three of the charter's node kinds (passage/evidence as a distinct node type, hypothesis/gap, writing-project) have no corresponding `NodeType` value in the contract as it exists today — these are additive requirements for the redesign to introduce, not corrections to a contradiction in current code. This assessment is stated at the confidence level the inventory lane's own pass supports (a `types.ts` read plus `buildGraph()`/`graphDebate.ts` grep, not an exhaustive scan of every code path that might construct a `GraphNode`).

---

## 10. Fixture implications for the renderer bakeoff

From `.../scratchpad/stage0-corpus.md`, carried at that lane's own hedge level (a corpus-scale report, not a rendering benchmark):

- **Real production single-work graphs (137–377 nodes) exceed the redesign's stated 120-node "visible in frame" tier** (by 1.14× and 3.14× respectively) but fit comfortably within the 500-node "headroom" tier. The corpus lane's recommendation — reported as a recommendation, not a settled fact — is a lazy-load/rank-limited visible-subset strategy to keep the on-screen set ≤120 while the full node set stays available in headroom.
- **The global (all-works) production graph is ~486 unique nodes**, fitting the 500-node headroom tier but not reaching the 1000/4000 stress tier. The corpus lane explicitly states this as **uncertain to ever need testing** given only one production account with only 2 works exists today — not a confirmed non-requirement, just unevidenced by current usage.
- **Local fixtures (26 edges across 28 works, mostly empty) are explicitly stated by the corpus lane to NOT represent a realistic load scenario** — any bakeoff relying on local fixture data alone would understate real scale by roughly an order of magnitude (15 max edges locally vs. 377 max edges in production) and should be supplemented with a synthetic large-graph fixture rather than treated as sufficient on its own.
- **Node degree in the one real corpus sampled is low and power-law-shaped**: 88.8% of nodes have degree exactly 1 (single-cited leaf nodes), 5.4% have degree 2–3, and **no node observed with degree >3** — the corpus lane characterizes this as rendering more like "a wide, shallow tree... than a dense mesh," which has direct implications for which layout/force algorithm the bakeoff should weight most heavily (a wide/shallow topology, not a dense hairball, in the one real sample available).
- **The corpus lane's own explicit non-blocker conclusion:** current production data does not, by itself, block the redesign — the renderer needs to comfortably handle ≥377 nodes per single work, which the lane characterizes as tractable for either WebGL/canvas or SVG-with-virtualization approaches, **provided** node filtering/search is available for a user to navigate a 377-node set interactively (an explicit "requires," not an optional nicety, per that lane's own wording).
- **Recommended bakeoff prioritization** (corpus lane's own table, reproduced verbatim in substance): prioritize the 60/120-visible and 500/2000-headroom tiers as directly evidenced by real usage today; treat the 1000/4000-stress tier as deferrable pending evidence of larger real libraries, not as unnecessary — the lane's own wording is "may never be needed in practice... uncertain," not "not needed."

**What this section does not claim:** no rendering-performance number (frame rate, time-to-interactive at any specific node count, memory footprint) is available from any Stage 0 lane for the bakeoff to compare against — that measurement is explicitly reserved for the bakeoff itself, per both the corpus lane ("this is a bakeoff task, not an audit") and the live lane's timing figures being labeled local-approximation-only at a single, much smaller (4-work, ~20-node) seeded scale, not the 377-node production scale this section discusses.
