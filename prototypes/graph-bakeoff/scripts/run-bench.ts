/**
 * Real, executed run of the charter §13 bench protocol for both prototypes,
 * against a production (`vite build` + `vite preview`) build, driven by
 * headed Chromium via Playwright.
 *
 * This is the Stage 2 MEASUREMENT lane's own driver — it implements the
 * `BenchDriver` interface from `src/bench/runner.ts` for real, using the
 * bench harness bridge (`src/bench/harnessBridge.ts`) both prototypes now
 * populate for real (the Stage 2 lane's own App.tsx wiring fix).
 *
 * Production build, not `vite dev`: `vite dev` renders through React
 * StrictMode's development-only double-invoked effects, which raced with
 * this driver's own bridge-polling (reproduced directly: a boolean
 * `waitForFunction` predicate followed by a separate `page.evaluate()` read
 * intermittently observed the bridge object having been torn down and not
 * yet re-registered). `vite build`'s bundle carries no dev-mode React
 * markers (verified: zero "Warning: %s" strings, the tell-tale dev-build
 * console.error format literal) and eliminates the race, while also being
 * the fairer, more representative thing to measure (dev-mode React/Vite
 * carry real unminified-code and instrumentation overhead the charter's
 * floors were never meant to be measured against).
 *
 * Bridge-read pattern: every `waitForFunction()` used to detect
 * payload-received/interactive returns the actual value from the resolved
 * predicate (via `.jsonValue()`), rather than a boolean followed by a
 * separate `page.evaluate()` call — the latter pattern was the one that
 * exposed the CDP/console-listener-sensitive race above; this pattern
 * never reproduced it across dozens of manual verification runs.
 */
import { chromium, type Browser, type CDPSession, type Page } from "@playwright/test";
import { spawn, type ChildProcess, execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as os from "node:os";

import {
  runMeasuredTrial,
  runNavigationBenchmark,
  runLifecycleBenchmark,
  runLifecycleBenchmarkV2,
  evaluateFloors,
  evaluateLifecycle,
  evaluateLifecycleV2,
  percentileOf,
  type BenchDriver,
} from "../src/bench/runner";
import {
  BENCH_PROTOCOL,
  BENCH_FLOORS,
  MANDATORY_FIXTURES,
  DIAGNOSTIC_ONLY_FIXTURES,
  type BenchEnvironment,
  type CacheState,
  type LifecycleSnapshot,
  type LifecycleSnapshotPair,
  type NavigationTiming,
  type PointerLatencySample,
  type TrialResult,
  type NavigationTrialResult,
  type LifecycleTrialResult,
  type LifecycleTrialResultV2,
} from "../src/bench/types";
import type { PrototypeId } from "../src/types/prototype";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");
const RESULTS_DIR = join(ROOT, "results");
export const PORT = 5183;
export const BASE_URL = `http://localhost:${PORT}`;
const HARNESS_BRIDGE_KEY = "__graphBakeoffHarness";
const NAV_FIXTURE = "fixture-120"; // charter's own warm/cold nav floors name the 120-node scene explicitly
const LIFECYCLE_FIXTURE = "fixture-24"; // lightweight, representative; not FPS-sensitive

export function log(msg: string): void {
  const t = new Date().toISOString();
  console.log(`[${t}] ${msg}`);
}

function loadFixtureNodeIds(fixtureName: string): string[] {
  const raw = readFileSync(join(ROOT, "src", "fixtures", "data", `${fixtureName}.json`), "utf8");
  const parsed = JSON.parse(raw) as { nodes: Array<{ id: string }> };
  return parsed.nodes.map((n) => n.id);
}

// ---------------------------------------------------------------------
// Preflight: machine load check (protocol instruction — wait up to 10min
// polling every 60s if a heavy concurrent process is present, then record
// the final state honestly regardless of outcome).
// ---------------------------------------------------------------------
function readLoadAvg(): number {
  return os.loadavg()[0];
}

function heavyProcessSnapshot(): string {
  try {
    return execSync(
      "ps aux | grep -iE 'next build|vite build|playwright test|webpack|tsc -b' | grep -v grep || true",
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "(ps check failed)";
  }
}

async function preflightMachineCheck(): Promise<{ waited: boolean; finalLoadAvg: number; finalProcesses: string }> {
  const POLL_MS = 60_000;
  const MAX_WAIT_MS = 10 * 60_000;
  let waited = false;
  let elapsed = 0;
  while (elapsed < MAX_WAIT_MS) {
    const procs = heavyProcessSnapshot();
    const load = readLoadAvg();
    if (procs.length === 0 && load < 4) {
      return { waited, finalLoadAvg: load, finalProcesses: procs || "(none)" };
    }
    log(`Preflight: heavy process(es) detected or high load (loadavg=${load.toFixed(2)}). Waiting 60s...\n${procs}`);
    waited = true;
    await new Promise((r) => setTimeout(r, POLL_MS));
    elapsed += POLL_MS;
  }
  return { waited, finalLoadAvg: readLoadAvg(), finalProcesses: heavyProcessSnapshot() || "(none)" };
}

// ---------------------------------------------------------------------
// Build + serve production bundle
// ---------------------------------------------------------------------
export function buildProductionBundle(): void {
  log("Building production bundle (npm run build)...");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
}

export function startPreviewServer(): ChildProcess {
  log(`Starting vite preview on port ${PORT}...`);
  const proc = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d) => process.stdout.write(`[preview] ${d}`));
  proc.stderr?.on("data", (d) => process.stderr.write(`[preview] ${d}`));
  return proc;
}

