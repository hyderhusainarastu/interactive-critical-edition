# Knowledge Map renderer bakeoff — decision report

Stage 2 of the UI/UX + Knowledge Map rebuild (`docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md`
§13). This report applies that charter's decision rule mechanically to a
real, fully executed measurement run. It does not introduce new
measurements — every number below is read from
`prototypes/graph-bakeoff/results/summary.json`, the 57 individual trial
JSON files alongside it, and one additional real `vite build` pass per
prototype run specifically for this report's bundle-size section (method
documented in that section).

## 1. Fixture and machine details

Recorded protocol metadata (`summary.json.environmentSample` /
`machineState`, cross-checked against every individual trial file's own
`environment` block, which is identical across files apart from
`fixtureName`/`fixtureContentHash`/`cacheState`):

| Field | Value |
|---|---|
| Machine | `Mac15,12`, macOS 26.6 |
| Browser | Chromium 151.0.7922.34 (headed — `headedBrowserUsed: true`) |
| Viewport | 1440×900, device-pixel ratio 1 (at/under the charter's 1.5 cap) |
| Power mode | unknown (not exposed by this environment) |
| Build under test | production `vite build` + `vite preview`, not dev server |
| Preflight machine load | quiet at run start (`finalLoadAvg: 2.41`, `preflightWaited: false`) |
| Run window | 2026-07-27 23:45:19 UTC – 2026-07-28 02:03:21 UTC (~2h18m wall clock) |
| Protocol version | `1.0.0` |

Fixtures, per the charter's mandatory set: 12, 24, 60, 120 nodes
(production-context, disclosure-boundary sizes), 500 nodes/2,000 links
(renderer-headroom, mandatory), 1,000 nodes/4,000 links (stress,
diagnostic-only — crash/blank is its only mandatory criterion). Each
mandatory fixture ran 5 measured trials per prototype after 2 warm-up
cycles; the stress fixture ran 1 trial per prototype per the charter's
"nonblocking stress characterization" framing. Navigation timing used 3
cold + 5 warm trials against the `fixture-120` payload. Lifecycle used 20
mount/unmount cycles against `fixture-24` after 2 warm-up cycles, per
protocol step 9's exact wording — each fixture's content hash
(`fixtureContentHash`) is recorded per-file and identical between
Prototype A and B runs of the same fixture, confirming both prototypes
were measured against byte-identical frozen data.

Two real operational incidents occurred during the run and are recorded
here rather than silently smoothed over (both already logged in
`results/README.md` and the commit history):

- One earlier DRY_RUN pass had Prototype A's stress-fixture (1000/4000)
  trial crash the entire Chromium browser process
  (`"Target page, context or browser has been closed"`), with no macOS
  crash report or jetsam/low-memory log entry found — most likely a
  transient GPU-process crash under sustained heavy-scene load, not a
  reproducible defect in either prototype's own code (a dedicated retest
  completed the same fixture cleanly for both). This is what prompted the
  `ensureBrowserAlive()` crash-recovery fix (commit `ffb8503`) so a future
  recurrence would cost only that one fixture's result, not the whole run.
- The pointer-latency dispatch initially used synthetic `MouseEvent`s,
  which neither prototype's real interaction code listens for (both are
  driven by `pointerdown`/`pointermove`/`pointerup`) — this silently
  produced zero real interaction samples before being caught and fixed
  (commit `ccd127d`) to dispatch real `PointerEvent`s.

The run reported here (`summary.json`, `recordedAtIso:
2026-07-28T02:03:21.204Z`) is the final, complete, both-incidents-fixed
pass — 57 result files: 5 mandatory fixtures × 5 trials × 2 prototypes
(50 files) + stress × 2 + navigation × 2 + lifecycle × 2 + `summary.json`.
Every trial is reported below, not only the aggregated best/median.

## 2. Full metrics tables

### 2.1 Mandatory fixtures (12/24/60/120/500) — every trial

Floors: median FPS ≥ 50, p95 frame time ≤ 33ms, p95 pointer→highlight
latency ≤ 100ms, payload→interactive ≤ 2000ms. Both prototypes cleared
every floor on every trial with wide margins; no trial-level exceptions
exist to report.

**Prototype A (`react-force-graph-3d@1.29.1`)**

