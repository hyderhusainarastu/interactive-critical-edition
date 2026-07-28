# Bench results

One JSON file per prototype per fixture per trial, written by
`scripts/run-bench.ts` (the Stage 2 MEASUREMENT lane's real driver, headed
Chromium via Playwright) via `src/bench/runner.ts`, named
`<prototype>--<fixture>--trial<N>.json`. Navigation and lifecycle results
are `<prototype>--navigation--<fixture>.json` / `<prototype>--lifecycle--<fixture>.json`.
`summary.json` aggregates medians/p95s per prototype per fixture against
the charter §13 floors — see `docs/audits/` (charter) for the full
protocol text this run followed.

## Status: real, executed, full-protocol run (2026-07-27/28)

Ran the complete charter §13 10-step protocol against a production
(`vite build` + `vite preview`) build, headed Chromium
(`chromium.launch({ headless: false, args: ['--force-device-scale-factor=1'] })`,
confirmed via `headedBrowserUsed: true` in `summary.json` — headless was
never needed), 1440x900 viewport, DPR capped at 1 (both prototypes'
`devicePixelRatio` reported 1, at/under the 1.5 cap). Preflight machine-load
check ran and found the machine already quiet at start (`finalLoadAvg:
2.41`, `preflightWaited: false`) — an earlier DRY_RUN sanity pass on the
same session did wait out a transient load spike (`loadavg=6.81` from
concurrent unrelated apps) before proceeding, confirming the check works.

**Every trial is reported, not just the best** — 57 JSON files total: 5
mandatory fixtures (12/24/60/120/500) × 5 measured trials × 2 prototypes
(50 files), the 1000/4000 stress fixture × 2 prototypes (2 files),
navigation timing × 2 prototypes (2 files), lifecycle × 2 prototypes (2
files), plus `summary.json`.

### Floor matrix (mandatory fixtures, 12/24/60/120/500)

Both prototypes pass every mandatory floor on every mandatory fixture,
with wide margins:

| Metric | Floor | Prototype A (worst case) | Prototype B (worst case) |
|---|---|---|---|
| Median orbit FPS | ≥ 50 | 59.9 (all fixtures) | 59.9 (all fixtures) |
| p95 frame time | ≤ 33ms | 18.3ms (fixture-60/120) | 18.4ms (fixture-12/60) |
| p95 pointer→highlight latency | ≤ 100ms | 43.9ms (fixture-12) | 12.5ms (fixture-24) |
| Payload→interactive | ≤ 2000ms | 0.0ms | 2.0ms (fixture-500) |
| Warm nav → interactive | ≤ 3500ms | 89.4ms | 239.1ms |
| Cold nav → interactive | ≤ 5000ms | 115.9ms | 257.2ms |

Prototype B's p95 pointer latency (11–13ms) is consistently lower than
Prototype A's (30–44ms) across every fixture — both comfortably clear the
100ms floor, but this is a real, repeated, non-noise gap worth noting for
the eventual write-up, not just a pass/fail checkbox.

### Stress fixture (fixture-1000, 4000 links) — diagnostic-only

Crash/blank is the only mandatory criterion at this tier. **Neither
prototype crashed or went blank** on the reported run (`crashedOrBlank:
false` for both). One earlier full run this session *did* see Prototype
A's stress-fixture pass crash the entire Chromium browser process
("Target page, context or browser has been closed") with no macOS crash
report or low-memory/jetsam log entry found for it — most likely a
transient GPU-process crash-and-give-up under sustained heavy-scene load
rather than a reproducible prototype defect (a later run and a dedicated
retest both completed this exact fixture cleanly for both prototypes).
Recorded here for completeness rather than silently treated as "didn't
happen" — see the `redesign/graph-bakeoff` branch's commit history for
the full incident and the crash-recovery fix it prompted
(`ensureBrowserAlive()` in `scripts/run-bench.ts`, so a future recurrence
costs only that one fixture's result, not the whole run).

### Lifecycle (20x mount/unmount, fixture-24) — mandatory

- **Prototype B: pass.** Baseline and final-cycle (cycle 20) resource
  counts are identical (`geometries: 8, textures: 1, programs: 3,
  activeObservers: 0, activeTimers: 0, registeredListeners: 2` both times)
  — no growth, no plateau drift.
- **Prototype A: reported fail on the plateau-tolerance sub-check** —
  baseline read `geometries: 24, programs: 4`, final cycle (20) read
  `geometries: 0, programs: 0`, which exceeds the 5% tolerance. **Important
  caveat, not swept under the rug:** `monotonicGrowthDetected` is `false`
  for Prototype A too — the per-cycle raw values (in
  `a--lifecycle--fixture-24.json`) alternate between exactly `0` and
  exactly `24`/`4` across the 20 cycles, never trending upward. That
  pattern is consistent with a timing race in *when* `readLifecycleSnapshot()`
  samples `renderer.info` relative to that cycle's first actual WebGL
  draw call (i.e., a measurement-harness artifact), not with an
  accumulating resource leak, which would show monotonic growth instead.
  This is reported as-measured — not rerun in isolation to chase a
  passing number, which the bakeoff program's own "never fabricate a
  measurement, report every trial" rule rules out — but the distinction
  between "plateau check failed once on a non-monotonic reading" and "a
  real accumulating leak" matters for whoever makes the final prototype
  decision, so it's spelled out here rather than left as a bare
  `pass: false`.

### Environment

`Mac15,12`, macOS 26.6, Chromium 151.0.7922.34, 1440x900 viewport, DPR 1.
Total wall-clock run time: ~2h18m (23:45:19–02:03:21 UTC), dominated by
Prototype B's slower pointer-latency convergence at 500/1000-node scale
(each fixture-500 trial's 50-sample pointer-latency phase took B roughly
10 minutes vs. A's ~1.5 minutes — B's own picking retry/reset loop is
slower to settle at that node count, though it always converges within
the mandatory-sample budget and its resulting p95 latency is still lower
than A's once it does).