export async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------
// Machine/browser environment capture
// ---------------------------------------------------------------------
function macModel(): string {
  try {
    return execSync("sysctl -n hw.model", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function macOsVersion(): string {
  try {
    return execSync("sw_vers -productVersion", { encoding: "utf8" }).trim();
  } catch {
    return os.release();
  }
}

// ---------------------------------------------------------------------
// Real Playwright BenchDriver implementation
// ---------------------------------------------------------------------
export class RealBenchDriver implements BenchDriver {
  private page: Page;
  private cdp: CDPSession | null = null;
  currentPrototypeId: PrototypeId | null = null;
  currentFixtureName: string = "";
  private lifecycleMounted = false;

  constructor(page: Page) {
    this.page = page;
  }

  async captureEnvironment() {
    const viewport = this.page.viewportSize() ?? { width: 1440, height: 900 };
    const browserVersion = this.page.context().browser()?.version() ?? "unknown";
    const dpr = await this.page.evaluate(() => window.devicePixelRatio);
    return {
      machineModel: process.platform === "darwin" ? macModel() : `${process.platform} ${os.arch()}`,
      os: process.platform === "darwin" ? `macOS ${macOsVersion()}` : `${process.platform} ${os.release()}`,
      browser: "chromium",
      browserVersion,
      powerMode: "unknown", // no standard cross-browser power-mode API
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      devicePixelRatio: dpr,
    };
  }

  async navigate(prototypeId: PrototypeId, fixtureName: string, _cacheState: CacheState): Promise<number> {
    this.currentPrototypeId = prototypeId;
    this.currentFixtureName = fixtureName;
    await this.page.goto(`${BASE_URL}/?proto=${prototypeId}&fixture=${fixtureName}`, { waitUntil: "load" });
    return 0; // performance.now() in the freshly-navigated page is itself 0-based at navigation start
  }

  /** Validated safe pattern: return the value straight from the resolved
   * predicate handle, never via a separate follow-up `page.evaluate()` —
   * see module doc comment for why. */
  async waitForPayloadReceived(): Promise<number> {
    const handle = await this.page.waitForFunction(
      (key) => {
        const b = (window as unknown as Record<string, { payloadReceivedAtMs: number | null } | undefined>)[key];
        return b && b.payloadReceivedAtMs !== null ? b.payloadReceivedAtMs : false;
      },
      HARNESS_BRIDGE_KEY,
      { timeout: 20_000 },
    );
    return (await handle.jsonValue()) as number;
  }

  async waitForInteractive(): Promise<number> {
    const handle = await this.page.waitForFunction(
      (key) => {
        const b = (window as unknown as Record<string, { interactiveAtMs: number | null } | undefined>)[key];
        return b && b.interactiveAtMs !== null ? b.interactiveAtMs : false;
      },
      HARNESS_BRIDGE_KEY,
      { timeout: 20_000 },
    );
    return (await handle.jsonValue()) as number;
  }

  async runWarmupCycle(): Promise<void> {
    if (!this.currentPrototypeId) throw new Error("runWarmupCycle called before navigate()");
    await this.navigate(this.currentPrototypeId, this.currentFixtureName, "warm");
    await this.waitForPayloadReceived();
    await this.waitForInteractive();
    // One complete scripted orbit, discarded.
    await this.sampleOrbitFrameIntervals(2_000, 0);
    // One selection/focus/reset cycle, discarded.
    await this.page.evaluate((key) => {
      const bridge = (window as unknown as Record<string, { handle: { select(id: string | null): void; focus(id: string): void; home(): void } }>)[key];
      bridge.handle.select("n0");
      bridge.handle.focus("n0");
      bridge.handle.home();
      bridge.handle.select(null);
    }, HARNESS_BRIDGE_KEY);
  }

  async sampleOrbitFrameIntervals(durationMs: number, stabilizationMs: number): Promise<number[]> {
    if (stabilizationMs > 0) {
      await this.page.waitForTimeout(stabilizationMs);
    }
    return this.page.evaluate(({ duration, key }) => {
      return new Promise<number[]>((resolve) => {
        const bridgeKey = key as string;
        const bridge = (window as unknown as Record<string, { handle: { getCameraPose(): { position: readonly [number, number, number]; target: readonly [number, number, number] } } } | undefined>)[bridgeKey];
        // Scripted azimuth/elevation orbit around the current target, at a
        // fixed distance/radius derived from the current camera pose, so
        // both prototypes orbit through an equivalent path regardless of
        // their own camera-math internals (both already expose
        // getCameraPose() per the shared GraphPrototypeHandle contract —
        // this loop only reads it once to derive radius/center, it does
        // not command the camera through handle methods since neither
        // prototype exposes a raw "setCameraPose"; instead it derives
        // frame timing purely from requestAnimationFrame, which is the
        // actual thing being measured (steady-state render cost), and
        // nudges the pose via direct camera math is out of scope for a
        // frame-interval sampler — real production orbit interaction
        // (OrbitControls / three-render-objects controls) is driven here
        // via synthetic pointer drag events instead, below.
        void bridge;
        const intervals: number[] = [];
        let last = performance.now();
        const end = last + duration;

        // Synthetic continuous drag across the canvas to actually invoke
        // each prototype's real OrbitControls/three-render-objects camera
        // controls during the sampling window (not just idle-render FPS).
        //
        // Gap fix (found live — blocked fair FPS measurement entirely):
        // this originally dispatched `MouseEvent` mousedown/mousemove/
        // mouseup. Both prototypes' actual camera controls are three.js
        // `OrbitControls`-family (Prototype A via `three-render-objects`,
        // confirmed by reading node_modules/3d-force-graph/dist directly:
        // `this.domElement.addEventListener('pointerdown', ...)` /
        // `ownerDocument.addEventListener('pointermove', ...)`) — modern
        // three.js `OrbitControls` listens ONLY for `pointerdown`/
        // `pointermove`/`pointerup`, never `mousedown`/`mousemove`/
        // `mouseup`. A `MouseEvent` never fires a `pointerdown` listener
        // (they are distinct DOM event types), so the scripted "orbit" was
        // silently a no-op drag against both prototypes — the FPS sample
        // was real, but of an idle/static scene, not the interaction load
        // the charter's orbit-FPS floor is meant to measure. Switched to
        // real `PointerEvent`s with `pointerId`/`pointerType`/`isPrimary`
        // set (OrbitControls' pointer handlers key off these).
        const canvas = document.querySelector("canvas");
        const rect = canvas?.getBoundingClientRect();
        let dragT = 0;
        function driveOrbitPointer() {
          if (!canvas || !rect) return;
          dragT += 1;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const radius = Math.min(rect.width, rect.height) * 0.28;
          const angle = (dragT / 90) * Math.PI * 2;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle * 0.6) * radius * 0.6;
          const base = {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            view: window,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          };
          if (dragT === 1) {
            canvas.dispatchEvent(new PointerEvent("pointerdown", { ...base, button: 0, buttons: 1, pressure: 0.5 }));
          }
          canvas.dispatchEvent(new PointerEvent("pointermove", { ...base, button: -1, buttons: 1, pressure: 0.5 }));
        }

        function tick(now: number) {
          intervals.push(now - last);
          last = now;
          driveOrbitPointer();
          if (now < end) {
            requestAnimationFrame(tick);
          } else {
            if (canvas) {
              const rectNow = canvas.getBoundingClientRect();
              canvas.dispatchEvent(
                new PointerEvent("pointerup", {
                  clientX: rectNow.left,
                  clientY: rectNow.top,
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  pointerId: 1,
                  pointerType: "mouse",
                  isPrimary: true,
                  button: 0,
                  buttons: 0,
                }),
              );
            }
            resolve(intervals);
          }
        }
        requestAnimationFrame(tick);
      });
    }, { duration: durationMs, key: HARNESS_BRIDGE_KEY });
  }

  async samplePointerLatencies(count: number): Promise<PointerLatencySample[]> {
    const nodeIds = loadFixtureNodeIds(this.currentFixtureName);
    const samples: PointerLatencySample[] = [];
    let attempts = 0;
    let idx = 0;
    const maxAttempts = count * 6;

    while (samples.length < count && attempts < maxAttempts) {
      attempts++;
      const nodeId = nodeIds[idx % nodeIds.length];
      idx++;

      const result = await this.page.evaluate(
        ({ key, nodeId }) => {
          return new Promise<{ dispatchedAtMs: number; confirmedAtMs: number } | null>((resolve) => {
            const bridge = (window as unknown as Record<
              string,
              {
                getNodeScreenPosition(id: string): { x: number; y: number } | null;
                isHighlightConfirmed(id: string): boolean;
                handle: { select(id: string | null): void };
              }
            >)[key];
            if (!bridge) return resolve(null);
            const pos = bridge.getNodeScreenPosition(nodeId);
            if (!pos) return resolve(null);
            const canvas = document.querySelector("canvas");
            if (!canvas) return resolve(null);

            // Reset selection first so this dispatch measures a genuine
            // not-confirmed -> confirmed transition, not a stale confirmed
            // state left over from a previous sample re-targeting the same
            // node (fixtures with < 50 nodes cycle node ids more than once
            // to reach the mandatory 50-sample floor).
            bridge.handle.select(null);
            let resetAttempts = 0;
            function waitForReset() {
              resetAttempts++;
              if (!bridge.isHighlightConfirmed(nodeId) || resetAttempts > 30) {
                dispatchAndMeasure();
              } else {
                requestAnimationFrame(waitForReset);
              }
            }

            // Gap fix (found live via a throwaway diagnostic script after
            // the real DRY_RUN stalled ~4.5s/attempt * up to 300 attempts
            // with zero confirmed selections): this originally dispatched
            // `MouseEvent` mousedown/mouseup/click. Neither prototype's
            // real picking path is driven by those event types the way
            // this assumed:
            //  - Prototype A (`3d-force-graph`/`three-render-objects`,
            //    read directly from node_modules): its container listens
            //    ONLY for `pointermove`/`pointerdown`/`pointerup` — never
            //    `mousedown`/`mouseup`/`click` at all — and selection
            //    reads `state.hoverObj`, which is populated by a
            //    *throttled* (`pointerRaycasterThrottleMs`, default 50ms)
            //    raycast tied to `state.pointerPos`, itself only updated
            //    on a real `pointermove`/`pointerdown` event. A `click`-
            //    only dispatch with no prior `pointermove` never sets
            //    `hoverObj` to the target node at all, so the click
            //    "confirms" nothing.
            //  - Prototype B (`GraphSceneB.tsx`, this repo): `handleClick`
            //    does re-raycast fresh from the click's own coordinates
            //    independent of hover, so a plain synthetic `click` would
            //    have worked for B alone — but `pointerdown`/`pointerup`
            //    are still what a real user's browser fires before a
            //    `click`, so sending the same realistic sequence to both
            //    prototypes (rather than a prototype-specific branch) is
            //    both the fairer thing to measure and the simpler fix.
            // Fixed sequence, all real `PointerEvent`s (not `MouseEvent`):
            // (1) `pointermove` at the target, so Prototype A's hover
            // raycast has a pointerPos to work from; (2) a real wait (not
            // just a `requestAnimationFrame` or two — `setTimeout` is used
            // deliberately here since the elapsed *wall*-clock time must
            // exceed the raycaster's 50ms throttle, not merely "some
            // frames") past that throttle so `hoverObj` actually updates
            // before the click; (3) `pointerdown` — `dispatchedAtMs` is
            // timestamped exactly here, matching a real user's perceived
            // "I clicked" moment, not the earlier priming move; (4)
            // `pointerup`; (5) a `click` `MouseEvent`, for Prototype B's
            // listener (Prototype A doesn't listen for `click` at all, so
            // this is a harmless no-op there).
            function dispatchAndMeasure() {
              const rect = canvas!.getBoundingClientRect();
              const clientX = rect.left + pos!.x;
              const clientY = rect.top + pos!.y;
              const pointerBase = {
                clientX,
                clientY,
                bubbles: true,
                cancelable: true,
                view: window,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
              };

              canvas!.dispatchEvent(
                new PointerEvent("pointermove", { ...pointerBase, button: -1, buttons: 0, pressure: 0 }),
              );

              setTimeout(() => {
                const dispatchedAtMs = performance.now();
                canvas!.dispatchEvent(
                  new PointerEvent("pointerdown", { ...pointerBase, button: 0, buttons: 1, pressure: 0.5 }),
                );
                canvas!.dispatchEvent(
                  new PointerEvent("pointerup", { ...pointerBase, button: 0, buttons: 0, pressure: 0 }),
                );
                canvas!.dispatchEvent(new MouseEvent("click", { ...pointerBase, button: 0 }));

                let confirmAttempts = 0;
                function poll() {
                  confirmAttempts++;
                  if (bridge.isHighlightConfirmed(nodeId)) {
                    resolve({ dispatchedAtMs, confirmedAtMs: performance.now() });
                  } else if (confirmAttempts > 240) {
                    resolve(null); // timeout — not counted as a sample
                  } else {
                    requestAnimationFrame(poll);
                  }
                }
                requestAnimationFrame(poll);
              }, 120); // > pointerRaycasterThrottleMs (50ms), generous margin
            }

            waitForReset();
          });
        },
        { key: HARNESS_BRIDGE_KEY, nodeId },
      );

      if (result) {
        samples.push({
          targetNodeId: nodeId,
          dispatchedAtMs: result.dispatchedAtMs,
          highlightConfirmedAtMs: result.confirmedAtMs,
          latencyMs: result.confirmedAtMs - result.dispatchedAtMs,
        });
      }
    }

    if (samples.length < count) {
      log(`WARNING: only collected ${samples.length}/${count} pointer-latency samples for ${this.currentPrototypeId}/${this.currentFixtureName} after ${attempts} attempts`);
    }
    return samples;
  }

  private async ensureCdp(): Promise<CDPSession> {
    if (!this.cdp) {
      this.cdp = await this.page.context().newCDPSession(this.page);
    }
    return this.cdp;
  }

  async captureNavigationTiming(kind: CacheState): Promise<NavigationTiming> {
    const cdp = await this.ensureCdp();
    if (kind === "cold") {
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.clearBrowserCache");
    } else {
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
    }

    await this.page.reload({ waitUntil: "load" });
    await this.waitForPayloadReceived();
    const interactiveMs = await this.waitForInteractive();

    const timing = await this.page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const bridge = (window as unknown as Record<string, { payloadReceivedAtMs: number | null; interactiveAtMs: number | null } | undefined>)["__graphBakeoffHarness"];
      return {
        responseStart: nav?.responseStart ?? 0,
        responseEnd: nav?.responseEnd ?? 0,
        payloadReceivedAtMs: bridge?.payloadReceivedAtMs ?? 0,
        interactiveAtMs: bridge?.interactiveAtMs ?? 0,
      };
    });

    return {
      kind,
      navigationIntentMs: 0,
      apiRequestStartMs: timing.responseStart,
      apiRequestEndMs: timing.responseEnd,
      payloadReceivedMs: timing.payloadReceivedAtMs,
      // No separate "renderer initialized" marker exists in the current
      // harness bridge (only payload-received and interactive); documented
      // simplification, not a fabricated value — reuses the real
      // payload-received timestamp rather than inventing an intermediate
      // one neither prototype actually reports.
      rendererInitMs: timing.payloadReceivedAtMs,
      firstValidFrameMs: interactiveMs,
      interactiveMs: interactiveMs,
    };
  }

  async runLifecycleCycle(cycleIndex: number): Promise<LifecycleSnapshot> {
    if (!this.lifecycleMounted) {
      await this.navigate(this.currentPrototypeId!, this.currentFixtureName, "warm");
      await this.waitForPayloadReceived();
      await this.waitForInteractive();
      this.lifecycleMounted = true;
    }

    const handle = await this.page.waitForFunction(
      (cycle) => {
        const control = (window as unknown as { __graphBakeoffLifecycle?: { remountCycle(c: number): Promise<LifecycleSnapshot> } }).__graphBakeoffLifecycle;
        if (!control) return false;
        // waitForFunction predicates must be synchronous-looking (return a
        // truthy value once ready); kick off the async remount and stash
        // the promise on window so a second predicate poll can read it.
        const w = window as unknown as { __remountPromise?: Promise<LifecycleSnapshot> };
        if (!w.__remountPromise) {
          w.__remountPromise = control.remountCycle(cycle);
        }
        return true;
      },
      cycleIndex,
      { timeout: 5_000 },
    );
    await handle.jsonValue();

    const snapshot = await this.page.evaluate(async () => {
      const w = window as unknown as { __remountPromise?: Promise<LifecycleSnapshot> };
      const result = await w.__remountPromise!;
      delete w.__remountPromise;
      return result;
    });

    // Wait for the fresh mount (started inside remountCycle) to report
    // interactive again before the next cycle begins.
    await this.waitForInteractive();

    return snapshot;
  }

  /** Corrected v2 protocol (Stage 2 correction lane) — see `App.tsx`'s
   * `LifecycleControlV2`/`runCorrectedCycle()` doc comment for the full
   * per-cycle sequence. Each call is a single, self-contained mount →
   * settle → snapshot → unmount → settle → snapshot round trip driven
   * entirely in-page (one `page.evaluate` awaiting the in-page async
   * function's own promise) — no split boolean-poll-then-evaluate pattern,
   * for the same CDP-race reason documented at the top of this file. */
  async runLifecycleCycleV2(cycleIndex: number): Promise<LifecycleSnapshotPair> {
    if (!this.lifecycleMounted) {
      await this.navigate(this.currentPrototypeId!, this.currentFixtureName, "warm");
      await this.page.waitForFunction(
        () => Boolean((window as unknown as { __graphBakeoffLifecycleV2?: unknown }).__graphBakeoffLifecycleV2),
        undefined,
        { timeout: 5_000 },
      );
      this.lifecycleMounted = true;
    }

    return this.page.evaluate(async (cycle) => {
      const control = (window as unknown as { __graphBakeoffLifecycleV2?: { runCorrectedCycle(c: number): Promise<LifecycleSnapshotPair> } })
        .__graphBakeoffLifecycleV2;
      if (!control) throw new Error("window.__graphBakeoffLifecycleV2 not registered");
      return control.runCorrectedCycle(cycle);
    }, cycleIndex);
  }

  async getFixtureContentHash(fixtureName: string): Promise<string> {
    try {
      return await this.page.evaluate(
        (key) => (window as unknown as Record<string, { fixtureContentHash: string } | undefined>)[key]?.fixtureContentHash ?? "unknown",
        HARNESS_BRIDGE_KEY,
      );
    } catch {
      return `unknown-${fixtureName}`;
    }
  }

  async getRendererBuildLabel(prototypeId: PrototypeId): Promise<string> {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    if (prototypeId === "a") {
      return `prototype-a@react-force-graph-3d@${pkg.dependencies["react-force-graph-3d"]}`;
    }
    return `prototype-b@r3f@${pkg.dependencies["@react-three/fiber"]}+three@${pkg.dependencies["three"]}`;
  }
}

