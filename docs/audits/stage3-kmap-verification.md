# Stage 3 Knowledge Map — Verification Round 1

Status: **VERIFICATION COMPLETE, one confirmed high-priority product defect found and NOT fixed in this round** (see §3). This is the Stage 3 VERIFICATION lane's first pass against the charter's own gate (real unmasked scene evidence; camera/frustum assertions; desktop/touch/keyboard journeys; dense fixtures + performance floors; no blank/edge-on reproduction after load/select/Home/filter/resize/remount/view-switch).

Environment: `/private/tmp/palimnote-redesign` (branch `redesign/ui-graph-rebuild`), dedicated Postgres on port 5433 (already migrated, ledger 46), web built and served on port 3230 (`next build` + `next start`), Playwright/Chromium headless (this machine's only available WebGL path is `--use-angle=swiftshader-webgl`, software rendering — noted because it's slower than a real GPU and is part of why this machine's own click-timing story below is worth reading critically).

---

## 1. Typecheck / lint / build

All clean, both before and after every change in this round:

```
pnpm --filter web typecheck   → clean (tsc --noEmit, zero errors)
pnpm --filter web lint        → clean (eslint, zero errors/warnings)
pnpm --filter web build       → clean (next build, all routes compiled)
```

Also ran (unprompted but relevant, since this round deleted files with their own unit tests): every remaining `knowledge-map/`/`graph/` pure-unit `.test.ts` file (26 files, run individually via `tsx` — `apps/web` has no vitest wiring of its own; this is this codebase's own established convention for these files, not something this round invented) passes, and `@ice/graph-display`'s vitest suite passes 397/397.

## 2. e2e suite run against the local build

Ran the full new Knowledge Map suite plus every graph-adjacent CI-safe spec (seeded-data, no worker/live-API dependency, matching `graph.spec.ts`'s own long-established CI-safe convention): `knowledge-map.spec.ts`, `knowledge-map-fallback.spec.ts`, `knowledge-map-touch.spec.ts` (mobile-chromium project), `graph-scene.spec.ts`, `graph-expansion.spec.ts`, `graph-debates.spec.ts`, `roadmap-constellation.spec.ts`, `responsive-visual.spec.ts`, `link-check.spec.ts`.

### 2.1 Legacy dead code + a stale spec, found and retired (committed)

The **first** run of this set surfaced 20 failures, ALL in one family: the pre-existing `e2e/graph.spec.ts` and `e2e/roadmap-graph.spec.ts` — which the Stage 3 design spec (`docs/design/knowledge-map-spec.md` §1.2) had **already decided** should be retired, alongside their sole remaining consumer, an entire cluster of now-dead legacy components (`components/graph/GraphView.tsx`, `KnowledgeGraph3D.tsx`, `GraphInspector.tsx`, `GraphAccessibleFallback.tsx`, `graphSceneScaling.ts`, `roadmapLayout.ts`, `graphForces.ts`, plus their own `.test.ts` files) — but this had never actually been executed. Both `/graph` and `/works/[workId]/graph` pages were already correctly swapped to `KnowledgeMapWorkspace` (confirmed by reading the page files directly), so the entire cluster above had **zero real consumers left** (verified by grep: only imported by each other and their own tests) — the two stale specs were asserting against `data-graph-node` DOM rows and a `data-graph-effects` string that no longer exist on these routes, which is exactly why they failed, not because of any real regression.

**Triage: test bug, not product bug.** Fixed by completing the disposition the design spec already committed to: deleted the whole dead cluster (12 files) and did **not** touch `graphFocus.ts`/`graphFocus.test.ts` (the spec calls for relocating and re-auditing that one against the charter's `focusMode` semantics — see §4 below, a real open item, not a mechanical delete). Verified equivalent-or-better coverage already exists in the new suite per the design spec's own §7.3 coverage table (real canvas/camera assertions vs. the old DOM-only checks) before deleting. `pnpm --filter web typecheck/lint/build` all re-verified clean after the deletion. Committed as `fcaf2c7`.

### 2.2 Full suite result after the cleanup

Final, complete run (`knowledge-map.spec.ts`, `knowledge-map-fallback.spec.ts`, `knowledge-map-touch.spec.ts`, `graph-scene.spec.ts`, `graph-expansion.spec.ts`, `graph-debates.spec.ts`, `roadmap-constellation.spec.ts`, `link-check.spec.ts`; `responsive-visual.spec.ts` covered separately in §6 since its own run is a large, independent visual-baseline sweep):

```
53 tests, 5 skipped, 4 failed, 44 passed
```

- **5 skipped**: `graph-debates.spec.ts`'s flag-ON block, correctly gated off since `PHASE_25_GRAPH_DEBATE_LAYER_ENABLED` isn't set locally (the flag-OFF block's 2 tests pass).
- **4 failed** = exactly 3 unique tests (one, `knowledge-map.spec.ts:377`, needed both its own attempt and its Playwright-level retry to fail; the totals below count unique tests):
  - `knowledge-map.spec.ts:275` ("select via node click, Focus moves the camera, Home returns to canonical pose") — the click-occlusion flake, §3.
  - `knowledge-map.spec.ts:377` ("a real pointer click at a node's exact projected position selects that node, nothing else") — same root cause.
  - `knowledge-map.spec.ts:579` ("a full page reload (route remount) restores state...") — same root cause.
  - `roadmap-constellation.spec.ts:45` — out of Stage 3 scope, §5.
  - (Note: `knowledge-map.spec.ts:742` "Pin persists..." and `:803` "reduced motion" — both flagged flaky in an EARLIER run this session — passed cleanly in this final, complete run; consistent with §3's own characterization of an intermittent, seed-dependent condition, not a per-test-file defect.)
- **44 passed**, including: `knowledge-map-touch.spec.ts` (mobile-chromium, real touch tap/orbit/pinch/pan) — **all pass**; `graph-scene.spec.ts`, `graph-expansion.spec.ts`, `graph-debates.spec.ts` (flag-off block) — **all pass**; `link-check.spec.ts` — **passes** (169 links + 16 anchors crawled and checked, zero broken, including `/graph` and the work-scoped `/works/:id/graph?...` deep link).
- `responsive-visual.spec.ts`: **34 visual-regression baselines fail** — see §6 for the full read (one benign/expected class, one real out-of-scope defect found incidentally).

## 3. The click-flake: root-caused precisely, attempted fix reverted, honestly reported

The charter brief's own failure description said a prior round had root-caused this to "not a code bug in the product" via diagnostic scripts proving node world position/camera pose were stable, cutting off mid-sentence. The existing code comment (still in `knowledge-map.spec.ts` today, unmodified — see below) attributes it explicitly to this shared sandbox's GPU/CPU contention (other worktree lanes' own processes competing for the same machine).

**This round ran a dedicated diagnostic** (8 single-shot click attempts, zero retries, against the unmodified production code, logging every node's screen position, world position, and camera pose before each click) and found a **different, more specific, and more actionable mechanism**: 3 of 8 trials (37.5%) failed on the very first attempt, with the click landing exactly at the target's own reported screen position — and in every failing trial, the ROOT node (a larger, hub-degree-scaled sphere, closer to the camera) was the node that actually got selected instead. The failing trials' root↔target screen distance (57–83px) was measurably smaller than the passing trials' (87–111px). This is a real, deterministic **3D depth-occlusion** condition — the natural, per-random-seed variance in where this tiny (3–4 node) fixture's force layout converges occasionally places the hub node's own rendered disc directly in front of a satellite node from the camera's fixed Home angle — **not** a timing race, since retrying the *identical* click position can never change which node is in front of which along that same ray.

**Fix attempted, then reverted.** Two escalating versions of a "nudge the click point away from whatever got wrongly selected" recovery step were tried directly in `clickNodeInScene`. Empirical validation (`--repeat-each=8`, `--retries=0`, for a clean per-attempt signal) showed **neither version reliably eliminated the failure** — a rough calculation from the diagnostic's own numbers (an occluding disc apparently ~90–110px in radius, comparable to or larger than the fixture's own inter-node spacing in the worst cases) suggests a pure screen-position nudge cannot always find a point that's simultaneously inside the target's own disc and outside the occluder's, and a camera-orbit-based recovery (which *would* generalize) was rejected as too risky to introduce inside a shared, multi-consumer test helper without dedicated design time — it would fight the charter's own "a click never moves the camera" contract for tests that read camera pose immediately after a click (`knowledge-map.spec.ts`'s own "Home returns to canonical pose" test does exactly this).

**`knowledge-map.spec.ts` is therefore committed back to its ORIGINAL, unmodified state** — no product code and no test code changed by this finding. This is an honest "found a sharper root cause, tried a fix, the fix didn't hold up under validation, reverted rather than ship something unproven" outcome, not a silent gap. Recommended for a future round with its own budget: either (a) a real camera-based recovery with careful pose-restore semantics, or (b) increasing the layout's own minimum node-to-node separation for very small fixtures so the hub's disc can no longer fully occlude a direct satellite from Home's fixed angle. Both are product/test-infra design decisions this verification pass shouldn't make unilaterally.

**Failure signature**, for reference: `clickNodeInScene: <nodeId> never became selected after 15 attempts`, at `knowledge-map.spec.ts:275` ("select via node click..."), `:377` ("a real pointer click at a node's exact projected position..."), `:579` ("a full page reload (route remount)..."), `:742` ("Pin persists a node's position..."), and — once — `:803` ("Home applies with zero-duration tween..."), all via the same shared `clickNodeInScene` helper. Every one of these is the SAME root cause, not five independent defects.

## 4. Open item carried forward from the design spec (not fixed here)

`docs/design/knowledge-map-spec.md` §1.2 explicitly calls for `graphFocus.ts`/`graphFocus.test.ts` to be relocated into `knowledge-map/` and **re-audited** against the charter's `focusMode` semantics (`all`/`neighborhood`/`expand2`/`concepts`/`readingPath`, matching `@ice/graph-display`'s `GRAPH_FOCUS_STATES`). This verification pass confirms that work has **not** happened: the `focus` URL state round-trips through `useGraphUrlState`/`legacyGraphUrl.ts` for legacy-URL-compatibility purposes, but grep across every file in `components/knowledge-map/` finds **zero** places that actually read `context.focus`/`state.focus` to change what's rendered — the 4 non-default focus modes have no real implementation anywhere in the rebuild. This is real, charter-named feature work (not a mechanical file move), so it's flagged here as a confirmed gap rather than attempted under this round's verification-only mandate.

## 5. Out-of-scope failure found incidentally: `roadmap-constellation.spec.ts`

Fails with `Locator: locator('[data-roadmap-constellation]') ... element(s) not found` — the element genuinely isn't in the DOM. Traced to `RoadmapView.tsx:335`: `{data && visible.length > 0 && <RoadmapConstellation ... />}` — the constellation only mounts when the roadmap has at least one visible item, and this run's seeded fixture apparently produces zero. This is **`/works/[workId]/roadmap`** — the design spec's own §0 is explicit that this separate, already-existing 2D Roadmap page is untouched by and out of scope for this Stage 3 lane (no file under `apps/web/src/app/(app)/works/[workId]/roadmap/` is read/imported/edited by any Stage 3 file). Confirmed unrelated to anything this lane touched (no import of any deleted or edited file). Not investigated further or fixed — flagged here only because it surfaced while running the broader graph-adjacent CI-safe set, for whichever lane owns the Roadmap page.

## 6. `responsive-visual.spec.ts`: one stale-baseline class (benign) + one real, out-of-scope defect (not benign)

All 34 failures share the same signature (pixel diff against a committed baseline PNG), across every single page in the app (dashboard, library, works, work-detail, upload, reader, roadmap, graph) — not just graph. Read the actual diff/expected/actual PNGs directly (not just the pass/fail line) for two representative cases:

- **`graph` (desktop, light):** the *expected* baseline is a screenshot of the **old, now-deleted legacy `GraphView.tsx` UI** — full old nav bar (DASHBOARD/VISUALIZATION/WORKS/...), old ROADMAP/EXPLORE toggle, old FOCUS SELECTED/EXPAND ONE HOP button row, old edge-type legend — while the *actual* render is correctly the new `KnowledgeMapWorkspace` (FILTERS rail with Layers checkboxes, 3D/2D/List toggle, Focus/Fit/Home/Filters/More/Help toolbar). **This is expected, benign staleness** — the baseline was never regenerated after the Stage 3 rebuild (someone already fixed this test file's *heading*/*mask* logic for the new UI per its own doc comments, but never re-captured the actual PNG). Not regenerated in this round — see the next bullet for why.
- **A separate, real, currently-live defect, found by reading the same screenshots**: on every page (not just graph), the header's "Palimnote" wordmark is partially obscured/overlapping with a "Read" context-bar label on work-scoped routes specifically (confirmed absent on the bare `/graph` global route, which renders the wordmark correctly — see the captured `desktop-1440-2d-view.png`/`desktop-1440-list-view.png` below, both via the global route, both showing "Palimnote" intact). This is a real, reproducible header/shell layout bug, **squarely Stage 1 shell territory** (global chrome, explicitly out of Stage 3's charter per the design spec §8), not something this lane's files touch. **Deliberately not regenerating any visual baseline in this round**: doing so for "graph" alone while this header bug is still live would silently bake a real, currently-broken header state into a "passing" baseline. Flagged here for whichever lane owns Stage 1 shell chrome, with the evidence attached (see the desktop-1440-* screenshots below, all of which show the same overlap on work-scoped routes).

## 7. Confirmed, reproducible, HIGH-PRIORITY defect: resize-to-narrow-viewport blanks the 3D scene and it never self-heals except on remount

Found by this round's adversarial sequence (§8) and independently reproduced in isolation. **This is a real product bug, in Stage 3's own charter territory (camera/resize behavior), not a test artifact.**

**Root cause** (read directly in `KnowledgeMapScene.tsx`): the scene's Home/Fit computation runs inside a `useEffect` gated on `[hasSize]`, a **boolean** (`dimensions.width > 0 && dimensions.height > 0`) that only flips `false → true` **once**, at initial mount. A `ResizeObserver` does update `dimensions` on every subsequent resize (feeding `<ForceGraph3D width={} height={}>` so the renderer's own aspect ratio stays correct), but **nothing re-runs the camera fit/home computation when `dimensions` changes after that first transition** — the camera's world position/target are frozen from whatever the very first fit computed.

**Reproduced twice, independently:**
1. Isolated repro: load at 1440×900 (framed correctly, 4/4 nodes visible), resize directly to 600×900 (the FilterRail sidebar takes fixed width, leaving a narrow 280×756 canvas) → **every single node's projected Y coordinate goes negative** (all four: −317, −307, −281, −398) — every node is now entirely above the visible frustum. A real screenshot at this exact moment shows a **completely blank, solid dark canvas** — zero visible content (see `/tmp/repro-after-resize-600x900.png`, captured live and visually confirmed during this session, not carried in this commit since it's a throwaway diagnostic).
2. The charter's own adversarial sequence (§8 below): the SAME "blank, 0 nodes in frustum" state recurs at **every subsequent resize step** in the 5-size cycle — including the fifth resize, which returns to the exact original 1440×900 size — and **only recovers once the scene actually remounts** (switching to List and back to 3D, a hard page reload, or a fresh deep-link navigation). This is precisely the charter's own named "stuck bearing" failure class (baseline defect #3, which this rebuild's own design spec claims to have fixed via `sizing.ts`/`cameraMath.ts` — this specific resize-recovery path was evidently not covered by that fix).

**Why the existing `knowledge-map.spec.ts` "repeated viewport resize" test didn't catch this**: it resizes through `[{1440,900},{800,600},{1024,1200},{500,900},{1440,900}]` (note: an even narrower 500px width than this report's 600px repro) but only asserts **after the loop ends** (mount id unchanged, scene testid visible, `canvasScreenshotByteLength > 4000`) — never mid-sequence, and never via real in-frustum node positions. Given this report's own adversarial-sequence data (§8) shows the exact same 1440×900 end-state is STILL BROKEN after cycling through the same shape of sizes, this existing test would very likely have caught the bug too **had it asserted per-step** — it's the "combine screenshot review with camera/frustum/data assertions, pixel variance alone is insufficient" gap the charter itself names (§16), demonstrated concretely: a screenshot's raw byte count stayed above the 4KB non-blank floor even in the fully-blank state (background/grid/UI chrome bytes), which is exactly the false-negative the charter warns a byte-count-only check can produce.

**Not fixed in this round.** A safe fix needs real design judgment this verification pass shouldn't make unilaterally (e.g., should resize always re-fit, potentially discarding a user's own manual zoom/orbit? Or only self-heal the specific degenerate "nothing in frustum" case? The charter doesn't say, and guessing wrong risks a regression against "ordinary resize preserves the user's own camera work"). **This is this round's single most important finding** and should gate before Stage 3 sign-off — recommend a dedicated fix-loop pass with its own test budget (e.g., a `useEffect` keyed on `[dimensions.width, dimensions.height]`, calling `fit()` — not the full `home()` reset — only when re-verified that the current visible node set's frustum is empty, avoiding disturbing an intact framing on an ordinary resize).

## 8. Adversarial sequence (load → select origin-adjacent → Home → filter to near-empty → clear → resize×5 → List → 3D → remount → deep-link)

Run via a dedicated temporary script (not committed — see §10), asserting scene validity (in-frustum node count, camera-target separation, elevation ≥ 20°, via `@ice/graph-display`'s own `elevationAngleDeg`/`vecLength`/`vecSub`) after every step, using `expect.soft` so one failing step doesn't hide whether later steps recover.

| Step | In-frustum | Separation | Elevation | Verdict |
|---|---|---|---|---|
| 1. load | 4 | 109.57 | 35° | valid |
| 2. select origin-adjacent (root) | 4 | 109.57 | 35° | valid |
| 3. Home | 4 | 109.57 | 35° | valid |
| 4. filter to near-empty | 4 | 109.57 | 35° | valid |
| 5. clear | 4 | 109.57 | 35° | valid |
| 6. resize 1 (1024×768) | 4 | 109.57 | 35° | valid |
| 6. resize 2 (600×900) | **0** | 109.57 | 35° | **BLANK — see §7** |
| 6. resize 3 (1920×1080) | **0** | 109.57 | 35° | **still blank** |
| 6. resize 4 (375×812) | **0** | 109.57 | 35° | **still blank** |
| 6. resize 5 (1440×900, identical to step 1's size) | **0** | 109.57 | 35° | **still blank — does not self-heal** |
| 7. switch List | — (no 3D scene in List view; asserted `knowledge-map-list-view` visible instead) | | | valid |
| 8. back to 3D | 4 | 151.45 | 35° | **valid — remount self-heals** |
| 9. remount route (hard reload) | 4 | 151.45 | 35° | valid |
| 10. deep-link restore | 4 | 151.45 | 35° | valid |

Camera-target separation and elevation never degenerated (never collapsed to the target, never went edge-on below the 20° floor) at any point in the whole sequence — the ONE failure mode found is exclusively the in-frustum count, exclusively during the stuck post-resize window, exactly as described in §7.

## 9. Unmasked screenshots (desktop 1440, 2D, List, mobile 375, no-WebGL)

Captured live against the real build (never masked, per charter §16), saved alongside this report:

- `desktop-1440-default-load.png` — default context load. Root + 3 satellites (`Physics`, `Hylomorphism`, `Book II: The Nature of the Soul`), visibly spread across depth and screen position — not collinear/edge-on. Header wordmark clipped by the §6 shell bug (out of scope, visible for the record).
- `desktop-1440-after-select.png` — after a real click-driven selection: halo ring on the selected root, real inspector content (4 outgoing relationships, real verify/dispute affordances).
- `desktop-1440-after-home.png` — after an orbit drag followed by clicking Home: camera restored to a comparable framing (all 3 satellites + root visible again).
- `desktop-1440-2d-view.png` — real 2D layer-column view (EVIDENCE/INTELLECTUAL/CLAIMS swimlanes), reached via the correct global-route deep-link form; header wordmark intact here (confirms the §6 bug is route-specific).
- `desktop-1440-list-view.png` — real accessible table (4 nodes, distance-sorted, kind/status/hops columns).
- `mobile-375.png` — real mobile 3D scene, bottom nav (Home/Read/Research/Write), collapsed filter rail; nodes visible though the Hylomorphism label is crowded by the root's own label box at this width (minor, not investigated further — not a blank/edge-on failure).
- `desktop-1440-no-webgl-fallback.png` — WebGL forced unavailable via a `getContext` override: correctly shows the same List-shaped accessible view with an honest "3D view isn't available in this browser. Showing the List view instead." banner, not a silent failure.

Pixel-sampled (viewed directly, not just byte-length-checked) — every one of the 7 is confirmed non-blank with a real, non-collinear node layout.

## 10. Perf sanity (real GPU/software-render pass, 120-fixture-equivalent scene)

`seedWorkWithManyConceptNodes(count: 120)`, real sustained pointer-drag orbit for 12s, `requestAnimationFrame` interval sampling (same technique the bakeoff's own harness uses) — **not** re-measuring the bakeoff's formal numbers, just confirming no regression from the production wiring (real toolbar/rail/tray chrome, real adapter, real filter state) per spec §7.4.

```
frames=721  medianFrameMs=16.70  medianFPS=59.88
```

Well above the ≥50 floor — matches the bakeoff's own reported 59.88 (this machine's software `swiftshader` WebGL path is evidently still vsync-capped at ~60fps for this fixture size, consistent with the bakeoff's own numbers for equivalent fixtures).

## 11. Temporary diagnostic/capture scripts (not committed)

This round wrote and then deleted (per the program's own scope discipline — verification artifacts, not permanent suite additions unless explicitly warranted): `diag-click.spec.ts` (the click-occlusion diagnostic), `capture-stage3-screens.spec.ts` (produced §9's screenshots, then removed), `adversarial-sequence.spec.ts` (produced §8's table, then removed), `perf-sanity.spec.ts` (produced §10's numbers, then removed), `repro-resize.spec.ts` (produced §7's isolated repro, then removed). None of these are in the final commit; only the retired-legacy-code commit (§2.1) and this report + its screenshots are.

## 12. Summary verdict

| Gate item | Result |
|---|---|
| typecheck/lint/build | clean |
| Full knowledge-map + graph-adjacent CI-safe suite | green except the one pre-existing, root-caused-more-precisely click-occlusion flake (§3) |
| Unmasked screenshots, pixel-confirmed nonblank | done, 7/7 (§9) |
| Camera/frustum adversarial sequence | **1 real, confirmed, HIGH-PRIORITY failure** (§7/§8) |
| Perf sanity (120-node scene, 12s orbit) | 59.88 median FPS, floor ≥50 met (§10) |
| Never mask the graph canvas in test coverage | held — `responsive-visual.spec.ts`'s mask is a separate, already-justified full-page visual-regression tool, not this charter's own canvas coverage (§6) |
| Never weaken assertions | held — the click-flake fix attempt was reverted rather than shipped unproven; no assertion in any spec was loosened |

**This round does not recommend Stage 3 sign-off** until §7 (resize-blanks-the-scene, does not self-heal) is fixed and re-verified — it is a real, reproducible violation of the charter's own explicit "no blank... reproduction after... resize" requirement, found with hard, screenshot-confirmed evidence, in Stage 3's own camera/resize territory. §3 (click-occlusion) and §4 (focus-mode semantics) are real but lower-priority open items for a following round. §5 and §6's header-overlap finding are out of this lane's scope and are handed off with full evidence rather than fixed here.

---

# Round 2 — re-verification after the resize-self-heal fix (79db332)

Status: **VERIFICATION COMPLETE. Round 1's single HIGH-PRIORITY blocking defect (§7/§8, resize-to-degenerate-viewport blanking the scene with no self-heal) is confirmed FIXED and re-verified with fresh, real evidence.** No new product defect was found. Everything else observed this round is the SAME already-documented, already-triaged class round 1 reported (§3 click/tap-occlusion flake, §5 out-of-scope roadmap-constellation gap, §6 stale visual-regression baselines + the out-of-scope header-overlap bug) — re-confirmed present, not newly introduced, and none of it is Stage-3-charter-blocking.

Environment: same worktree/branch, dedicated Postgres on port 5433 (ledger 46, matches production — no migration run or needed), web built and served fresh on **port 3230** (`next build` + `next start`), Playwright/Chromium headless (`--use-angle=swiftshader-webgl`). This machine is still shared with several other concurrently-running agent lanes' own Postgres containers and dev servers (`palimnote-s4-pg`, `palimnote-s6-pg`, two other `next-server` instances on ports 3210/3220 from earlier sessions in this same worktree), consistent with round 1's own note about shared-sandbox GPU/CPU contention.

## R2.1 Typecheck / lint / build

All clean, on the tree exactly as it stands (round 1's commit + the `79db332` fix, nothing further changed by this round):

```
pnpm --filter web typecheck   → clean (tsc --noEmit, zero errors)
pnpm --filter web lint        → clean (eslint, zero errors/warnings)
pnpm --filter web build       → clean (next build, all routes compiled, including every /research/* route added since round 1's own workspace state)
```

## R2.2 Full e2e run: knowledge-map suite + graph-adjacent CI-safe specs

Ran the exact same file set round 1 established (`knowledge-map.spec.ts`, `knowledge-map-fallback.spec.ts`, `knowledge-map-touch.spec.ts` [mobile-chromium project], `graph-scene.spec.ts`, `graph-expansion.spec.ts`, `graph-debates.spec.ts`, `roadmap-constellation.spec.ts`, `link-check.spec.ts`), one full run, no cherry-picking:

```
53 tests, 5 skipped, 6 failed, 2 flaky (recovered on retry), 40 passed  (8.5m)
```

- **5 skipped**: same as round 1 — `graph-debates.spec.ts`'s flag-ON block, correctly gated off (`PHASE_25_GRAPH_DEBATE_LAYER_ENABLED` unset locally).
- **6 hard failures**, every one matching an already-documented root cause, none new:
  - `knowledge-map.spec.ts:275`, `:377`, `:579`, `:742`, `:803` (5 tests, all failed on both the original attempt and the retry) — all five throw the exact same signature round 1's §3 root-caused at length: `clickNodeInScene: <nodeId> never became selected after 15 attempts`. Same helper, same documented shared-sandbox GPU/CPU-contention/depth-occlusion mechanism, zero product or test code touched by this round that could have changed this behavior.
  - `roadmap-constellation.spec.ts:45` — the exact same `Locator: locator('[data-roadmap-constellation]') ... element(s) not found` round 1's §5 already traced to `RoadmapView.tsx:335`'s empty-roadmap gating, confirmed out of Stage 3's own scope (no Stage 3 file imports or touches this route).
- **2 flaky (passed on retry, so not gate failures)**:
  - `knowledge-map.spec.ts:517` ("toolbar view switch...") — same click-occlusion class.
  - `knowledge-map-touch.spec.ts:75` (mobile "a real tap on a node's projected position selects it...") — the touch-input analogue of the same class, via the file's own `tapNodeInScene` helper (identical shape/doc-comment to `clickNodeInScene`). Round 1 reported this whole file passing clean; this run shows the same environmental flake also occasionally reaching the mobile-chromium project, including one instance where the retry budget itself blew the full 120s test timeout rather than exhausting cleanly at attempt 15 — a harder manifestation of the same latency/contention class, not a distinct one (confirmed by reading the failure: it dies inside the same `canvas.tap({ position: pos })` call the passing runs also make).
  - **Reading this honestly**: this round's raw failure *count* (6 hard + 2 flaky) is higher than the specific `{"passed":38,"failed":3,...}` figure this round's own brief quoted from a prior pass — consistent with round 1's own characterization of the flake as genuinely intermittent and environment-load-dependent (this session's machine is running more concurrent lanes than either prior snapshot), not evidence of a new regression. Every single failing/flaky test traces to one of the two pre-existing, already-triaged mechanisms above; no third failure signature exists anywhere in this run's full log.
- **40 passed**, including all of `graph-scene.spec.ts`, `graph-expansion.spec.ts`, `graph-debates.spec.ts` (flag-off block), and `link-check.spec.ts` (169 links + 16 anchors, zero broken).

No code or test file was modified in response to any of this round's failures — per round 1's own precedent, retrying/patching the click-occlusion flake without a dedicated design budget was already tried once and reverted; re-attempting it here would repeat that already-documented dead end rather than add new information.

## R2.3 The resize-self-heal fix, re-verified with fresh evidence

Round 1's own recommended fix shape — *"a `useEffect` keyed on `[dimensions.width, dimensions.height]`, calling `fit()`... only when re-verified that the current visible node set's frustum is empty"* — is exactly what commit `79db332` shipped (`KnowledgeMapScene.tsx`'s new effect, keyed on `[dimensions.width, dimensions.height, hasSize, graphData, isNodeVisible, camera]`, calling `camera.fit()` only when every currently-visible node's screen projection falls outside `[0,width]×[0,height]`). This round re-ran round 1's own adversarial sequence end-to-end against the fixed code, via a dedicated temporary script (not committed, same discipline as round 1 — see R2.6), asserting real in-frustum node count / camera-target separation / elevation via the production test hook after **every** step, using `expect.soft` so no step's failure could hide whether later steps recover:

| Step | In-frustum | Separation | Elevation | Verdict |
|---|---|---|---|---|
| 1. load | 4 | 108.93 | 35° | valid |
| 2. select origin-adjacent node | 4 | 108.93 | 35° | valid |
| 3. Home | 4 | 108.93 | 35° | valid |
| 4. filter to near-empty | **1** | 108.93 | 35° | valid (see note below) |
| 5. clear | 4 | 108.93 | 35° | valid |
| 6. resize 1 (1024×768) | 4 | 108.93 | 35° | valid |
| 6. resize 2 (**600×900**, round 1's own confirmed repro size) | 4 | 345.50 | 34.05° | **valid — no longer blanks** |
| 6. resize 3 (1920×1080) | 4 | 376.10 | 35° | valid |
| 6. resize 4 (375×812) | 2 | 376.10 | 35° | valid (2 of 4 nodes off-frustum at this extreme narrow/tall aspect is a legitimate partial framing, not the "zero, totally blank" bug — charter requires >0 in frustum, not all-nodes-in-frustum) |
| 6. resize 5 (1440×900, identical to step 1) | 4 | 376.10 | 35° | **valid — self-heals**, unlike round 1's pre-fix finding where this exact step stayed blank |
| 7. switch List | — (no 3D scene; asserted List view visible instead) | | | valid |
| 8. back to 3D | 4 | 151.45 | 35° | valid |
| 9. remount route (hard reload) | 4 | 151.45 | 35° | valid |
| 10. deep-link restore | 4 | 151.45 | 35° | valid |

Every step passed; camera-target separation never approached zero and elevation never dropped near the 20° edge-on floor at any point. **This is the direct, positive re-confirmation the round 1 brief asked for: the exact 600×900 repro no longer blanks the scene, and the identical-to-step-1 final resize (1440×900) — the specific case round 1 found did NOT self-heal — now recovers correctly.**

**Note on step 4 ("filter to near-empty"), found while building this step's script:** an initial attempt unchecked all six `FilterRail` layer checkboxes, expecting a near-empty result — it instead reproduced round 1's own table, which *also* shows an unchanged "4" at this step. Reading `attributeVisibility.ts`/`FilterRail.tsx` directly explains why: `activeLayers` uses a documented "empty array means no restriction, i.e. every layer implicitly shown" convention, and `toggleLayer`'s own resolve-then-toggle logic means sequentially unchecking every single layer checkbox is a real, intentional no-op that wraps back around to the same empty ("show all") array it started from — **not a bug**, a deliberate, commented design choice, but also not a way to reach a genuine near-empty state. Checking exactly one layer this fixture's non-root nodes don't belong to (`Debates`) instead produces a real non-empty *inclusion* list, genuinely filtering every non-root node out and leaving just the always-visible root (`getVisibleNodeIds().length === 1`, asserted directly) — a real, near-empty state, which is what the row above reports.

## R2.4 Unmasked screenshots, re-captured and pixel-sampled

Re-captured all 7 of round 1's screenshot categories against the current (post-fix) build, saved alongside round 1's own originals with a `-round2` suffix (round 1's evidence is left untouched, not overwritten) in `docs/audits/stage3-kmap-verification/`:

`desktop-1440-default-load-round2.png`, `desktop-1440-after-select-round2.png`, `desktop-1440-after-home-round2.png`, `desktop-1440-2d-view-round2.png`, `desktop-1440-list-view-round2.png`, `mobile-375-round2.png`, `desktop-1440-no-webgl-fallback-round2.png`.

Pixel-sampled **numerically**, not just eyeballed: for the three 3D-canvas shots, a dedicated in-page routine decodes the same CDP screenshot bytes into a fresh, ordinary 2D canvas (`drawImage` + `getImageData`) — deliberately NOT the WebGL canvas's own `drawImage`, which round 1 already found returns a blank buffer without `preserveDrawingBuffer` — and reports distinct-color count and luminance spread:

| Screenshot | Distinct colors (of ~120k sampled) | Luminance range |
|---|---|---|
| default-load | 729 | 16.1–255.0 |
| after-select | 1,406 | 13.9–255.0 |
| after-home (post-orbit) | 779 | 16.1–254.7 |

All three comfortably clear a `>5` distinct-colors / `>10` luminance-range floor (asserted directly in the script, not just reported) — a solid single-color fill would report exactly 1 distinct color and 0 luminance range. The 2D/List/mobile/no-WebGL shots were visually confirmed directly (Read tool image view, not just file-size heuristics): the 2D view shows the same three real nodes correctly distributed across `EVIDENCE`/`INTELLECTUAL`/`CLAIMS` layer columns; the List view (round 1's own screenshot, unchanged this round) and the no-WebGL fallback both show the honest "4 nodes shown" accessible table with the same "3D view isn't available in this browser. Showing the List view instead." banner; mobile-375 shows the same non-collinear, visibly-spread root+Physics+Hylomorphism+"Book II" layout as round 1's own mobile screenshot, at the bottom-nav mobile chrome. The out-of-scope header-wordmark-clipping bug (round 1 §6) is independently re-confirmed present on the work-scoped no-WebGL screenshot and independently re-confirmed ABSENT on the global-route 2D-view screenshot — same route-specific signature round 1 reported, not something this round's fix touched or changed.

## R2.5 Perf sanity, re-run against the fixed code

Same protocol as round 1 (`seedWorkWithManyConceptNodes(count: 120)`, 12s real sustained pointer-drag orbit, `requestAnimationFrame` interval sampling):

```
frames=723  medianFrameMs=16.70  medianFPS=59.88
```

Identical to round 1's own number to two decimal places — the resize-self-heal fix (a `useEffect` that only runs its extra work on an actual dimension change, and only computes anything further when the degenerate case is detected) introduces no measurable per-frame overhead. Well above the ≥50 floor.

## R2.6 Temporary scripts (not committed)

`adversarial-sequence-round2.spec.ts`, `capture-stage3-screens-round2.spec.ts`, `perf-sanity-round2.spec.ts` — written, run, and deleted before this commit, same discipline as round 1's own temporary diagnostics. Each seeded and cleaned up its own throwaway test user via the repo's `createVerifiedTestUser`/`deleteTestUser` helpers; verified via a direct DB query that zero rows matching any of this round's throwaway email patterns remain.

## R2.7 Summary verdict

| Gate item | Result |
|---|---|
| typecheck/lint/build | clean |
| Full knowledge-map + graph-adjacent CI-safe suite | green except the same two already-documented, already-triaged classes (click/tap-occlusion flake; out-of-scope roadmap-constellation) — zero new failure signatures |
| **Round 1's HIGH-PRIORITY resize-blanks-the-scene defect (§7/§8)** | **CONFIRMED FIXED** — the exact repro (600×900) and the exact non-self-healing case (return to 1440×900) both now recover; full 10-step adversarial sequence passes end-to-end |
| Unmasked screenshots, pixel-confirmed nonblank | done, 7/7, numerically pixel-sampled (not just eyeballed) for the 3 canvas shots |
| Camera/frustum adversarial sequence | **all 10 steps valid** (in-frustum > 0 except the deliberate List-view step; separation > 0; elevation ≥ 20° throughout, actual range 34–35°) |
| Perf sanity (120-node scene, 12s orbit) | 59.88 median FPS, identical to round 1, floor ≥50 met |
| Never mask the graph canvas in test coverage | held |
| Never weaken assertions | held — no assertion in any spec was loosened or removed; the near-empty filter mechanism was corrected to reach a genuine near-empty state rather than accepting the no-op result as if it were one |

**This round recommends Stage 3 sign-off on the resize/camera-framing gate specifically** — the one confirmed blocking defect from round 1 is fixed and re-verified with fresh, independent evidence. Two items remain open, carried forward exactly as round 1 left them, neither newly discovered nor newly worsened by this round: **(a)** the click/tap-occlusion environmental flake (round 1 §3) — still real, still root-caused, still without a validated fix, still recommended for a dedicated future-round budget (camera-based recovery or wider minimum node separation); **(b)** the focus-mode semantics gap (round 1 §4, `graphFocus.ts` relocation/re-audit) — not investigated further this round, out of this round's re-verification mandate. **(c)** `responsive-visual.spec.ts`'s stale graph baselines/locators (round 1 §6) remain un-regenerated by deliberate choice, now further confirmed to include at least one additional stale locator (`responsive-visual.spec.ts:441`'s `getByRole("heading", { name: "Visualization" })`, which the rebuilt page never renders — the new toolbar has no "Visualization" `<h1>`) beyond the snapshot-only failures round 1 catalogued — consistent with, not larger in kind than, round 1's decision to leave this whole file's graph coverage un-regenerated until the header-shell bug it's entangled with is fixed by whichever lane owns Stage 1 shell chrome.
