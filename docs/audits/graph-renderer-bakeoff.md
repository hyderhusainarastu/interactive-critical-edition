# Knowledge Map renderer bakeoff — decision report

Stage 2 of the UI/UX + Knowledge Map rebuild (`docs/handoffs/claude-code-ui-ux-graph-rebuild-prompt.md`
§13). This report applies that charter's decision rule mechanically to a
real, fully executed measurement run. It does not introduce new
measurements — every number below is read from
`prototypes/graph-bakeoff/results/summary.json`, the 57 individual trial
JSON files alongside it, and one additional real `vite build` pass per
prototype run specifically for this report's bundle-size section (method
documented in that section).

> **⚠️ Superseded headline conclusion.** The original decision below (§7:
> "Chosen: Prototype B") was reached from an unsound lifecycle
> measurement. A correction lane found the original 20x mount/unmount
> protocol's per-cycle snapshot was ambiguous (it read the *previous*
> cycle's mount, with no guarantee a frame had actually rendered before
> the read), which is what produced Prototype A's apparent "fail." A
> corrected, phase-consistent protocol was implemented and re-run for
> real; **both prototypes now measure a clean pass**, and the charter §13
> decision rule, re-applied mechanically to the corrected data, selects
> **Prototype A**, not B. Prototype A's implementation has been restored;
> Prototype B's has been removed per rule 9. See the **"Correction
> addendum"** section at the end of this document for the full diagnosis,
> corrected measurements, contamination screen, and final decision. Every
> section below this point is left exactly as originally written, for the
> historical record — do not read §7's "Chosen: Prototype B" as current.

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

---

## Correction addendum (2026-07-27/28)

A separate correction lane reviewed the decision above at the moderator's
request, on the grounds that the lifecycle "failure" driving the entire
outcome looked like a measurement-phase artifact rather than a real
defect. This addendum documents that review end to end: the original
verdict, the diagnosis, the corrected protocol, the corrected
measurements, a screen for the owner's documented physical interaction
with the browser during the run, and the final, mechanically re-applied
decision. Nothing above this line was edited or deleted.

### C.1 The original verdict, restated

§7 above selected Prototype B solely because Prototype A measured
`pass: false` on the mandatory 20x mount/unmount lifecycle gate: baseline
`geometries: 24, programs: 4` vs. cycle-20 `geometries: 0, programs: 0`,
outside the charter's 5% return-to-baseline tolerance. Every other
mandatory gate (12/24/60/120/500 fixture floors, no stress-fixture
crash/blank) passed for both prototypes; the lifecycle gate was the sole
deciding fact, exactly as §7 says.

### C.2 Diagnosis: the raw data proves a measurement-phase artifact, not a leak

The full 20-cycle raw record (`results/a--lifecycle--fixture-24.json`):

```
cycle  geometries  programs  activeObservers  activeTimers  registeredListeners
base        24         4           1               1                2
 1           0         0           1               1                2
 2           0         0           1               1                2
 3           0         0           1               1                2
 4          24         4           1               1                2
 5           0         0           1               1                2
 6           0         0           1               1                2
 7          24         4           1               1                2
 8           0         0           1               1                2
 9          24         4           1               1                2
10           0         0           1               1                2
11          24         4           1               1                2
12           0         0           1               1                2
13          24         4           1               1                2
14           0         0           1               1                2
15          24         4           1               1                2
16           0         0           1               1                2
17          24         4           1               1                2
18           0         0           1               1                2
19           0         0           1               1                2
20           0         0           1               1                2
```

The decisive fact is in the four right-hand columns, not the two the
original report focused on: **`activeObservers`/`activeTimers`/
`registeredListeners` are bit-for-bit constant (`1`/`1`/`2`) across every
one of the 20 cycles, including every cycle where `geometries`/`programs`
read `0`.** These three counts come from `ResourceTracker`
(`src/protoA/lifecycle.ts`), and a *real* unmount disposes that same
tracker in the identical cleanup effect that nulls the renderer ref
(`GraphScene.tsx`'s mount-effect cleanup calls `tracker.disposeAll()` and
`trackerRef.current = null` back to back with `fgRef.current = undefined`
— see `GraphScene.tsx` lines ~443-476). If the component had actually
been unmounted at any of the `0`-reading cycles, the tracker-backed
counts would have read `0` too, at exactly those same cycles. They never
did, on any of the 20 cycles. **This is direct, in-the-data proof that
the "0" readings were never a real unmount** — the component was still
mounted, with its listeners/observers/timers all live, at every single
one of those reads.

