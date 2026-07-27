/**
 * Bench-protocol orchestrator implementing the charter §13 10-step
 * benchmark exactly, driven through an abstract `BenchDriver` rather than a
 * direct Playwright import — this keeps the *protocol logic* unit-testable
 * (see runner.test.ts for the pure derivation helpers) and keeps this file
 * reusable unmodified once Prototype A/B are actually implemented and a
 * real `PlaywrightBenchDriver` (see e2e/bench.spec.ts) supplies live pages.
 *
 * This module deliberately does not fabricate or simulate a single
 * measurement — every timing value it produces comes from whatever the
 * supplied `BenchDriver` actually observed. Nothing here is runnable end to
 * end yet because Prototype A/B don't exist (by design — this harness-
 * building pass explicitly excludes building them); wiring a real driver
 * against real prototypes is the next lane's job.
 */

import type { PrototypeId } from "../types/prototype";
import {
  BENCH_FLOORS,
  BENCH_PROTOCOL,
  type BenchEnvironment,
  type CacheState,
  type LifecycleCycleResult,
  type LifecycleSnapshot,
  type NavigationTiming,
  type NavigationTrialResult,
  type OrbitMetrics,
  type PointerLatencyMetrics,
  type PointerLatencySample,
  type TrialResult,
} from "./types";

// ---------------------------------------------------------------------
// Pure derivation helpers (unit-tested directly in runner.test.ts)
// ---------------------------------------------------------------------

/** p-th percentile (0-100) of `values` using nearest-rank on sorted data.
 * Returns 0 for an empty array. */
