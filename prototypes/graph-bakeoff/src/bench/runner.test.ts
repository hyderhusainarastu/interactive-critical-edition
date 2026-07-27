import { describe, expect, it } from "vitest";
import {
  deriveOrbitMetrics,
  derivePointerLatencyMetrics,
  detectMonotonicGrowth,
  evaluateFloors,
  isWithinPlateau,
  percentileOf,
} from "./runner";
import type { LifecycleSnapshot, TrialResult } from "./types";

describe("percentileOf", () => {
  it("returns 0 for an empty array", () => {
    expect(percentileOf([], 95)).toBe(0);
  });
  it("computes p95 via nearest-rank on a known set", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentileOf(values, 95)).toBe(95);
  });
});

describe("deriveOrbitMetrics", () => {
  it("derives median FPS from frame intervals (16.6ms -> ~60fps)", () => {
    const intervals = Array(120).fill(16.666);
    const metrics = deriveOrbitMetrics(intervals);
    expect(metrics.medianFps).toBeCloseTo(60, 0);
    expect(metrics.sampleCount).toBe(120);
  });
  it("handles an empty sample set without dividing by zero", () => {
    const metrics = deriveOrbitMetrics([]);
    expect(metrics.medianFps).toBe(0);
    expect(metrics.p95FrameTimeMs).toBe(0);
  });
});

describe("derivePointerLatencyMetrics", () => {
  it("computes p95 latency across samples", () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({
      targetNodeId: `n${i}`,
      dispatchedAtMs: 0,
      highlightConfirmedAtMs: i,
      latencyMs: i,
    }));
    const metrics = derivePointerLatencyMetrics(samples);
    expect(metrics.sampleCount).toBe(50);
    expect(metrics.p95LatencyMs).toBeGreaterThan(40);
  });
});

function makeTrial(overrides: Partial<TrialResult["orbit"] & TrialResult["pointerLatency"]> & { payloadToInteractiveMs?: number }): TrialResult {
  return {
    protocolVersion: "1.0.0",
    prototypeId: "a",
    fixtureName: "fixture-12",
    trialIndex: 1,
    environment: {
      machineModel: "test",
      os: "test",
      browser: "test",
      browserVersion: "0",
      powerMode: "unknown",
      viewportWidth: 1440,
      viewportHeight: 900,
      devicePixelRatio: 1,
      fixtureName: "fixture-12",
      fixtureContentHash: "deadbeef",
      rendererBuild: "test",
      cacheState: "warm",
    },
    payloadReceivedAtMs: 0,
    interactiveAtMs: overrides.payloadToInteractiveMs ?? 500,
    payloadToInteractiveMs: overrides.payloadToInteractiveMs ?? 500,
    orbit: {
      medianFps: overrides.medianFps ?? 60,
      p95FrameTimeMs: overrides.p95FrameTimeMs ?? 16,
      sampleCount: 100,
      frameIntervalsMs: [],
    },
    pointerLatency: {
      p95LatencyMs: overrides.p95LatencyMs ?? 40,
      sampleCount: 50,
      samples: [],
    },
    recordedAtIso: new Date().toISOString(),
  };
}

describe("evaluateFloors", () => {
  it("passes a trial that clears every floor on a mandatory fixture", () => {
    const trial = makeTrial({});
    const result = evaluateFloors(trial, true);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails a mandatory fixture that misses the median-FPS floor", () => {
    const trial = makeTrial({ medianFps: 30 });
    const result = evaluateFloors(trial, true);
    expect(result.pass).toBe(false);
    expect(result.violations.join(" ")).toMatch(/median FPS/);
  });

  it("treats floor misses on the diagnostic-only stress fixture as non-blocking", () => {
    const trial = makeTrial({ medianFps: 10, p95FrameTimeMs: 200 });
    const result = evaluateFloors(trial, false);
    expect(result.pass).toBe(true);
    expect(result.diagnosticOnly).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0); // still recorded, just non-blocking
  });
});

function snapshot(cycle: number, overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
  return {
    cycle,
    geometries: 10,
    textures: 5,
    programs: 3,
    activeWorkers: 0,
    activeObservers: 1,
    activeTimers: 0,
    registeredListeners: 4,
    ...overrides,
  };
}

describe("isWithinPlateau / detectMonotonicGrowth", () => {
  it("accepts identical baseline and latest snapshots", () => {
    expect(isWithinPlateau(snapshot(0), snapshot(20), 0.05)).toBe(true);
  });
  it("rejects a snapshot that drifted more than the tolerance", () => {
    expect(isWithinPlateau(snapshot(0), snapshot(20, { geometries: 40 }), 0.05)).toBe(false);
  });
  it("detects monotonic growth across the final window", () => {
    const cycles = Array.from({ length: 5 }, (_, i) => snapshot(i, { geometries: 10 + i }));
    expect(detectMonotonicGrowth(cycles, 5)).toBe(true);
  });
  it("does not flag a stable (non-growing) final window", () => {
    const cycles = Array.from({ length: 5 }, (_, i) => snapshot(i, { geometries: 10 }));
    expect(detectMonotonicGrowth(cycles, 5)).toBe(false);
  });
});
