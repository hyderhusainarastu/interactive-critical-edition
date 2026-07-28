/**
 * Stage 2 CORRECTION lane — contamination screen re-run.
 *
 * The owner physically clicked the headed browser at least once, at an
 * unknown time, during the original measurement window (2026-07-27/28
 * 23:45:19-02:03:21 UTC). This script re-runs, cleanly and in isolation,
 * the specific (prototype, fixture, trialIndex) combinations the
 * contamination screen (see the correction task's step 5 — computed via a
 * one-off Python pass over all 50 mandatory trial files, comparing each
 * fixture x prototype group's 5 trials' median FPS / p95 frame time / p95
 * pointer latency for a >25% relative or >3x-IQR deviation) flagged.
 *
 * "Cleanly" here means: a fresh browser launch, a fresh navigation, one
 * full warm-up cycle (charter step 4), then exactly one measured trial —
 * the same per-trial sequence `runMeasuredTrial` always runs (it
 * re-navigates internally too), just run in an isolated single-purpose
 * session instead of embedded in the middle of the original long
 * multi-trial run where a stray click could have landed anywhere.
 *
 * Writes `<prototype>--<fixture>--trial<N>--rerun.json`, never overwriting
 * the original trial file.
 */
import { chromium, type Browser, type Page } from "@playwright/test";

import { runMeasuredTrial } from "../src/bench/runner";
import type { PrototypeId } from "../src/types/prototype";
import { BASE_URL, PORT, RealBenchDriver, buildProductionBundle, log, startPreviewServer, waitForServer, writeResult } from "./run-bench";

interface FlaggedTrial {
  prototypeId: PrototypeId;
  fixtureName: string;
  trialIndex: number;
}

// From the contamination screen's output (scratchpad/contamination_screen.py
// run against results/*.json) — see docs/audits/graph-renderer-bakeoff.md's
// Correction addendum for the full flagged-metric detail per trial.
const FLAGGED: FlaggedTrial[] = [
  { prototypeId: "a", fixtureName: "fixture-12", trialIndex: 4 },
  { prototypeId: "a", fixtureName: "fixture-60", trialIndex: 1 },
  { prototypeId: "a", fixtureName: "fixture-60", trialIndex: 2 },
  { prototypeId: "a", fixtureName: "fixture-120", trialIndex: 5 },
  { prototypeId: "b", fixtureName: "fixture-12", trialIndex: 5 },
  { prototypeId: "b", fixtureName: "fixture-500", trialIndex: 5 },
];

async function launchBrowserAndPage(): Promise<{ browser: Browser; page: Page }> {
  let br: Browser;
  try {
    br = await Promise.race([
      chromium.launch({ headless: false, args: ["--force-device-scale-factor=1"] }),
      new Promise<Browser>((_, reject) => setTimeout(() => reject(new Error("headed launch timeout")), 20_000)),
    ]);
  } catch (err) {
    log(`Headed launch failed (${err instanceof Error ? err.message : String(err)}); falling back to headless 'new'.`);
    br = await chromium.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
  }
  const pg = await br.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await pg.addInitScript(() => {
    const w = window as unknown as { __name?: (fn: unknown, name: string) => unknown };
    if (!w.__name) {
      w.__name = (fn: unknown, name: string) => {
        try {
          Object.defineProperty(fn as object, "name", { value: name, configurable: true });
        } catch {
          // best-effort only
        }
        return fn;
      };
    }
  });
  return { browser: br, page: pg };
}

async function main() {
  log("=== Stage 2 CORRECTION lane: contamination-screen re-runs starting ===");
  log(`${FLAGGED.length} flagged trial(s) to re-run: ${FLAGGED.map((f) => `${f.prototypeId}--${f.fixtureName}--trial${f.trialIndex}`).join(", ")}`);

  buildProductionBundle();
  const previewProc = startPreviewServer();
  await waitForServer(`${BASE_URL}/`, 30_000);
  log("Preview server ready.");

  try {
    for (const { prototypeId, fixtureName, trialIndex } of FLAGGED) {
      log(`--- Clean re-run: ${prototypeId}/${fixtureName}/trial${trialIndex} ---`);
      // Fresh browser + fresh page per re-run — full isolation from any
      // other trial in this batch, exactly as "cleanly" requires.
      const { browser, page } = await launchBrowserAndPage();
      const driver = new RealBenchDriver(page);

      await driver.navigate(prototypeId, fixtureName, "warm");
      await driver.waitForPayloadReceived();
      await driver.waitForInteractive();
      await driver.runWarmupCycle();
      log(`  warm-up complete`);

      const result = await runMeasuredTrial(driver, { prototypeId, fixtureName, trialIndex, cacheState: "warm" });
      writeResult(`${prototypeId}--${fixtureName}--trial${trialIndex}--rerun.json`, result);
      log(
        `  medianFps=${result.orbit.medianFps.toFixed(1)} p95Frame=${result.orbit.p95FrameTimeMs.toFixed(1)}ms ` +
          `p95Pointer=${result.pointerLatency.p95LatencyMs.toFixed(1)}ms payload->interactive=${result.payloadToInteractiveMs.toFixed(0)}ms`,
      );

      await browser.close().catch(() => {});
    }
    log("=== Contamination-screen re-runs complete ===");
  } finally {
    previewProc.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