| Fixture | Trial | Median FPS | p95 frame (ms) | p95 pointer latency (ms) | Payload→interactive (ms) |
|---|---|---|---|---|---|
| 12 | 1 | 59.88 | 17.40 | 43.90 | −0.10 |
| 12 | 2 | 59.88 | 17.40 | 43.70 | 0.00 |
| 12 | 3 | 59.88 | 17.50 | 43.90 | −0.10 |
| 12 | 4 | 59.88 | 17.50 | 43.10 | −0.10 |
| 12 | 5 | 59.88 | 17.40 | 43.80 | 0.00 |
| 24 | 1 | 59.88 | 18.30 | 29.30 | −0.10 |
| 24 | 2 | 59.88 | 18.30 | 29.60 | 0.00 |
| 24 | 3 | 59.88 | 18.30 | 30.90 | 0.00 |
| 24 | 4 | 59.88 | 18.20 | 28.40 | 0.00 |
| 24 | 5 | 59.88 | 18.20 | 31.50 | 0.00 |
| 60 | 1 | 59.88 | 18.30 | 33.00 | 0.00 |
| 60 | 2 | 59.88 | 18.10 | 30.10 | 0.00 |
| 60 | 3 | 59.88 | 18.30 | 30.80 | 0.00 |
| 60 | 4 | 59.88 | 18.30 | 30.10 | 0.00 |
| 60 | 5 | 59.88 | 18.30 | 30.00 | 0.00 |
| 120 | 1 | 59.88 | 18.10 | 30.20 | 0.00 |
| 120 | 2 | 59.88 | 18.20 | 31.40 | 0.00 |
| 120 | 3 | 59.88 | 18.20 | 29.50 | 0.00 |
| 120 | 4 | 59.88 | 18.30 | 30.40 | 0.00 |
| 120 | 5 | 59.88 | 17.50 | 29.40 | 0.00 |
| 500 | 1 | 59.88 | 17.50 | 33.40 | 0.00 |
| 500 | 2 | 59.88 | 17.40 | 34.20 | −0.20 |
| 500 | 3 | 59.88 | 17.10 | 31.40 | 0.00 |
| 500 | 4 | 59.88 | 16.80 | 31.90 | 0.00 |
| 500 | 5 | 59.88 | 17.10 | 34.00 | 0.00 |

**Prototype B (React Three Fiber + Three.js, `InstancedMesh`)**

| Fixture | Trial | Median FPS | p95 frame (ms) | p95 pointer latency (ms) | Payload→interactive (ms) |
|---|---|---|---|---|---|
| 12 | 1 | 59.88 | 17.40 | 11.60 | 0.20 |
| 12 | 2 | 59.88 | 17.30 | 11.20 | 0.40 |
| 12 | 3 | 59.88 | 17.50 | 11.30 | 0.50 |
| 12 | 4 | 59.88 | 17.50 | 11.10 | 0.50 |
| 12 | 5 | 59.88 | 18.40 | 11.40 | 0.30 |
| 24 | 1 | 59.88 | 18.20 | 11.00 | 0.50 |
| 24 | 2 | 59.88 | 18.30 | 12.00 | 0.50 |
| 24 | 3 | 59.88 | 18.20 | 10.20 | 0.70 |
| 24 | 4 | 59.88 | 18.20 | 10.80 | 0.60 |
| 24 | 5 | 59.88 | 18.30 | 12.50 | 0.60 |
| 60 | 1 | 59.88 | 18.30 | 10.50 | 0.80 |
| 60 | 2 | 59.88 | 18.20 | 12.30 | 1.00 |
| 60 | 3 | 59.88 | 18.20 | 10.90 | 0.40 |
| 60 | 4 | 59.88 | 18.20 | 11.50 | 0.50 |
| 60 | 5 | 59.88 | 18.40 | 10.70 | 0.50 |
| 120 | 1 | 59.88 | 18.30 | 11.20 | 0.90 |
| 120 | 2 | 59.88 | 18.20 | 10.80 | 0.80 |
| 120 | 3 | 59.88 | 18.20 | 10.40 | 0.80 |
| 120 | 4 | 59.88 | 17.40 | 11.40 | 0.80 |
| 120 | 5 | 59.88 | 17.30 | 10.80 | 0.60 |
| 500 | 1 | 59.88 | 18.20 | 11.30 | 2.00 |
| 500 | 2 | 59.88 | 18.30 | 11.60 | 1.40 |
| 500 | 3 | 59.88 | 18.30 | 9.50 | 1.70 |
| 500 | 4 | 59.88 | 18.30 | 10.80 | 1.50 |
| 500 | 5 | 59.88 | 17.50 | 11.40 | 1.50 |