**Root cause, read from the code (`src/App.tsx`'s old `remountCycle` +
`scripts/run-bench.ts`'s old `runLifecycleCycle`):**

1. **Wrong mount, wrong instant.** Each cycle's snapshot was taken via
   `readLifecycleSnapshot()` on whatever handle `handleRef.current`
   pointed to *before* that cycle's own `unmount()` call — i.e. it read
   the **previous** cycle's mount, at whatever exact JS-execution instant
   `remountCycle(cycle)` happened to run, with no explicit wait for that
   mount to have settled beyond the "interactive" callback having fired.
2. **No guarantee a frame had rendered.** Prototype A's
   `readLifecycleSnapshot(cycle)` reads `fgRef.current?.renderer().info`
   live, at call time. `renderer.info.memory.geometries`/`.programs` are
   only populated once `three-forcegraph`'s own internal
   `requestAnimationFrame`-driven loop has actually called
   `renderer.render()` at least once — a fact that is asynchronous
   relative to the synchronous `useEffect` that fires "interactive"/
   "onReady". Nothing in the old protocol inserted an explicit settle
   wait (real rendered frames, or even a fixed delay) between "interactive
   reported" and "snapshot read." Under the old protocol's fast,
   unthrottled cadence (no explicit per-cycle delay at all), whether a
   given read landed before or after that mount's first actual draw call
   was a race — explaining the alternation exactly, and explaining why it
   was **non-monotonic** (never trending upward, correctly noted as odd
   for a "leak" by the original report's own honest caveat in §3) rather
   than accumulating.

Both of these are structural bugs in the shared driver code
(`App.tsx`/`run-bench.ts`), not in either prototype's own renderer — which
is exactly why fixing the protocol, not either prototype's disposal code,
resolved it (§C.4).

### C.3 Corrected protocol

Implemented in `prototypes/graph-bakeoff/src/App.tsx` (new
`window.__graphBakeoffLifecycleV2.runCorrectedCycle()`),
`src/protoA/lifecycle.ts` (new `readLifecycleAccessor()`),
`src/prototypes/protoB/GraphSceneB.tsx`/`index.tsx` (new
`captureLifecycleAccessor()`), and `src/bench/runner.ts`/`types.ts` (new
`runLifecycleBenchmarkV2`/`evaluateLifecycleV2`/`LifecycleCycleResultV2`).
Full inline documentation lives at each of those sites; summarized here:

Each of the 20 measured cycles (plus 2 discarded warm-up cycles) is now
**fully self-contained** — it never reads a different cycle's mount — and
takes **two** live, non-cached snapshots per cycle:

1. Mount a fresh handle, wait for "interactive".
2. **Settle**: wait 5 real `requestAnimationFrame` callbacks (guarantees
   actual `renderer.render()` calls have happened, not just that the
   scene *reported* ready) plus a fixed 50ms buffer.
3. Capture `mountedSettled` via a **live accessor bound to this mount's
   concrete renderer/tracker objects** (`captureLifecycleAccessor()`) —
   deliberately not going through `fgRef.current`/`trackerRef.current`
   (the refs), since re-invoking the accessor later still reads real
   values off the same retained JS objects even after those *other* refs
   get nulled by unrelated cleanup code.
4. Unmount.
5. **Settle**: wait 150ms for any deferred/async teardown to finish.
6. Re-invoke the **same** accessor (not a fresh one) to capture
   `postUnmount` — a genuine "did this mount's resources actually return
   to rest" reading.

The gate (`evaluateLifecycleV2`) requires **both** series (mounted-settled
and post-unmount) to independently plateau within the charter's existing
5% tolerance and show no monotonic growth across the final 5 cycles — a
leak visible only post-unmount (mounted numbers fine, disposal
incomplete) is just as real a finding as one visible only mounted-settled
(e.g. growing per-mount cost), so neither series alone is sufficient.

### C.4 Corrected measurements — real, executed, all 20 cycles

Re-run three times for reproducibility (final authoritative files:
`results/a--lifecycle--fixture-24--v2.json`,
`results/b--lifecycle--fixture-24--v2.json`; same production build (`vite
build` + `vite preview`), same headed Chromium, same machine/environment
as the original run — `Mac15,12`, macOS 26.6, Chromium 151.0.7922.34,
1440×900, DPR 1). `fixtureContentHash` on both v2 files
(`39dd86c9cd845374f9b8ca724e3efb5391e1e528f51de25887d1a11e23bb738f`)
matches the original v1 lifecycle files exactly, confirming byte-identical
fixture data.

**Prototype A — both series identical, every single cycle, zero drift:**

| Series | Cycle 0 (baseline) | Cycles 1–20 | Plateau? | Monotonic growth? |
|---|---|---|---|---|
| mountedSettled | `geometries:24, textures:0, programs:4, observers:1, timers:1, listeners:2` | identical, all 20 cycles | **true** | **false** |
| postUnmount | `geometries:0, textures:0, programs:0, observers:0, timers:0, listeners:0` | identical, all 20 cycles | **true** | **false** |

**Result: `pass: true` on both series.** A never leaked anything — the
mounted numbers are rock-steady at their real value every cycle, and the
post-unmount numbers are rock-steady at genuine zero every cycle. The
original protocol's ambiguous single-snapshot read was the entire reason
it ever looked otherwise.

**Prototype B — both series identical, every single cycle, zero drift:**

| Series | Cycle 0 (baseline) | Cycles 1–20 | Plateau? | Monotonic growth? |
|---|---|---|---|---|
| mountedSettled | `geometries:8, textures:1, programs:3, observers:0, timers:0, listeners:2` | identical, all 20 cycles | **true** | **false** |
| postUnmount | `geometries:0, textures:1, programs:0, observers:0, timers:0, listeners:0` | identical, all 20 cycles | **true** | **false** |

**Result: `pass: true` on both series.** Note `textures:1` persists in
B's post-unmount reading at both baseline and every later cycle — a
stable, non-growing plateau (exactly the charter's own permitted
"documented cache plateau" language, §13 step 9), not a leak: it never
grows, so `isWithinPlateau`'s ratio check (`|value - baseline| / baseline
<= 5%`) is trivially satisfied at 0% drift.

**A real, live mechanism difference, captured directly from the browser
console during this run (not inferred):** every one of Prototype B's 20+
unmount cycles logged a genuine
`THREE.WebGLRenderer: Context Lost.` message from three.js itself — React
Three Fiber's `<Canvas>` forces a real WebGL context loss on unmount to
release GPU memory promptly. Prototype A's unmount produced **no** such
console message on any cycle across any of the three re-runs —
`react-force-graph-3d`/`three-forcegraph` release resources via plain
`renderer.dispose()`, without forcing context loss. Both are legitimate,
complete disposal strategies; this is a real, observed difference in
*how* the two libraries release GPU resources, not a defect in either,
and it is the most likely proximate explanation for why the old,
un-throttled, rapid-cycling v1 protocol's snapshot timing happened to
expose A's read/render race and not B's — B's disposal event is a
synchronous, unambiguous signal; A's is not. This is recorded as a
finding for whoever inherits the winning prototype in Stage 3, not as a
decision input.

### C.5 Contamination screen

The owner physically clicked the headed browser at least once, at an
unknown time, during the original measurement window (2026-07-27/28
23:45:19–02:03:21 UTC). Screened all 50 mandatory trial JSONs (a/b ×
fixtures 12/24/60/120/500 × 5 trials each): for each of the 10 fixture ×
prototype groups, compared the 5 trials' median FPS, p95 frame time, and
p95 pointer latency against that group's own median, flagging any trial
deviating by more than 25% relative **or** more than 3× the group's
interquartile range on any of the three metrics.

**6 (metric, trial) combinations flagged, across 6 unique trials — all
via the 3×-IQR leg only; the 25%-relative leg never triggered** (largest
relative deviation observed: 9.63%, well under the 25% threshold):

| Trial | Metric | Value | Group median | Relative dev | IQR multiple |
|---|---|---|---|---|---|
| a/fixture-12/trial4 | p95 pointer latency | 43.1ms | 43.8ms | 1.6% | 3.5× |
| a/fixture-60/trial1 | p95 pointer latency | 33.0ms | 30.1ms | 9.63% | 4.1× |
| a/fixture-60/trial2 | p95 frame time | 18.1ms | 18.3ms | 1.09% | (IQR ≈ 0) |
| a/fixture-120/trial5 | p95 frame time | 17.5ms | 18.2ms | 3.85% | 7.0× |
| b/fixture-12/trial5 | p95 frame time | 18.4ms | 17.5ms | 5.14% | 9.0× |
| b/fixture-500/trial5 | p95 frame time | 17.5ms | 18.3ms | 4.37% | 8.0× |

This is a known statistical artifact of applying a Tukey-style IQR fence
to near-quantized, sub-millisecond timing data: when 4–5 of a group's 5
trials sit within 0.1–0.2ms of each other, the group's own IQR shrinks
toward zero, so even a trivial sub-millisecond difference on the
remaining trial computes as "many multiples of IQR." Every flagged raw
value already sat inside the min/max range this report's own §2.1 tables
already published — nothing here is a value the original report hid or
missed; the mechanical rule simply flagged ordinary jitter.

**All 6 flagged trials were re-run cleanly** (`scripts/rerun-flagged-trials.ts`
— fresh isolated browser, fresh navigation, one full warm-up cycle, one
measured trial, same production build/protocol; result files suffixed
`--rerun.json`, originals untouched):

| Trial | Metric | Original | Rerun |
|---|---|---|---|
| a/fixture-12/trial4 | fps / p95 frame / p95 pointer | 59.88 / 17.50ms / 43.10ms | 59.88 / 18.30ms / 42.10ms |
| a/fixture-60/trial1 | fps / p95 frame / p95 pointer | 59.88 / 18.30ms / 33.00ms | 59.88 / 18.20ms / 29.90ms |
| a/fixture-60/trial2 | fps / p95 frame / p95 pointer | 59.88 / 18.10ms / 30.10ms | 59.88 / 18.70ms / 30.20ms |
| a/fixture-120/trial5 | fps / p95 frame / p95 pointer | 59.88 / 17.50ms / 29.40ms | 59.88 / 17.90ms / 28.70ms |
| b/fixture-12/trial5 | fps / p95 frame / p95 pointer | 59.88 / 18.40ms / 11.40ms | 59.88 / 18.20ms / 11.10ms |
| b/fixture-500/trial5 | fps / p95 frame / p95 pointer | 59.88 / 17.50ms / 11.40ms | 59.88 / 18.20ms / 9.80ms |

**Every re-run lands in the same tight noise band as its original — no
group median materially shifts, and every single value (original and
rerun alike) remains 3–5× inside its respective floor at minimum** (worst
case across all 12 numbers: p95 pointer latency 43.1ms, still 2.3× inside
the 100ms floor; p95 frame time 18.7ms, still 1.8× inside the 33ms
floor). **No floor verdict changes for any fixture × prototype
combination.** Verdict: the owner's documented click did not measurably
contaminate the mandatory-floor dataset; §2.1's original numbers stand as
measured, and the lifecycle gate (§C.4, entirely separate data) is
unaffected by this screen either way.

### C.6 Charter §13 decision rule, re-applied mechanically to the corrected data

1. Correctness and lifecycle reliability are mandatory. (rule 1)
2. Both prototypes clear every numeric floor on the 12/24/60/120
   production-context fixtures and the 500/2,000 headroom fixture, on
   every trial (including all 6 contamination-screen re-runs), with wide
   margins. (rule 2 — satisfied by both, unchanged from the original
   report, confirmed unaffected by §C.5)
3. Neither prototype crashed or went blank on the diagnostic stress
   fixture. (rule 3 — satisfied by both, unchanged)
4. **Rule 4 now applies directly: "If Prototype A meets every mandatory
   gate, select it."** Under the corrected lifecycle measurement (§C.4),
   Prototype A passes both series (mounted-settled and post-unmount),
   with `pass: true` and zero drift on every tracked resource across all
   20 cycles. Combined with (2) and (3), **Prototype A now meets every
   mandatory gate** — the sole disqualifying fact from the original
   decision (§7's rule-4 rejection) no longer holds under the corrected
   measurement. Rule 4's own text is explicit that this selects A
   **"regardless of B's better secondary numbers"** — B's pointer-latency
   and bundle-size advantages (§2.1, §5 above) are real and are recorded
   below as secondary findings, but per the rule's own wording they are
   not decision drivers once A clears every mandatory gate.
5. Rule 5 (select B only if A fails a mandatory gate and B materially
   resolves it) does not apply — its precondition (A failing a mandatory
   gate) is no longer true.

### Chosen: Prototype A (clean `react-force-graph-3d@1.29.1`)

**Exact reasons:**

- It clears the mandatory 20× mount/unmount lifecycle gate cleanly under
  the corrected, phase-consistent protocol (§C.4) — both the
  mounted-settled and post-unmount series plateau exactly at baseline,
  every cycle, with zero drift and no monotonic growth. The original
  measured "failure" is conclusively explained (§C.2) as an artifact of
  an ambiguous, unthrottled single-snapshot protocol, not a real resource
  leak.
- It independently clears every other mandatory floor with wide margin,
  unchanged from the original report and reconfirmed unaffected by the
  contamination screen (§C.5): median FPS 59.88 on every mandatory
  fixture (floor ≥50), p95 frame time 17.1–18.4ms (floor ≤33ms), p95
  pointer latency 28.4–44.0ms (floor ≤100ms), payload→interactive
  0.0–2.0ms (floor ≤2000ms), warm/cold navigation 89.4–115.9ms (floors
  3500ms/5000ms — the fastest of the two prototypes on this metric), no
  crash/blank at the diagnostic stress tier.
- Per rule 4's own explicit wording, this selection holds regardless of
  Prototype B's better secondary numbers, recorded honestly below rather
  than omitted.

**Secondary findings (recorded, not decision-driving, per rule 4):**

- Prototype B's p95 pointer→highlight latency remains a real, repeated
  3–4× lower than Prototype A's across every mandatory fixture (§2.1) —
  both comfortably clear the 100ms floor by a wide margin either way.
- Prototype B's isolated production bundle remains ~28% smaller gzipped
  (319.96 kB vs. 442.34 kB, §5).
- Prototype A remains faster on cold/warm client navigation (§2.1/§7
  above: 89.4–115.9ms vs. B's 239.1–257.2ms) — a genuine Prototype A
  advantage the original report already recorded but which was never the
  deciding factor either way.

Whoever integrates the winning renderer in Stage 3 should weigh B's
pointer-latency and bundle-size advantages as real, worth investigating
as future optimization targets for Prototype A's implementation (e.g. its
own picking throttle, §3 above) — but they do not change today's
mandatory-gate decision.

### C.7 Rule 9 enforcement (final)

Per charter §13 rule 9 ("keep one production 3D renderer, not two") and
the decision above, **Prototype B's implementation
(`src/prototypes/protoB/`) is removed** from this branch in the same
commit as this addendum. Prototype A's implementation
(`src/protoA/` + `src/prototypes/protoA/`) — restored by this correction
lane at the start of this review, after the original decision lane had
removed it — is kept as the winner. Unlike the original decision lane's
removal of A (§9 above, which left `App.tsx`, `src/types/prototype.ts`,
`src/bench/runner.ts`, `e2e/bench.spec.ts`, and `scripts/run-bench.ts` all
still structurally referencing the removed prototype, with typecheck
correspondingly left broken for anything trying to construct it), this
removal keeps `pnpm typecheck` clean: `App.tsx`'s `createHandle()` no
longer imports `createProtoBHandle` at the module level, and constructing
prototype `"b"` now throws a clear, documented error pointing at this
addendum instead of silently importing a module that no longer exists.
The shared `PrototypeId = "a" | "b"` type, `src/bench/runner.ts`,
`e2e/bench.spec.ts`, and `scripts/run-bench.ts`/`run-lifecycle-v2.ts` are
left otherwise unchanged (still structurally aware of both ids, e.g. for
iterating fixtures) — this bakeoff harness's job is done, per the same
"isolated, throwaway workspace, not production code" reasoning §9 above
already gives; Stage 3 integrates Prototype A into the real `apps/web`
production code, not this harness.

**Prototype B remains fully recoverable from git history** — it was
implemented in commit `1f26096` (`feat(bakeoff): Prototype A and
Prototype B implementations + smoke screenshots`) and is unmodified on
this branch up to the commit immediately preceding its removal.
