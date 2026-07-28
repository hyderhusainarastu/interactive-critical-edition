/**
 * Bench-result schema for the renderer bakeoff (charter §13's exact 10-step
 * protocol). One `TrialResult` is written as one JSON file per prototype,
 * per fixture, per trial, under
 * prototypes/graph-bakeoff/results/<prototype>--<fixture>--trial<N>.json
 * — never aggregated-only, so every trial is reported, not just the best
 * (bakeoff program rule).
 */

import type { PrototypeId } from "../types/prototype";

export type CacheState = "cold" | "warm";

export interface BenchEnvironment {
  machineModel: string;
  os: string;
  browser: string;
  browserVersion: string;
  /** Best-effort; "unknown" when the environment can't report it (no
   * standard cross-browser power-mode API exists). */
  powerMode: string;
  viewportWidth: number;
  viewportHeight: number;
  /** Actually-applied DPR, capped at 1.5 per charter §13. */
  devicePixelRatio: number;
  fixtureName: string;
  fixtureContentHash: string;
  /** e.g. "prototype-a@<package version or commit>". */
  rendererBuild: string;
  cacheState: CacheState;
}

export interface OrbitMetrics {
  /** Median FPS derived from sampled requestAnimationFrame intervals during
   * the 12s scripted orbit, after the 3s stabilization period. */
  medianFps: number;
  p95FrameTimeMs: number;
  sampleCount: number;
  /** Raw sampled frame intervals, in ms, for later re-derivation/auditing —
   * charter step 10, "report all trials", extends naturally to reporting
   * the raw samples a trial's summary numbers were computed from. */
  frameIntervalsMs: number[];
}

export interface PointerLatencySample {
  targetNodeId: string;
  dispatchedAtMs: number;
  highlightConfirmedAtMs: number;
  latencyMs: number;
}

export interface PointerLatencyMetrics {
  p95LatencyMs: number;
  sampleCount: number;
  samples: PointerLatencySample[];
}

export interface NavigationTiming {
  kind: CacheState;
  navigationIntentMs: number;
  apiRequestStartMs: number;
  apiRequestEndMs: number;
  payloadReceivedMs: number;
  rendererInitMs: number;
  firstValidFrameMs: number;
  interactiveMs: number;
}

export interface LifecycleSnapshot {
  cycle: number;
  geometries: number;
  textures: number;
  programs: number;
  activeWorkers: number;
  activeObservers: number;
  activeTimers: number;
  registeredListeners: number;
}

export interface LifecycleCycleResult {
  warmupCycles: number;
  measuredCycles: number;
  baseline: LifecycleSnapshot;
  cycles: LifecycleSnapshot[];
  /** True when the final measured cycle's counts are within 5% of the
   * stabilized baseline (a documented cache plateau is acceptable; growth
   * is not). */
  withinPlateauTolerance: boolean;
  /** True when any tracked count strictly increases across every one of
   * the final 5 cycles (the thing the charter says must never happen). */
  monotonicGrowthDetected: boolean;
}

/**
 * Corrected two-snapshot lifecycle protocol (Stage 2 CORRECTION lane,
 * 2026-07-27/28). The original single-snapshot protocol read whichever
 * mount happened to be "current" at an ambiguous instant relative to
 * mount/unmount — see `docs/audits/graph-renderer-bakeoff.md`'s Correction
 * addendum for the full diagnosis. This version takes two unambiguous,
 * phase-consistent, live (non-cached) readings per cycle:
 *   - `mountedSettled`: after mount, after the scene's own "interactive"
 *     signal, after an explicit settle (real rendered frames + a fixed
 *     delay) — a genuine "fully up and rendering" reading.
 *   - `postUnmount`: after `unmount()`, after a fixed settle delay — a
 *     genuine "actually torn down" reading, read off the SAME renderer/
 *     tracker object references captured before teardown (not through a
 *     ref that gets nulled by unrelated cleanup code, which would read
 *     zero regardless of whether real disposal happened).
 * Each series gets its own baseline/plateau/monotonic-growth check; the
 * gate requires both to pass (see `evaluateLifecycleV2` in `../bench/
 * runner.ts`).
 */
export interface LifecycleSeriesResult {
  baseline: LifecycleSnapshot;
  cycles: LifecycleSnapshot[];
  withinPlateauTolerance: boolean;
  monotonicGrowthDetected: boolean;
}

export interface LifecycleCycleResultV2 {
  warmupCycles: number;
  measuredCycles: number;
  mountedSettled: LifecycleSeriesResult;
  postUnmount: LifecycleSeriesResult;
}