// ---------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------
export function writeResult(filename: string, data: unknown): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, filename), JSON.stringify(data, null, 2) + "\n", "utf8");
}

interface StressResult {
  prototypeId: PrototypeId;
  fixtureName: string;
  crashedOrBlank: boolean;
  detail: string;
  trial?: TrialResult;
}

async function checkStressFixture(driver: RealBenchDriver, page: Page, prototypeId: PrototypeId): Promise<StressResult> {
  const fixtureName = "fixture-1000";
  let crashedOrBlank = false;
  let detail = "ok";
  let trial: TrialResult | undefined;
  try {
    await driver.navigate(prototypeId, fixtureName, "warm");
    await driver.waitForPayloadReceived();
    await driver.waitForInteractive();

    const canvasCheck = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return { present: false, width: 0, height: 0 };
      return { present: true, width: canvas.width, height: canvas.height };
    });
    if (!canvasCheck.present || canvasCheck.width === 0 || canvasCheck.height === 0) {
      crashedOrBlank = true;
      detail = `no canvas or zero-size canvas: ${JSON.stringify(canvasCheck)}`;
    } else {
      trial = await runMeasuredTrial(driver, { prototypeId, fixtureName, trialIndex: 1, cacheState: "warm" });
      writeResult(`${prototypeId}--${fixtureName}--trial1.json`, trial);
    }
  } catch (err) {
    crashedOrBlank = true;
    detail = err instanceof Error ? err.message : String(err);
  }
  return { prototypeId, fixtureName, crashedOrBlank, detail, trial };
}

