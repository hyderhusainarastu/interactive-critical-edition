/**
 * Stage 2 CORRECTION lane — real, executed re-run of ONLY the charter §13
 * bench step 9 lifecycle check (20x mount/unmount, fixture-24), using the
 * corrected v2 protocol (`runLifecycleBenchmarkV2` / `LifecycleControlV2` /
 * `runCorrectedCycle()` — see `src/App.tsx` and `src/bench/runner.ts` for
 * the full design). Deliberately scoped to just the lifecycle gate, not the
 * whole 57-file suite `scripts/run-bench.ts` produced — the orbit-FPS,
 * pointer-latency, and navigation-timing measurements are untouched by this
 * correction and don't need re-measuring.
 *
 * Reuses the real driver (`RealBenchDriver`) and build/serve helpers from
 * `scripts/run-bench.ts` rather than re-implementing them, so this run goes
 * through the exact same production-build + headed-Chromium + `__name`
 * polyfill path the original full suite did — no shortcuts that would make
 * this measurement less comparable to the original.
 *
 * Writes `<prototype>--lifecycle--fixture-24--v2.json`, alongside (never
 * overwriting) the original `<prototype>--lifecycle--fixture-24.json`
 * files, per the correction task's explicit instruction to keep the old
 * artifacts in place for the record.
 */
import { chromium, type Browser, type Page } from "@playwright/test";

import { runLifecycleBenchmarkV2, evaluateLifecycleV2 } from "../src/bench/runner";
import type { LifecycleTrialResultV2 } from "../src/bench/types";
import type { PrototypeId } from "../src/types/prototype";
import { BASE_URL, PORT, RealBenchDriver, buildProductionBundle, log, startPreviewServer, waitForServer, writeResult } from "./run-bench";

const LIFECYCLE_FIXTURE = "fixture-24";

async function launchBrowserAndPage(): Promise<{ browser: Browser; page: Page; headedUsed: boolean }> {
  let headed = true;
  let br: Browser;
  try {
    br = await Promise.race([
      chromium.launch({ headless: false, args: ["--force-device-scale-factor=1"] }),
      new Promise<Browser>((_, reject) => setTimeout(() => reject(new Error("headed launch timeout")), 20_000)),
    ]);
  } catch (err) {
    log(`Headed launch failed (${err instanceof Error ? err.message : String(err)}); falling back to headless 'new'.`);
    headed = false;
    br = await chromium.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
  }
  log(`Browser launched. headed=${headed}`);

  const pg = await br.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  // Same tsx/esbuild `__name` gap fix as scripts/run-bench.ts (see that
  // file's launchBrowserAndPage() comment for the full explanation) — this
  // script also uses named helper functions inside page.evaluate()-bound
  // closures indirectly via the imported orchestration, so the polyfill is
  // needed here too.
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

  // Diagnostic-only: surface any browser-level WebGL context warning
  // (e.g. Chromium's "Too many active WebGL contexts" eviction notice) in
  // this script's own log, so the correction addendum can cite real
  // console evidence rather than guessing at the browser-internal
  // mechanism behind the original v1 alternation.
  pg.on("console", (msg) => {
    const text = msg.text();
    if (/webgl/i.test(text) || /context/i.test(text)) {
      log(`[page console:${msg.type()}] ${text}`);
    }
  });

  return { browser: br, page: pg, headedUsed: headed };
}