export function percentileOf(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/** Derives median FPS and p95 frame time from raw sampled
 * requestAnimationFrame interval durations (ms between consecutive
 * frames) collected during the scripted orbit. */
export function deriveOrbitMetrics(frameIntervalsMs: readonly number[]): OrbitMetrics {
  if (frameIntervalsMs.length === 0) {
    return { medianFps: 0, p95FrameTimeMs: 0, sampleCount: 0, frameIntervalsMs: [] };
  }
  const sorted = [...frameIntervalsMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianIntervalMs = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const medianFps = medianIntervalMs > 0 ? 1000 / medianIntervalMs : 0;
  const p95FrameTimeMs = percentileOf(frameIntervalsMs, 95);
  return { medianFps, p95FrameTimeMs, sampleCount: frameIntervalsMs.length, frameIntervalsMs: [...frameIntervalsMs] };
}

export function derivePointerLatencyMetrics(samples: readonly PointerLatencySample[]): PointerLatencyMetrics {
  const latencies = samples.map((s) => s.latencyMs);
  return {
    p95LatencyMs: percentileOf(latencies, 95),
    sampleCount: samples.length,
    samples: [...samples],
  };
}

export interface FloorEvaluation {
  pass: boolean;
  violations: string[];
  diagnosticOnly: boolean;
}

/** Charter §13 decision-rule numeric floors. `isMandatoryFixture` should be
 * false only for the 1000/4000 stress tier, whose floors are explicitly
 * diagnostic rather than pass/fail (charter §13). */
export function evaluateFloors(trial: TrialResult, isMandatoryFixture: boolean): FloorEvaluation {
  const violations: string[] = [];

  if (trial.orbit.medianFps < BENCH_FLOORS.MIN_MEDIAN_FPS) {
    violations.push(`median FPS ${trial.orbit.medianFps.toFixed(1)} < floor ${BENCH_FLOORS.MIN_MEDIAN_FPS}`);
  }
  if (trial.orbit.p95FrameTimeMs > BENCH_FLOORS.MAX_P95_FRAME_TIME_MS) {
    violations.push(
      `p95 frame time ${trial.orbit.p95FrameTimeMs.toFixed(1)}ms > floor ${BENCH_FLOORS.MAX_P95_FRAME_TIME_MS}ms`,
    );
  }
  if (trial.pointerLatency.p95LatencyMs > BENCH_FLOORS.MAX_P95_POINTER_LATENCY_MS) {
    violations.push(
      `p95 pointer latency ${trial.pointerLatency.p95LatencyMs.toFixed(1)}ms > floor ${BENCH_FLOORS.MAX_P95_POINTER_LATENCY_MS}ms`,
    );
  }
  if (trial.payloadToInteractiveMs > BENCH_FLOORS.MAX_PAYLOAD_TO_INTERACTIVE_MS) {
    violations.push(
      `payload-to-interactive ${trial.payloadToInteractiveMs.toFixed(0)}ms > floor ${BENCH_FLOORS.MAX_PAYLOAD_TO_INTERACTIVE_MS}ms`,
    );
  }

  return {
    pass: isMandatoryFixture ? violations.length === 0 : true,
    violations,
    diagnosticOnly: !isMandatoryFixture,
  };
}

export function evaluateLifecycle(result: LifecycleCycleResult): { pass: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!result.withinPlateauTolerance) {
    violations.push("resource counts did not return to baseline within the 5% plateau tolerance");
  }
  if (result.monotonicGrowthDetected) {
    violations.push("resource counts grew monotonically across the final 5 mount/unmount cycles");
  }
  return { pass: violations.length === 0, violations };
}

/** Detects monotonic growth across the final `windowSize` cycles for every
 * tracked numeric field of `LifecycleSnapshot` (excluding `cycle` itself). */
export function detectMonotonicGrowth(cycles: readonly LifecycleSnapshot[], windowSize: number): boolean {
  if (cycles.length < windowSize) return false;
  const window = cycles.slice(-windowSize);
  const fields: Array<keyof LifecycleSnapshot> = [
    "geometries",
    "textures",
    "programs",
    "activeWorkers",
    "activeObservers",
    "activeTimers",
    "registeredListeners",
  ];
  return fields.some((field) => window.every((snap, i) => i === 0 || snap[field] > window[i - 1][field]));
}

export function isWithinPlateau(baseline: LifecycleSnapshot, latest: LifecycleSnapshot, tolerance: number): boolean {
  const fields: Array<keyof LifecycleSnapshot> = [
    "geometries",
    "textures",
    "programs",
    "activeWorkers",
    "activeObservers",
    "activeTimers",
    "registeredListeners",
  ];
  return fields.every((field) => {
    const base = baseline[field];
    const value = latest[field];
    if (base === 0) return value === 0;
    return Math.abs(value - base) / base <= tolerance;
  });
}

// ---------------------------------------------------------------------
// Driver abstraction — implemented for real by e2e/bench.spec.ts via
// Playwright once Prototype A/B exist. Kept here, not in e2e/, so both the
// orchestration logic and this contract stay framework-agnostic and
// testable without a browser.
// ---------------------------------------------------------------------

export interface BenchDriver {
  captureEnvironment(): Promise<
    Pick<BenchEnvironment, "machineModel" | "os" | "browser" | "browserVersion" | "powerMode" | "viewportWidth" | "viewportHeight" | "devicePixelRatio">
  >;
  /** Navigates to the harness entry page for (prototypeId, fixtureName) and
   * returns the navigation-intent timestamp (ms, monotonic clock). */
  navigate(prototypeId: PrototypeId, fixtureName: string, cacheState: CacheState): Promise<number>;
  /** Resolves with ms-since-navigation-intent once the harness bridge
   * reports a payload-received timestamp. */
  waitForPayloadReceived(): Promise<number>;
  /** Resolves with ms-since-navigation-intent once the harness bridge
   * reports the charter's "interactive" condition met. */
  waitForInteractive(): Promise<number>;
  /** One full mount + one scripted orbit + one select/focus/reset cycle
   * (charter step 4 warm-up), discarded from measurement. */
  runWarmupCycle(): Promise<void>;
  /** Samples requestAnimationFrame interval durations (ms) for
   * `durationMs`, after waiting `stabilizationMs` first. */
  sampleOrbitFrameIntervals(durationMs: number, stabilizationMs: number): Promise<number[]>;
  /** Dispatches >= `count` deterministic pointer moves over known visible
   * node screen positions and measures highlight-confirm latency for each. */
  samplePointerLatencies(count: number): Promise<PointerLatencySample[]>;
  /** Reads Performance-API marks for one navigation (cold or warm). */
  captureNavigationTiming(kind: CacheState): Promise<NavigationTiming>;
  /** Runs one mount/unmount cycle and returns the post-unmount lifecycle
   * snapshot. */
  runLifecycleCycle(cycleIndex: number): Promise<LifecycleSnapshot>;
  getFixtureContentHash(fixtureName: string): Promise<string>;
  getRendererBuildLabel(prototypeId: PrototypeId): Promise<string>;
}

// ---------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------

export interface MeasuredTrialOptions {
  prototypeId: PrototypeId;
  fixtureName: string;
  trialIndex: number;
  cacheState: CacheState;
}

/** Runs exactly one measured trial (charter steps 2, 3, 6, 7 combined for a
 * single fixture/prototype/trial-index) and returns its `TrialResult`. The
 * caller is responsible for having already run the warm-up cycle once per
 * fixture/prototype (charter step 4) and for writing the returned result to
 * its own JSON file (one file per prototype per fixture per trial). */
export async function runMeasuredTrial(driver: BenchDriver, opts: MeasuredTrialOptions): Promise<TrialResult> {
  const envBase = await driver.captureEnvironment();
  const fixtureContentHash = await driver.getFixtureContentHash(opts.fixtureName);
  const rendererBuild = await driver.getRendererBuildLabel(opts.prototypeId);

  await driver.navigate(opts.prototypeId, opts.fixtureName, opts.cacheState);
  const payloadReceivedAtMs = await driver.waitForPayloadReceived();
  const interactiveAtMs = await driver.waitForInteractive();

  const frameIntervalsMs = await driver.sampleOrbitFrameIntervals(
    BENCH_PROTOCOL.ORBIT_DURATION_MS,
    BENCH_PROTOCOL.ORBIT_STABILIZATION_MS,
  );
  const pointerSamples = await driver.samplePointerLatencies(BENCH_PROTOCOL.MIN_POINTER_SAMPLES);

  const environment: BenchEnvironment = {
    ...envBase,
    devicePixelRatio: Math.min(envBase.devicePixelRatio, BENCH_PROTOCOL.DPR_CAP),
    fixtureName: opts.fixtureName,
    fixtureContentHash,
    rendererBuild,
    cacheState: opts.cacheState,
  };

  return {
    protocolVersion: "1.0.0",
    prototypeId: opts.prototypeId,
    fixtureName: opts.fixtureName,
    trialIndex: opts.trialIndex,
    environment,
    payloadReceivedAtMs,
    interactiveAtMs,
    payloadToInteractiveMs: interactiveAtMs - payloadReceivedAtMs,
    orbit: deriveOrbitMetrics(frameIntervalsMs),
    pointerLatency: derivePointerLatencyMetrics(pointerSamples),
    recordedAtIso: new Date().toISOString(),
  };
}

export interface NavigationBenchmarkOptions {
  prototypeId: PrototypeId;
  fixtureName: string;
}

/** Charter step 8: 3 cold + 5 warm navigation timings. */
export async function runNavigationBenchmark(
  driver: BenchDriver,
  opts: NavigationBenchmarkOptions,
): Promise<NavigationTrialResult> {
  const envBase = await driver.captureEnvironment();
  const fixtureContentHash = await driver.getFixtureContentHash(opts.fixtureName);
  const rendererBuild = await driver.getRendererBuildLabel(opts.prototypeId);

  const navigations: NavigationTiming[] = [];
  for (let i = 0; i < BENCH_PROTOCOL.COLD_NAVIGATIONS; i++) {
    navigations.push(await driver.captureNavigationTiming("cold"));
  }
  for (let i = 0; i < BENCH_PROTOCOL.WARM_NAVIGATIONS; i++) {
    navigations.push(await driver.captureNavigationTiming("warm"));
  }

  const environment: BenchEnvironment = {
    ...envBase,
    devicePixelRatio: Math.min(envBase.devicePixelRatio, BENCH_PROTOCOL.DPR_CAP),
    fixtureName: opts.fixtureName,
    fixtureContentHash,
    rendererBuild,
    cacheState: "cold",
  };

  return {
    protocolVersion: "1.0.0",
    prototypeId: opts.prototypeId,
    fixtureName: opts.fixtureName,
    environment,
    navigations,
    recordedAtIso: new Date().toISOString(),
  };
}

/** Charter step 9: 2 warm-up cycles + 20 measured mount/unmount cycles,
 * checked for a stabilized-baseline plateau and no monotonic growth across
 * the final 5. */
export async function runLifecycleBenchmark(
  driver: BenchDriver,
  opts: { prototypeId: PrototypeId; fixtureName: string },
): Promise<LifecycleCycleResult> {
  for (let i = 0; i < BENCH_PROTOCOL.LIFECYCLE_WARMUP_CYCLES; i++) {
    await driver.runLifecycleCycle(-1 - i); // negative index marks warm-up, discarded from measurement
  }

  const baseline = await driver.runLifecycleCycle(0);
  const cycles: LifecycleSnapshot[] = [];
  for (let i = 1; i <= BENCH_PROTOCOL.LIFECYCLE_MEASURED_CYCLES; i++) {
    cycles.push(await driver.runLifecycleCycle(i));
  }

  const latest = cycles[cycles.length - 1];
  const withinPlateauTolerance = isWithinPlateau(baseline, latest, BENCH_PROTOCOL.LIFECYCLE_PLATEAU_TOLERANCE);
  const monotonicGrowthDetected = detectMonotonicGrowth(cycles, BENCH_PROTOCOL.LIFECYCLE_FINAL_WINDOW);

  return {
    warmupCycles: BENCH_PROTOCOL.LIFECYCLE_WARMUP_CYCLES,
    measuredCycles: BENCH_PROTOCOL.LIFECYCLE_MEASURED_CYCLES,
    baseline,
    cycles,
    withinPlateauTolerance,
    monotonicGrowthDetected,
  };
}