async function main() {
  log("=== Stage 2 graph-bakeoff measurement run starting ===");

  const preflight = await preflightMachineCheck();
  log(`Preflight complete. waited=${preflight.waited} finalLoadAvg=${preflight.finalLoadAvg.toFixed(2)}`);

  buildProductionBundle();
  const previewProc = startPreviewServer();
  await waitForServer(`${BASE_URL}/`, 30_000);
  log("Preview server ready.");

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

    // Gap fix (found live, blocked measurement entirely): tsx compiles this
    // *.ts file with esbuild's `keepNames: true` (tsx's own fixed default,
    // not something this file opted into — verified by reading
    // node_modules/tsx/dist/index-CQhDiIsg.mjs's shared transform options).
    // That wraps every named function this file defines — including the
    // `tick`/`driveOrbitPointer` helpers declared *inside* the closures
    // passed to `page.evaluate()` below — with a `__name(fn, "fn")` call.
    // Playwright ships a `page.evaluate(callback)` argument to the browser
    // by serializing the *actual compiled* `callback.toString()`, so the
    // `__name(...)` calls are part of what gets sent — but the `__name`
    // helper itself is a module-scope const in the Node-side compiled
    // file, never shipped to the page. Every orbit-sampling and
    // pointer-latency evaluate() call therefore threw `ReferenceError:
    // __name is not defined` on first use, silently turning "the bench
    // measures orbit FPS" into "the bench hangs/crashes before writing a
    // single trial." Fixed by predefining a compatible one-line polyfill
    // on `window` via `addInitScript` (reruns automatically on every
    // navigation/reload, so every page this driver ever creates has it
    // before any app code runs) — the minimal fix, not a build-pipeline
    // change, since it doesn't touch what tsx/esbuild actually compile,
    // only supplies the one global symbol their output assumes exists.
    await pg.addInitScript(() => {
      const w = window as unknown as { __name?: (fn: unknown, name: string) => unknown };
      if (!w.__name) {
        w.__name = (fn: unknown, name: string) => {
          try {
            Object.defineProperty(fn as object, "name", { value: name, configurable: true });
          } catch {
            // best-effort only — matches esbuild's own helper, which never
            // throws past this point either
          }
          return fn;
        };
      }
    });

    return { browser: br, page: pg, headedUsed: headed };
  }

  let { browser, page, headedUsed } = await launchBrowserAndPage();
  let driver = new RealBenchDriver(page);

  // Gap fix (found live during the real DRY_RUN, not hypothesized): the
  // stress fixture (fixture-1000/4000, the charter's own heaviest
  // mandatory scene) crashed the entire browser process outright on one
  // observed run ("Target page, context or browser has been closed" from
  // Playwright, not a script bug — no macOS crash report or jetsam/low-
  // memory log entry was found for the browser process, so the most
  // likely cause is a GPU-process crash-and-give-up under sustained
  // load, not this driver mishandling anything). Losing the whole
  // browser is already exactly what `checkStressFixture`'s own try/catch
  // is designed to record as `crashedOrBlank: true` for the fixture that
  // caused it — but a browser that's actually gone stays gone for every
  // subsequent driver call too, so without recovery a single stress-
  // fixture crash for prototype "a" was silently voiding navigation-
  // timing and lifecycle measurement for BOTH prototypes, which is a real
  // fairness problem (one prototype's crash denying the other prototype
  // its own unrelated measurements). `ensureBrowserAlive()` checks
  // `browser.isConnected()` before each major phase and relaunches a
  // fresh browser/page/driver if it's gone, so a stress-fixture crash
  // costs exactly what it should — that fixture's own result — and
  // nothing downstream.
  async function ensureBrowserAlive(context: string): Promise<void> {
    if (browser.isConnected()) return;
    log(`Browser disconnected (detected before ${context}) — relaunching.`);
    const relaunched = await launchBrowserAndPage();
    browser = relaunched.browser;
    page = relaunched.page;
    headedUsed = headedUsed && relaunched.headedUsed;
    driver = new RealBenchDriver(page);
  }

  const allTrials: TrialResult[] = [];
  const navResults: NavigationTrialResult[] = [];
  const lifecycleResults: LifecycleTrialResult[] = [];
  const stressResults: StressResult[] = [];

  const prototypes: PrototypeId[] = ["a", "b"];

  // Cleanup safety net (found live, twice): a FATAL run before this fix
  // left BOTH the Chromium browser AND the `vite preview` child process
  // running indefinitely, because `browser.close()`/`previewProc.kill()`
  // previously only sat after the very last loop below — any error
  // thrown earlier (e.g. the stress-fixture browser crash documented at
  // `ensureBrowserAlive` above) skipped them entirely. Confirmed
  // concretely: the very next DRY_RUN's own `vite preview` failed to bind
  // port 5183 ("Port 5183 is already in use") because the *previous*
  // run's orphaned preview server was still holding it — that run's
  // measurements were still valid (the orphaned server was serving the
  // same build), but an orphaned browser/server pair silently competing
  // for CPU/GPU is exactly the kind of thing that could quietly bias a
  // *later* run's numbers if left unnoticed, and it directly corrupts
  // that later run's own preflight machine-load check (which is exactly
  // what the charter's own protocol asks this script to check honestly).
  // `try/finally` here guarantees both get torn down on every exit path
  // — success, a thrown error, or the process being interrupted mid-run —
  // not just the success path the old placement covered.
  try {
    await runMeasurementProtocol();
  } finally {
    if (browser.isConnected()) {
      await browser.close();
    }
    previewProc.kill();
  }

  async function runMeasurementProtocol(): Promise<void> {
  // DRY_RUN=1 shrinks the fixture list and trial count for a fast
  // pipeline sanity pass before committing to the full ~25-30min protocol
  // run; never used for the real reported measurements (checked via the
  // env var, not a code path that silently changes the mandatory protocol).
  const dryRun = process.env.DRY_RUN === "1";
  const fixturesToRun = dryRun ? (["fixture-12"] as const) : MANDATORY_FIXTURES;
  const trialsPerFixture = dryRun ? 1 : BENCH_PROTOCOL.MEASURED_TRIALS_PER_FIXTURE;
  if (dryRun) log("DRY_RUN=1: shrunk protocol for pipeline sanity check only.");

  // ---- Mandatory + headroom fixtures: 5 trials each, alternating A/B ----
  for (const fixtureName of fixturesToRun) {
    log(`--- Fixture ${fixtureName}: warmup ---`);
    for (const prototypeId of prototypes) {
      await driver.navigate(prototypeId, fixtureName, "warm");
      await driver.waitForPayloadReceived();
      await driver.waitForInteractive();
      await driver.runWarmupCycle();
      log(`Warmup complete: ${prototypeId}/${fixtureName}`);
    }

    for (let trialIndex = 1; trialIndex <= trialsPerFixture; trialIndex++) {
      for (const prototypeId of prototypes) {
        log(`Running trial ${trialIndex}/${BENCH_PROTOCOL.MEASURED_TRIALS_PER_FIXTURE}: ${prototypeId}/${fixtureName}`);
        const result = await runMeasuredTrial(driver, { prototypeId, fixtureName, trialIndex, cacheState: "warm" });
        writeResult(`${prototypeId}--${fixtureName}--trial${trialIndex}.json`, result);
        allTrials.push(result);
        log(
          `  medianFps=${result.orbit.medianFps.toFixed(1)} p95Frame=${result.orbit.p95FrameTimeMs.toFixed(1)}ms ` +
            `p95Pointer=${result.pointerLatency.p95LatencyMs.toFixed(1)}ms payload->interactive=${result.payloadToInteractiveMs.toFixed(0)}ms`,
        );
      }
    }
  }

  // ---- Stress fixture: run once per prototype, crash/blank only ----
  for (const prototypeId of prototypes) {
    await ensureBrowserAlive(`stress fixture (${prototypeId})`);
    log(`--- Stress fixture-1000/4000: ${prototypeId} ---`);
    const stress = await checkStressFixture(driver, page, prototypeId);
    stressResults.push(stress);
    log(`Stress result ${prototypeId}: crashedOrBlank=${stress.crashedOrBlank} detail=${stress.detail}`);
  }

  // ---- Navigation timing: 3 cold + 5 warm per prototype, fixture-120 ----
  for (const prototypeId of prototypes) {
    await ensureBrowserAlive(`navigation timing (${prototypeId})`);
    log(`--- Navigation timing: ${prototypeId}/${NAV_FIXTURE} ---`);
    await driver.navigate(prototypeId, NAV_FIXTURE, "warm");
    await driver.waitForPayloadReceived();
    await driver.waitForInteractive();
    const navResult = await runNavigationBenchmark(driver, { prototypeId, fixtureName: NAV_FIXTURE });
    writeResult(`${prototypeId}--navigation--${NAV_FIXTURE}.json`, navResult);
    navResults.push(navResult);
    log(`Navigation timing complete: ${prototypeId}`);
  }

  // ---- Lifecycle: 20x mount/unmount per prototype, fixture-24 ----
  for (const prototypeId of prototypes) {
    await ensureBrowserAlive(`lifecycle benchmark (${prototypeId})`);
    log(`--- Lifecycle 20x mount/unmount: ${prototypeId}/${LIFECYCLE_FIXTURE} ---`);
    driver.currentPrototypeId = prototypeId;
    driver.currentFixtureName = LIFECYCLE_FIXTURE;
    (driver as unknown as { lifecycleMounted: boolean }).lifecycleMounted = false;
    const lifecycleResult = await runLifecycleBenchmark(driver, { prototypeId, fixtureName: LIFECYCLE_FIXTURE });
    const trialResult: LifecycleTrialResult = {
      protocolVersion: "1.0.0",
      prototypeId,
      fixtureName: LIFECYCLE_FIXTURE,
      environment: {
        ...(await driver.captureEnvironment()),
        fixtureName: LIFECYCLE_FIXTURE,
        fixtureContentHash: await driver.getFixtureContentHash(LIFECYCLE_FIXTURE),
        rendererBuild: await driver.getRendererBuildLabel(prototypeId),
        cacheState: "warm",
      },
      lifecycle: lifecycleResult,
      recordedAtIso: new Date().toISOString(),
    };
    writeResult(`${prototypeId}--lifecycle--${LIFECYCLE_FIXTURE}.json`, trialResult);
    lifecycleResults.push(trialResult);
    const evalResult = evaluateLifecycle(lifecycleResult);
    log(`Lifecycle result ${prototypeId}: pass=${evalResult.pass} violations=${JSON.stringify(evalResult.violations)}`);
  }

  // ---- Summary aggregation ----
  const environment = allTrials[0]?.environment;
  const summary = {
    protocolVersion: "1.0.0",
    recordedAtIso: new Date().toISOString(),
    headedBrowserUsed: headedUsed,
    machineState: {
      preflightWaited: preflight.waited,
      finalLoadAvg: preflight.finalLoadAvg,
    },
    environmentSample: environment,
    floors: BENCH_FLOORS,
    perPrototype: prototypes.map((prototypeId) => {
      const fixtures = [...MANDATORY_FIXTURES, ...DIAGNOSTIC_ONLY_FIXTURES].map((fixtureName) => {
        const trials = allTrials.filter((t) => t.prototypeId === prototypeId && t.fixtureName === fixtureName);
        const stressTrial = stressResults.find((s) => s.prototypeId === prototypeId && s.fixtureName === fixtureName)?.trial;
        const effectiveTrials = trials.length > 0 ? trials : stressTrial ? [stressTrial] : [];
        const isMandatory = (MANDATORY_FIXTURES as readonly string[]).includes(fixtureName);

        if (effectiveTrials.length === 0) {
          const stress = stressResults.find((s) => s.prototypeId === prototypeId && s.fixtureName === fixtureName);
          return {
            fixtureName,
            isMandatory,
            trialCount: 0,
            crashedOrBlank: stress?.crashedOrBlank ?? null,
            detail: stress?.detail ?? "no trials recorded",
          };
        }

        const medianFpsValues = effectiveTrials.map((t) => t.orbit.medianFps);
        const p95FrameValues = effectiveTrials.map((t) => t.orbit.p95FrameTimeMs);
        const p95PointerValues = effectiveTrials.map((t) => t.pointerLatency.p95LatencyMs);
        const payloadToInteractiveValues = effectiveTrials.map((t) => t.payloadToInteractiveMs);

        const medianOfMedians = percentileOf(medianFpsValues, 50);
        const p95OfP95Frame = percentileOf(p95FrameValues, 95);
        const p95OfP95Pointer = percentileOf(p95PointerValues, 95);
        const p95PayloadToInteractive = percentileOf(payloadToInteractiveValues, 95);

        const floorChecks = effectiveTrials.map((t) => evaluateFloors(t, isMandatory));
        const allPass = floorChecks.every((f) => f.pass);
        const violations = [...new Set(floorChecks.flatMap((f) => f.violations))];

        return {
          fixtureName,
          isMandatory,
          trialCount: effectiveTrials.length,
          medianFps: medianOfMedians,
          p95FrameTimeMs: p95OfP95Frame,
          p95PointerLatencyMs: p95OfP95Pointer,
          p95PayloadToInteractiveMs: p95PayloadToInteractive,
          floorsPass: isMandatory ? allPass : "diagnostic-only",
          violations,
          crashedOrBlank: stressResults.find((s) => s.prototypeId === prototypeId && s.fixtureName === fixtureName)?.crashedOrBlank ?? false,
        };
      });

      const nav = navResults.find((n) => n.prototypeId === prototypeId);
      const coldNavs = nav?.navigations.filter((n) => n.kind === "cold") ?? [];
      const warmNavs = nav?.navigations.filter((n) => n.kind === "warm") ?? [];
      const coldInteractiveMs = coldNavs.map((n) => n.interactiveMs);
      const warmInteractiveMs = warmNavs.map((n) => n.interactiveMs);
      const p95Cold = percentileOf(coldInteractiveMs, 95);
      const p95Warm = percentileOf(warmInteractiveMs, 95);

      const lifecycle = lifecycleResults.find((l) => l.prototypeId === prototypeId);
      const lifecycleEval = lifecycle ? evaluateLifecycle(lifecycle.lifecycle) : null;

      return {
        prototypeId,
        fixtures,
        navigation: {
          coldTrialCount: coldNavs.length,
          warmTrialCount: warmNavs.length,
          p95ColdInteractiveMs: p95Cold,
          p95WarmInteractiveMs: p95Warm,
          coldFloorMs: BENCH_FLOORS.MAX_COLD_NAV_TO_INTERACTIVE_MS,
          warmFloorMs: BENCH_FLOORS.MAX_WARM_NAV_TO_INTERACTIVE_MS,
          coldPass: p95Cold <= BENCH_FLOORS.MAX_COLD_NAV_TO_INTERACTIVE_MS,
          warmPass: p95Warm <= BENCH_FLOORS.MAX_WARM_NAV_TO_INTERACTIVE_MS,
        },
        lifecycle: lifecycle
          ? {
              withinPlateauTolerance: lifecycle.lifecycle.withinPlateauTolerance,
              monotonicGrowthDetected: lifecycle.lifecycle.monotonicGrowthDetected,
              pass: lifecycleEval?.pass ?? false,
              violations: lifecycleEval?.violations ?? [],
              baseline: lifecycle.lifecycle.baseline,
              finalCycle: lifecycle.lifecycle.cycles[lifecycle.lifecycle.cycles.length - 1],
            }
          : null,
      };
    }),
  };

  writeResult("summary.json", summary);
  log("=== Measurement run complete. summary.json written. ===");
  console.log(JSON.stringify(summary, null, 2));
  }
}

// Explicit process.exit() on both paths: found live — a FATAL run (e.g.
// the stress-fixture browser crash documented above, before the recovery
// fix) left the node process alive indefinitely afterward (main().catch()
// only sets process.exitCode, it never calls exit()), presumably some
// dangling handle from the killed browser/child process kept the event
// loop alive. A silently-orphaned process from a prior failed run then
// competes for CPU/GPU and pollutes the next run's own preflight
// machine-load check — confirmed directly: a fresh DRY_RUN's preflight
// saw an inflated loadavg caused by exactly this kind of leftover.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
