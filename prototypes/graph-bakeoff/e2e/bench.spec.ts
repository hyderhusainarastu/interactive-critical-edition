/**
 * Playwright wiring for the charter §13 bench protocol, implementing
 * `BenchDriver` (src/bench/runner.ts) against a real Chromium page.
 *
 * STATUS: scaffolding, not yet executed for real measurements. Prototype A
 * and Prototype B are explicitly out of scope for this harness-building
 * pass (both `src/prototypes/protoX/index.tsx` are labeled placeholders
 * that render a static div, not a real force-graph scene) — running this
 * spec today would only measure a `<div>`, which would be a fabricated-
 * looking "renderer" number, not a real one. The bakeoff program rule is
 * explicit: never fabricate a measurement. This file is therefore wired
 * and ready, and deliberately `test.skip`-guarded, so the next lane that
 * builds the real prototypes can delete one `test.skip` line and get a
 * working bench run rather than writing this plumbing from scratch.
 *
 * Once Prototype A/B are real, remove the `test.skip` guard below and this
 * spec will, per fixture per prototype:
 *   1. run one warm-up cycle,
 *   2. run BENCH_PROTOCOL.MEASURED_TRIALS_PER_FIXTURE measured trials,
 *   3. write one JSON file per trial to ../results/,
 *   4. separately run the navigation-timing and lifecycle benchmarks.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  HARNESS_BRIDGE_KEY,
  type HarnessBridge,
} from "../src/bench/harnessBridge";
import { runMeasuredTrial, type BenchDriver } from "../src/bench/runner";
import { BENCH_PROTOCOL, type CacheState, type LifecycleSnapshot, type NavigationTiming, type PointerLatencySample, type TrialResult } from "../src/bench/types";
import { FIXTURE_NAMES } from "../src/fixtures/types";
import type { PrototypeId } from "../src/types/prototype";

const RESULTS_DIR = join(__dirname, "..", "results");

class PlaywrightBenchDriver implements BenchDriver {
  private navStartMs = 0;

  constructor(private readonly page: Page) {}

  async captureEnvironment() {
    const viewport = this.page.viewportSize() ?? { width: 1440, height: 900 };
    const browserVersion = this.page.context().browser()?.version() ?? "unknown";
    return {
      machineModel: process.platform === "darwin" ? "Mac (model unresolved in sandbox)" : process.platform,
      os: `${process.platform} ${process.arch}`,
      browser: "chromium",
      browserVersion,
      powerMode: "unknown", // no standard cross-browser power-mode API
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      devicePixelRatio: await this.page.evaluate(() => window.devicePixelRatio),
    };
  }

  async navigate(prototypeId: PrototypeId, fixtureName: string, _cacheState: CacheState): Promise<number> {
    this.navStartMs = Date.now();
    await this.page.goto(`/?proto=${prototypeId}&fixture=${fixtureName}`);
    return 0;
  }

  async waitForPayloadReceived(): Promise<number> {
    await this.page.waitForFunction(
      (key) => Boolean((window as unknown as Record<string, HarnessBridge | undefined>)[key]?.payloadReceivedAtMs !== null),
      HARNESS_BRIDGE_KEY,
      { timeout: 15_000 },
    );
    return this.page.evaluate(
      (key) => (window as unknown as Record<string, HarnessBridge>)[key].payloadReceivedAtMs as number,
      HARNESS_BRIDGE_KEY,
    );
  }

  async waitForInteractive(): Promise<number> {
    await this.page.waitForFunction(
      (key) => Boolean((window as unknown as Record<string, HarnessBridge | undefined>)[key]?.interactiveAtMs !== null),
      HARNESS_BRIDGE_KEY,
      { timeout: 15_000 },
    );
    return this.page.evaluate(
      (key) => (window as unknown as Record<string, HarnessBridge>)[key].interactiveAtMs as number,
      HARNESS_BRIDGE_KEY,
    );
  }

  async runWarmupCycle(): Promise<void> {
    // One mount (navigation already did this), one scripted orbit, one
    // select/focus/reset cycle — discarded, not written anywhere.
    await this.sampleOrbitFrameIntervals(2_000, 0);
  }

  async sampleOrbitFrameIntervals(durationMs: number, stabilizationMs: number): Promise<number[]> {
    if (stabilizationMs > 0) {
      await this.page.waitForTimeout(stabilizationMs);
    }
    return this.page.evaluate((duration) => {
      return new Promise<number[]>((resolve) => {
        const intervals: number[] = [];
        let last = performance.now();
        const end = last + duration;
        function tick(now: number) {
          intervals.push(now - last);
          last = now;
          if (now < end) {
            requestAnimationFrame(tick);
          } else {
            resolve(intervals);
          }
        }
        requestAnimationFrame(tick);
      });
    }, durationMs);
  }

  async samplePointerLatencies(count: number): Promise<PointerLatencySample[]> {
    // Placeholder implementation: the harness bridge's
    // getNodeScreenPosition/isHighlightConfirmed are wired by the real
    // prototype (see src/prototypes/*/index.tsx TODOs); until then this
    // returns an empty set rather than fabricating latency numbers.
    void count;
    return [];
  }

  async captureNavigationTiming(kind: CacheState): Promise<NavigationTiming> {
    await this.page.reload();
    const timing = await this.page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return {
        responseStart: nav?.responseStart ?? 0,
        responseEnd: nav?.responseEnd ?? 0,
        domContentLoadedEventEnd: nav?.domContentLoadedEventEnd ?? 0,
      };
    });
    return {
      kind,
      navigationIntentMs: 0,
      apiRequestStartMs: timing.responseStart,
      apiRequestEndMs: timing.responseEnd,
      payloadReceivedMs: timing.responseEnd,
      rendererInitMs: timing.domContentLoadedEventEnd,
      firstValidFrameMs: timing.domContentLoadedEventEnd,
      interactiveMs: timing.domContentLoadedEventEnd,
    };
  }

  async runLifecycleCycle(cycleIndex: number): Promise<LifecycleSnapshot> {
    // Placeholder: real geometry/texture/program/listener counts require a
    // real renderer's `renderer.info` plus lifecycle instrumentation, which
    // the placeholder prototypes don't have. Returns a zeroed snapshot so
    // the shape is exercised without fabricating nonzero counts.
    return {
      cycle: cycleIndex,
      geometries: 0,
      textures: 0,
      programs: 0,
      activeWorkers: 0,
      activeObservers: 0,
      activeTimers: 0,
      registeredListeners: 0,
    };
  }

  async getFixtureContentHash(fixtureName: string): Promise<string> {
    return this.page.evaluate(
      (key) => (window as unknown as Record<string, HarnessBridge>)[key].fixtureContentHash,
      HARNESS_BRIDGE_KEY,
    ).catch(() => `unknown-${fixtureName}`);
  }

  async getRendererBuildLabel(prototypeId: PrototypeId): Promise<string> {
    return `prototype-${prototypeId}@scaffold`;
  }
}