async function runOnePrototype(prototypeId: PrototypeId, page: Page): Promise<LifecycleTrialResultV2> {
  const driver = new RealBenchDriver(page);
  driver.currentPrototypeId = prototypeId;
  driver.currentFixtureName = LIFECYCLE_FIXTURE;

  log(`--- Corrected lifecycle 20x mount/unmount (v2): ${prototypeId}/${LIFECYCLE_FIXTURE} ---`);

  // Navigate explicitly (rather than letting the first runLifecycleCycleV2
  // call do it lazily) so the harness bridge — and therefore the real
  // fixtureContentHash — is still live at capture time. Every lifecycle
  // cycle clears the bridge on its own unmount step, so reading the hash
  // AFTER the sweep runs would silently read "unknown" instead of the real
  // value; caught by inspecting the first real run's output before writing
  // this up.
  await driver.navigate(prototypeId, LIFECYCLE_FIXTURE, "warm");
  // Wait for the initial auto-mount's harness bridge to actually register
  // (App.tsx registers it only inside mountOnce()'s .then(), after
  // "interactive") before reading fixtureContentHash off it — without
  // this, whichever prototype's bundle happened to parse/mount slightly
  // slower raced the hash read and silently fell back to "unknown"
  // (reproduced directly: prototype b did exactly this on the first fixed
  // attempt, while prototype a's slower page load happened to win the
  // race by accident).
  await driver.waitForPayloadReceived();
  await driver.waitForInteractive();
  const envBase = await driver.captureEnvironment();
  const fixtureContentHash = await driver.getFixtureContentHash(LIFECYCLE_FIXTURE);
  const rendererBuild = await driver.getRendererBuildLabel(prototypeId);
  // Mark the driver as already navigated so runLifecycleCycleV2's first
  // call doesn't navigate a second time.
  (driver as unknown as { lifecycleMounted: boolean }).lifecycleMounted = true;
  await page.waitForFunction(
    () => Boolean((window as unknown as { __graphBakeoffLifecycleV2?: unknown }).__graphBakeoffLifecycleV2),
    undefined,
    { timeout: 5_000 },
  );

  const lifecycle = await runLifecycleBenchmarkV2(driver, { prototypeId, fixtureName: LIFECYCLE_FIXTURE });
  const evalResult = evaluateLifecycleV2(lifecycle);
  log(`Corrected lifecycle result ${prototypeId}: pass=${evalResult.pass} violations=${JSON.stringify(evalResult.violations)}`);
  log(
    `  mountedSettled baseline=${JSON.stringify(lifecycle.mountedSettled.baseline)} final=${JSON.stringify(
      lifecycle.mountedSettled.cycles[lifecycle.mountedSettled.cycles.length - 1],
    )}`,
  );
  log(
    `  postUnmount    baseline=${JSON.stringify(lifecycle.postUnmount.baseline)} final=${JSON.stringify(
      lifecycle.postUnmount.cycles[lifecycle.postUnmount.cycles.length - 1],
    )}`,
  );

  const result: LifecycleTrialResultV2 = {
    protocolVersion: "2.0.0",
    prototypeId,
    fixtureName: LIFECYCLE_FIXTURE,
    environment: {
      ...envBase,
      fixtureName: LIFECYCLE_FIXTURE,
      fixtureContentHash,
      rendererBuild,
      cacheState: "warm",
    },
    lifecycle,
    recordedAtIso: new Date().toISOString(),
  };

  writeResult(`${prototypeId}--lifecycle--${LIFECYCLE_FIXTURE}--v2.json`, result);
  return result;
}

async function main() {
  log("=== Stage 2 CORRECTION lane: corrected lifecycle re-run starting ===");

  buildProductionBundle();
  const previewProc = startPreviewServer();
  await waitForServer(`${BASE_URL}/`, 30_000);
  log("Preview server ready.");

  const { browser, page } = await launchBrowserAndPage();

  try {
    const resultA = await runOnePrototype("a", page);
    // Fresh page per prototype — avoids any carryover WebGL-context state
    // from prototype A's run leaking into prototype B's measurement
    // (each prototype's fixture-24 lifecycle sweep should stand on its
    // own, exactly as the original run treated them as two independent
    // `<prototype>--lifecycle--fixture-24.json` files).
    await page.close();
    const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page2.addInitScript(() => {
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
    page2.on("console", (msg) => {
      const text = msg.text();
      if (/webgl/i.test(text) || /context/i.test(text)) {
        log(`[page console:${msg.type()}] ${text}`);
      }
    });
    const resultB = await runOnePrototype("b", page2);

    log("=== Corrected lifecycle re-run complete ===");
    log(`A: pass=${evaluateLifecycleV2(resultA.lifecycle).pass}`);
    log(`B: pass=${evaluateLifecycleV2(resultB.lifecycle).pass}`);
  } finally {
    await browser.close().catch(() => {});
    previewProc.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