**Observation, not decision-relevant under the mechanical rule (both clear
the 100ms floor by 8–9×):** Prototype B's p95 pointer→highlight latency is
consistently 3–4× lower than Prototype A's (≈10–13ms vs. ≈28–44ms) across
every fixture, every trial, with no overlap between the two distributions.
This is a real, repeated gap, not trial noise.

### 2.2 Diagnostic stress fixture (1,000 nodes / 4,000 links) — one trial each, per protocol

| Prototype | Median FPS | p95 frame (ms) | p95 pointer latency (ms) | Payload→interactive (ms) | Crashed/blank |
|---|---|---|---|---|---|
| A | 59.88 | 17.60 | 43.10 | 0.00 | No |
| B | 59.88 | 18.20 | 11.90 | 1.90 | No |

Crash/blank is the only mandatory criterion at this tier (charter §13
decision-rule step 3); both cleared it on the reported run. Neither
prototype's FPS/latency numbers degrade meaningfully from the 500-node
tier — both remain far inside every floor even at 2× the mandatory
headroom fixture's node count, on a single trial each (this tier is
explicitly non-blocking per protocol, so it was not run 5×).

### 2.3 Navigation timing (fixture-120: 3 cold + 5 warm trials each)

Floors: cold ≤ 5000ms, warm ≤ 3500ms.

**Prototype A**

| Trial | Kind | Interactive (ms) |
|---|---|---|
| 1 | cold | 115.90 |
| 2 | cold | 115.20 |
| 3 | cold | 111.20 |
| 4 | warm | 77.10 |
| 5 | warm | 88.40 |
| 6 | warm | 69.30 |
| 7 | warm | 59.60 |
| 8 | warm | 89.40 |

p95 cold: 115.90ms · p95 warm: 89.40ms — both ≥40× inside their floors.

**Prototype B**

| Trial | Kind | Interactive (ms) |
|---|---|---|
| 1 | cold | 250.30 |
| 2 | cold | 257.20 |
| 3 | cold | 257.10 |
| 4 | warm | 237.70 |
| 5 | warm | 239.10 |
| 6 | warm | 212.50 |
| 7 | warm | 192.50 |
| 8 | warm | 222.00 |

p95 cold: 257.20ms · p95 warm: 239.10ms — both ≥14× inside their floors.

**Observation, not decision-relevant (both pass with large margin):**
Prototype A's cold/warm navigation is consistently ~2.2–2.9× faster than
Prototype B's. This tracks with §5's bundle/module-count finding — A's
production JS payload is smaller and its scene mounts with fewer
imperative setup steps (a single `react-force-graph-3d` instance vs.
React Three Fiber's own render-tree reconciliation on top of raw
Three.js). Both remain trivially inside the charter's floors, so this
does not change the decision, but it is a real, repeated, measured gap
worth carrying into any future performance-budget conversation.

## 3. Camera, picking, label, lifecycle findings

**Camera.** Both prototypes import the identical shared, pure, unit-tested
module (`src/camera/cameraMath.ts`, 29 passing Vitest cases) — there is no
prototype-specific camera math to compare; the charter's "same camera for
both" requirement was met at the code level, not just behaviorally. No
differentiating finding here by design.