export interface LifecycleSnapshotPair {
  cycle: number;
  mountedSettled: LifecycleSnapshot;
  postUnmount: LifecycleSnapshot;
}

export interface TrialResult {
  protocolVersion: "1.0.0";
  prototypeId: PrototypeId;
  fixtureName: string;
  /** 1..5 for the mandatory measured trials. */
  trialIndex: number;
  environment: BenchEnvironment;
  /** ms since navigation start. */
  payloadReceivedAtMs: number;
  /** ms since navigation start. */
  interactiveAtMs: number;
  payloadToInteractiveMs: number;
  orbit: OrbitMetrics;
  pointerLatency: PointerLatencyMetrics;
  recordedAtIso: string;
}

export interface NavigationTrialResult {
  protocolVersion: "1.0.0";
  prototypeId: PrototypeId;
  fixtureName: string;
  environment: BenchEnvironment;
  navigations: NavigationTiming[];
  recordedAtIso: string;
}

export interface LifecycleTrialResult {
  protocolVersion: "1.0.0";
  prototypeId: PrototypeId;
  fixtureName: string;
  environment: BenchEnvironment;
  lifecycle: LifecycleCycleResult;
  recordedAtIso: string;
}

export interface LifecycleTrialResultV2 {
  protocolVersion: "2.0.0";
  prototypeId: PrototypeId;
  fixtureName: string;
  environment: BenchEnvironment;
  lifecycle: LifecycleCycleResultV2;
  recordedAtIso: string;
}

/** Charter §13 protocol constants — named, not scattered as magic numbers. */
export const BENCH_PROTOCOL = {
  DPR_CAP: 1.5,
  MEASURED_TRIALS_PER_FIXTURE: 5,
  ORBIT_DURATION_MS: 12_000,
  ORBIT_STABILIZATION_MS: 3_000,
  MIN_POINTER_SAMPLES: 50,
  COLD_NAVIGATIONS: 3,
  WARM_NAVIGATIONS: 5,
  LIFECYCLE_WARMUP_CYCLES: 2,
  LIFECYCLE_MEASURED_CYCLES: 20,
  LIFECYCLE_PLATEAU_TOLERANCE: 0.05,
  LIFECYCLE_FINAL_WINDOW: 5,
  /** Corrected v2 protocol only (Stage 2 correction lane). Number of real
   * `requestAnimationFrame` callbacks to wait through, after the scene
   * reports "interactive", before taking the mounted-settled snapshot —
   * guarantees at least this many actual render passes have happened, so
   * `renderer.info`'s counts reflect genuinely-rendered geometry/programs
   * rather than racing the first draw call. */
  LIFECYCLE_MOUNT_SETTLE_FRAMES: 5,
  /** Fixed buffer (ms) after the settle frames, before the mounted-settled
   * read — absorbs any residual scheduling jitter beyond raw frame count. */
  LIFECYCLE_MOUNT_SETTLE_MS: 50,
  /** Fixed delay (ms) after `unmount()` returns, before the post-unmount
   * read — gives synchronous-looking dispose calls' any deferred/async
   * cleanup (e.g. WebGL context teardown) room to actually complete before
   * being read as "did resources return to rest". */
  LIFECYCLE_UNMOUNT_SETTLE_MS: 150,
} as const;

/** Mandatory numeric floors from the charter's decision rule (§13). Applied
 * to the 12/24/60/120 production-context fixtures and the 500/2000
 * headroom fixture; the 1000/4000 stress fixture is diagnostic-only per
 * the charter's own wording ("its FPS/latency floors are diagnostic unless
 * real product evidence makes that scale mandatory"). */
export const BENCH_FLOORS = {
  MIN_MEDIAN_FPS: 50,
  MAX_P95_FRAME_TIME_MS: 33,
  MAX_P95_POINTER_LATENCY_MS: 100,
  MAX_PAYLOAD_TO_INTERACTIVE_MS: 2_000,
  MAX_WARM_NAV_TO_INTERACTIVE_MS: 3_500,
  MAX_COLD_NAV_TO_INTERACTIVE_MS: 5_000,
  MAX_API_REQUEST_P95_MS: 1_500,
} as const;

export const MANDATORY_FIXTURES = ["fixture-12", "fixture-24", "fixture-60", "fixture-120", "fixture-500"] as const;
export const DIAGNOSTIC_ONLY_FIXTURES = ["fixture-1000"] as const;