test.describe("renderer bakeoff bench protocol", () => {
  test.skip(
    true,
    "Prototype A/B are placeholder scaffolds (charter: 'Do NOT build the prototypes themselves'). " +
      "Remove this skip once a real GraphPrototypeHandle implementation exists for at least one prototype id.",
  );

  for (const prototypeId of ["a", "b"] as const) {
    for (const fixtureName of FIXTURE_NAMES) {
      test(`${prototypeId} / ${fixtureName} — ${BENCH_PROTOCOL.MEASURED_TRIALS_PER_FIXTURE} measured trials`, async ({ page }) => {
        const driver = new PlaywrightBenchDriver(page);
        await driver.runWarmupCycle();

        mkdirSync(RESULTS_DIR, { recursive: true });

        for (let trialIndex = 1; trialIndex <= BENCH_PROTOCOL.MEASURED_TRIALS_PER_FIXTURE; trialIndex++) {
          const result: TrialResult = await runMeasuredTrial(driver, {
            prototypeId,
            fixtureName,
            trialIndex,
            cacheState: "warm",
          });
          const outPath = join(RESULTS_DIR, `${prototypeId}--${fixtureName}--trial${trialIndex}.json`);
          writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
          expect(result.trialIndex).toBe(trialIndex);
        }
      });
    }
  }
});