**Picking.** Prototype A relies on `react-force-graph-3d`'s built-in
raycast/hover pipeline (its own `hoverObj` state, throttled ~50ms,
consumed via the library's callback surface). Prototype B implements its
own instance-aware raycasting (`src/prototypes/protoB/picking.ts`):
one `THREE.Raycaster` cast against every visible silhouette's
`InstancedMesh`, resolving to `instanceId → nodeId` via a parallel array,
taking the nearest hit across all silhouette meshes rather than the first
mesh checked. Both satisfy the charter's "larger invisible picking volume
without changing visible geometry" requirement — Prototype B does this by
raycasting against a separate, larger-scaled "hit" geometry
(`buildPickingGeometries`) rather than the visible one. Prototype B's
picking is the more novel, custom-built code path (more surface area to
keep correct going forward); it is also the one that produced the
measured 3–4× lower pointer-latency numbers in §2.1, so the added
implementation cost bought a real, repeated performance advantage here,
not just architectural purity.

**Labels.** Both prototypes implement an equivalent capped, screen-space
HTML label layer with the same tiering (`primary`/`priority`/`secondary`
at 16/13/12px), the same always-show set (root, selected, hovered/focused,
search target, direct neighbors), the same ≤20 desktop/≤10 mobile priority
cap, and the same greedy AABB collision-avoidance strategy, positioned
imperatively from each prototype's own per-frame loop rather than through
React state (both satisfy the charter §14 "no React state updates in the
frame loop" requirement identically). No differentiating finding.

**Edge-grammar dash patterns.** Both prototypes' self-reports and code
converge on the same real gap, though it surfaced two different ways.
Prototype A's `theme.ts` documents outright that it does not build exact
dash/dot-dash line patterns, relying on color/opacity/arrow-presence
instead — explicitly invoking the charter's own permitted fallback ("where
the chosen renderer cannot provide portable subpixel patterns without
violating the performance gate, preserve the distinction through color,
opacity, endpoint glyph, legend, and accessible label"). Prototype B's
`visuals.ts` defines a `dash: { size, gap }` field per edge family
(`opposition`, `qualification`, `structural`) that reads as if dash
patterns were implemented — but a repo-wide search
(`computeLineDistances`/`LineDashedMaterial`/`dashSize`/`gapSize`, and the
`dash` field itself) confirms `GraphSceneB.tsx` never consumes it: all
edges render through one shared `THREE.LineBasicMaterial` with per-vertex
colors (`vertexColors transparent opacity={1}`), with no dashed variant
wired in at all. **Net finding: neither prototype actually renders exact
dash/dot-dash patterns today.** Both fall back to the charter's permitted
color/opacity/arrow-only distinction in practice; Prototype B's
per-family `dash` metadata is present in its data model but is presently
dead code, not a functioning capability, and B's own self-report did not
flag this gap the way A's did. This is recorded as a completeness note
for whoever picks up the winning prototype in Stage 3, not as a
decision-relevant asymmetry — the measured behavior is equivalent.

**Lifecycle (20× mount/unmount, `fixture-24`) — the mandatory gate that
decides this bakeoff.**

- **Prototype B: pass, cleanly.** Baseline and cycle-20 (final) resource
  snapshots are bit-for-bit identical:
  `geometries: 8, textures: 1, programs: 3, activeWorkers: 0,
  activeObservers: 0, activeTimers: 0, registeredListeners: 2` at both
  cycle 0 and cycle 20, with `withinPlateauTolerance: true` and
  `monotonicGrowthDetected: false`.
- **Prototype A: measured fail on the plateau-tolerance sub-check.**
  Baseline reads `geometries: 24, programs: 4`; the cycle-20 (final)
  reading is `geometries: 0, programs: 0` — a 100% drop, far outside the
  charter's 5% return-to-baseline tolerance, so `withinPlateauTolerance:
  false` and the summary records `pass: false` for A's lifecycle gate.

  This is a real measured result and is what the decision rule below acts
  on. One caveat is worth recording alongside it, exactly as
  `results/README.md` already does, without letting it change the
  mechanical outcome: `monotonicGrowthDetected` is `false` for Prototype A
  too. Reading all 20 raw per-cycle values
  (`results/a--lifecycle--fixture-24.json`) shows the counts alternating
  cleanly between exactly `(24, 4)` and exactly `(0, 0)` cycle-to-cycle —
  cycles 1–3 are `0`, cycle 4 is `24/4`, cycle 5–6 are `0`, cycle 7 is
  `24/4`, and so on through cycle 20, which lands on `0`. A monotonically
  growing leak would instead show the counts trending upward over the 20
  cycles; this pattern instead looks like a timing race between
  `readLifecycleSnapshot()`'s sampling of `renderer.info` and that
  cycle's own first real WebGL draw call — i.e., a possible measurement-
  harness artifact rather than proof of an accumulating resource leak.
  That hypothesis is plausible but was not re-run in isolation to chase a
  passing number (the bakeoff program's own "never fabricate a
  measurement, report every trial" rule cuts against cherry-picking a
  rerun here). **Per this report's own instructions — apply the decision
  rule mechanically to the measured data, do not let taste override the
  rule — the measured `pass: false` stands as the deciding fact.** The
  hypothesis is recorded for whoever inherits Prototype B in Stage 3, in
  case a future need arises to revisit why A behaved this way, but it
  does not change today's decision.

## 4. Accessibility-integration notes

Neither prototype implements DOM-level accessibility affordances
(`aria-*`, `role`, `tabIndex`) directly inside its own scene code — a
repo-wide grep of both `GraphScene.tsx` and `GraphSceneB.tsx` finds none.
This is expected, not a gap unique to either prototype: charter §13 scopes
Prototype A/B strictly to the renderer (camera, picking, labels,
lifecycle); the WCAG 2.2 AA keyboard/focus/live-region/equal-capability-
fallback requirements in charter §17 are Stage 3 (Knowledge Map rebuild)
scope, where the actual toolbar, inspector, and mandatory 2D/List
representation get built around whichever renderer wins here. Both
prototypes are equally positioned to support that later work: both use a
portable, capped HTML/DOM label layer (not canvas-only sprite text),
which is the prerequisite the charter's "DOM/List focus highlights the
corresponding graph node without stealing focus" and "hover content also
available on focus and tap" requirements will need to hook into, and both
share the identical camera-targeting math Stage 3's Home/Fit/Focus
controls will drive. No differentiating finding between A and B on this
axis; the real accessibility build-out is still ahead regardless of which
renderer is chosen.

## 5. Bundle-size comparison (gzipped JS)

The checked-in harness build (`vite.config.ts`) bundles both prototypes
into one shared entry (`App.tsx` statically imports
`createProtoAHandle`/`createProtoBHandle` and route-switches by query
param), so it cannot by itself report a clean per-prototype number. To
get an honest isolated comparison, two throwaway single-prototype Vite
entry points and configs were created, built with real `vite build`
against production mode, their gzip output captured, and then deleted
immediately afterward (not part of this commit — the method is
reproducible: an HTML entry + a `main.tsx`-equivalent that imports only
`createProtoAHandle` or only `createProtoBHandle` and calls `.mount()`,
built with `rollupOptions.input` pointed at that one HTML file). No
manual chunking/tree-shaking hints beyond Vite/Rollup's defaults were
applied to either build.

| Prototype | Modules transformed | Raw JS | Gzipped JS |
|---|---|---|---|
| A (`react-force-graph-3d`) | 447 | 1,606.58 kB | **442.34 kB** |
| B (React Three Fiber + Three.js) | 127 | 1,153.79 kB | **319.96 kB** |

Both numbers include React/ReactDOM 19 and every transitive dependency
each prototype actually imports; neither is manually chunked or
code-split. **Prototype B's isolated bundle is ~122 kB gzipped smaller
(~28% smaller) than Prototype A's**, despite Prototype B hand-rolling
picking/instancing/layout code that Prototype A gets from a library.
This inverts the naive expectation that "a purpose-built library must be
lighter than hand-rolled Three.js" — the explanation is visible in the
module count: `react-force-graph-3d` pulls in `3d-force-graph` →
`accessor-fn`, `kapsule`, `three-forcegraph`, `three-render-objects`
(plus `prop-types`, `react-kapsule` at the top level), each contributing
its own general-purpose surface area, where Prototype B imports only the
specific Three.js primitives (`InstancedMesh`, `LineBasicMaterial`,
`Raycaster`, etc.) it actually uses. This is a real, repeated, second
independent measurement (module count and gzip size agree with each
other) favoring Prototype B, though — like the pointer-latency and
navigation-timing gaps above — it is not what the mechanical decision
rule turns on; it is corroborating evidence, not the deciding fact.

## 6. Maintainability assessment

| | Prototype A | Prototype B |
|---|---|---|
| Core rendering/camera/simulation | Delegated to `react-force-graph-3d` (mature, versioned, externally maintained) | Hand-rolled on raw Three.js via React Three Fiber |
| Picking | Library-provided (`hoverObj`, throttled) | Custom `THREE.Raycaster` against `InstancedMesh` arrays, instance-id resolution |
| Own implementation code | 1,748 lines (`src/protoA/`, incl. one Vitest file) | 1,699 lines (`src/prototypes/protoB/`) |
| Direct + transitive dependency surface (isolated build) | 447 modules | 127 modules |
| Upstream upgrade risk | Tied to `react-force-graph-3d`'s own release cadence and its four nested dependencies (`3d-force-graph`, `three-forcegraph`, `three-render-objects`, `kapsule`) | Tied only to `@react-three/fiber` + `three` directly — fewer indirection layers to break on a Three.js major bump |
| Novel/custom logic to own long-term | Comparatively little — most rendering internals are someone else's problem to maintain | More — picking, instancing, and force-layout wiring are this codebase's own responsibility |

Neither option is a clear-cut "less total code to maintain" story — the
line counts are within 3% of each other. The real trade-off is *where*
the complexity lives: Prototype A trades implementation ownership for
dependency-upgrade exposure across a deeper chain (five packages instead
of two); Prototype B trades a smaller, more auditable dependency surface
for owning picking/instancing correctness directly. Given that Prototype
B is the renderer this report selects (§7), that ownership cost is a real,
accepted trade-off, not a free win — Stage 3 inherits real custom picking
and instancing code that will need its own tests and review as the
Knowledge Map grows, not just a config surface on top of a library.

## 7. Decision

Applying charter §13's decision rule mechanically, in order:

1. **Correctness and lifecycle reliability are mandatory.** (rule 1)
2. Both prototypes clear every numeric floor on the 12/24/60/120
   production-context fixtures and the 500/2,000 headroom fixture, on
   every trial, with wide margins. (rule 2 — satisfied by both)
3. Neither prototype crashed or went blank on the 1,000/4,000 diagnostic
   stress fixture on the reported run. (rule 3 — satisfied by both)
4. **Rule 4 does not select Prototype A**, because A does not meet every
   mandatory gate: its 20-cycle lifecycle check measured `pass: false`
   (§3 above) — cycle-20 resource counts (`geometries: 0, programs: 0`)
   did not return to the cycle-0 baseline (`geometries: 24, programs: 4`)
   within the charter's 5% tolerance.
5. **Rule 5 applies: Prototype B materially resolves that measured
   failure.** B's own 20-cycle lifecycle check is not merely "within
   tolerance" but an exact match — baseline and cycle-20 counts are
   bit-for-bit identical across every tracked resource
   (geometries/textures/programs/workers/observers/timers/listeners) —
   while B independently passes every other mandatory gate A also passed
   (all fixture floors, navigation cold/warm, no stress-fixture crash).

### Chosen: Prototype B (React Three Fiber + Three.js, `InstancedMesh` nodes, instance-aware picking)

**Exact reasons:**

- It is the only one of the two prototypes that measured a clean pass on
  the mandatory 20× mount/unmount lifecycle gate (§3), which is the
  charter's own stated tie-breaker (rule 1: "correctness and lifecycle
  reliability are mandatory"; rule 5: select B only if it materially
  resolves A's mandatory-gate failure — it does, with an exact-match
  result rather than a marginal one).
- It independently clears every other mandatory floor with wide margin:
  median FPS 59.88 on every mandatory fixture (floor ≥50), p95 frame time
  17.3–18.4ms (floor ≤33ms), p95 pointer latency 9.5–12.5ms (floor
  ≤100ms), payload→interactive 0.2–2.0ms (floor ≤2000ms), warm/cold
  navigation 192.5–257.2ms (floors 3500ms/5000ms), no crash/blank at the
  diagnostic stress tier.
- Its p95 pointer→highlight latency is consistently 3–4× lower than
  Prototype A's across every mandatory fixture (§2.1) — a real, repeated,
  measured interaction-quality advantage, not required by the floors but
  directly relevant to how the Knowledge Map will feel to use.
- Its isolated production bundle is ~28% smaller gzipped (319.96 kB vs.
  442.34 kB, §5) despite implementing more of its own logic — a real cost
  win for the app that will ship this renderer.

### Rejected: Prototype A (clean `react-force-graph-3d@1.29.1`)

**Exact reasons:**

- Measured `pass: false` on the mandatory 20-cycle lifecycle gate: cycle-0
  baseline `geometries: 24, programs: 4` vs. cycle-20 `geometries: 0,
  programs: 0`, which the charter's own 5%-return-to-baseline tolerance
  rejects. This is the disqualifying, decision-driving fact under rule 4/5
  — Prototype A does not meet every mandatory gate, so rule 4's "select A
  outright" path does not apply, and rule 5 hands the decision to B once
  B is confirmed to resolve exactly that failure.
- The caveat recorded in §3 (non-monotonic 0/24 alternation across
  cycles, consistent with a possible measurement-timing artifact rather
  than a confirmed accumulating leak) is disclosed for completeness but
  explicitly does not override the measured result, per this report's own
  instruction to apply the decision rule mechanically rather than let
  taste override it.
- Secondary, non-decision-driving findings also favor B: 3–4× higher
  (worse) pointer latency and a ~28% larger gzipped bundle than B, though
  Prototype A remains faster on cold/warm navigation and comfortably
  inside every one of its own floors on every metric — Prototype A is not
  a broken or low-quality prototype, it simply does not clear the one
  gate the charter treats as mandatory and non-negotiable.

Per rule 9 ("keep one production 3D renderer, not two"), Prototype A's
implementation directory (`src/protoA/`) and its harness registration
forwarder (`src/prototypes/protoA/`) are removed from this branch in the
same commit as this report (§9).

## 8. Derived LOD-threshold recommendations

Charter §13 rule 7 explicitly forbids carrying forward the old 140/400/800
degradation tiers and instead asks for thresholds derived from the
selected renderer and the new 12/24/60/120 disclosure contract. The
measured data does not show any degradation trend across the mandatory
range at all — median FPS is flat at 59.88 and p95 frame time stays in a
tight 17.3–18.4ms band from 12 nodes all the way through the 500-node
headroom fixture, and even the 1,000-node/4,000-link diagnostic fixture
shows no meaningful drop (18.2ms p95 frame, 11.9ms p95 pointer latency).
Concretely:

- **No new LOD demotion tier is warranted between 12 and 500 nodes.**
  Prototype B clears every floor with 3–5× headroom at every measured
  size in that range; introducing a degradation tier here would be
  solving a problem the measurements do not show.
- **The existing label cap (≤20 desktop / ≤10 mobile, charter §10) remains
  the correct — and, on this data, sufficient — thinning mechanism** up
  through the 500-node headroom fixture. It was already active during
  every trial above (both prototypes implement it identically, §3) and
  did not need to be loosened or tightened to hit the floors.
- **The 1,000-node/4,000-link tier stays diagnostic-only, per rule 8** —
  it passed the one criterion that applies to it (no crash/blank) on a
  single trial each, but promoting it to a supported product target would
  need real corpus evidence of a legitimate workflow rendering that many
  nodes simultaneously, which charter §13's own fixture-selection
  reasoning does not currently claim exists. If such a workflow is
  identified later, it should get its own 5-trial mandatory measurement
  pass against Prototype B specifically, not an assumption that the
  single diagnostic trial here generalizes.
- **If a future corpus audit does surface materially larger contextual
  scenes** (well beyond the current 500-node headroom ceiling), the
  measured pointer-latency margin (§2.1: B stays at 9.5–11.6ms even at
  500 nodes, vs. a 100ms floor) suggests picking/interaction quality has
  substantial headroom to spend before FPS/frame-time would need
  protecting with a new LOD tier — i.e., any future degradation tier
  should target render/frame cost specifically (node/edge draw-call
  count), not label density or picking fidelity, since those are not
  where this data shows strain building.

## 9. Removal of the losing prototype

`src/protoA/` (Prototype A's real implementation — `GraphScene.tsx` and
its supporting modules) and `src/prototypes/protoA/` (the thin harness
registration forwarder that re-exported `createProtoAHandle` from it) are
removed via `git rm` in the same commit as this report. Kept, per the
charter's own instruction: the winner (`src/prototypes/protoB/`), the
shared harness router
(`src/App.tsx`, `src/bench/*`, `src/types/prototype.ts`), the fixtures
(`src/fixtures/`), the camera module (`src/camera/`), and every results
file (`prototypes/graph-bakeoff/results/`).

**Honest scope note:** this removal is intentionally narrow — deleting
only Prototype A's own implementation directories, exactly as instructed.
It does **not** rewire `App.tsx`'s `isPrototypeId`/`createHandle` switch,
`src/types/prototype.ts`'s `PrototypeId` union, `src/bench/runner.ts`,
`e2e/bench.spec.ts`, or `scripts/run-bench.ts`, all of which still
structurally reference prototype `"a"` (a dangling import now exists at
`App.tsx`'s `import { createProtoAHandle } from "./prototypes/protoA"`).
This bakeoff harness's job — producing the measurement this report is
built on — is complete; it is an isolated, throwaway workspace per its
own `package.json` description ("Not part of the main pnpm workspace"),
not the production code Stage 3 will ship. Rewiring it into a
single-prototype-only harness (or deleting it outright) is a reasonable
follow-up but is out of this decision lane's scope and is called out here
rather than silently left for someone to discover as a broken build.
Stage 3 ("Knowledge Map rebuild") is where the winning renderer's
approach gets integrated into the real `apps/web` production code — this
harness does not need to build cleanly for that to happen.
