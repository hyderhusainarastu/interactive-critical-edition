/**
 * The window-level contract a mounted prototype registers itself under, so
 * the Playwright-side bench runner (src/bench/runner.ts, e2e/bench.spec.ts)
 * can drive Prototype A and Prototype B identically without importing
 * either implementation directly (Playwright talks to the page over CDP,
 * not via module imports).
 *
 * `App.tsx` calls `registerHarnessBridge()` once its chosen prototype's
 * `mount()` promise resolves; the bench driver polls for
 * `window.__graphBakeoffHarness` via `page.waitForFunction`.
 */

import type { GraphPrototypeHandle } from "../types/prototype";
import type { LifecycleSnapshot } from "./types";

export const HARNESS_BRIDGE_KEY = "__graphBakeoffHarness" as const;

export interface HarnessBridge {
  ready: boolean;
  prototypeId: "a" | "b";
  fixtureName: string;
  fixtureContentHash: string;
  handle: GraphPrototypeHandle;
  /** Screen-space position of a mounted node's on-screen highlight target,
   * for the bench's deterministic pointer-move sampling. Returns null if
   * the node isn't currently visible/rendered. */
  getNodeScreenPosition(nodeId: string): { x: number; y: number } | null;
  /** True once the renderer has confirmed a visual highlight change for
   * the most recently selected/hovered node — used to timestamp
   * "highlight confirmed" for pointer-latency sampling. */
  isHighlightConfirmed(nodeId: string): boolean;
  /** Reads renderer.info-equivalent counts plus active worker/observer/
   * timer/listener counts, for the mount/unmount lifecycle-leak check
   * (charter §13 step 9). Renderer-specific; Prototype A/B each implement
   * their own accessor consistent with this shape. */
  readLifecycleSnapshot(cycle: number): LifecycleSnapshot;
  /** Timestamp (performance.now()-relative) recorded the instant this
   * prototype instance considered its payload fully received. */
  payloadReceivedAtMs: number | null;
  /** Timestamp recorded the instant this prototype instance met the
   * charter's "interactive" definition (§13 step 3). */
  interactiveAtMs: number | null;
}

declare global {
  interface Window {
    [HARNESS_BRIDGE_KEY]?: HarnessBridge;
  }
}

export function registerHarnessBridge(bridge: HarnessBridge): void {
  window[HARNESS_BRIDGE_KEY] = bridge;
}

export function clearHarnessBridge(): void {
  delete window[HARNESS_BRIDGE_KEY];
}

export function readHarnessBridge(): HarnessBridge | undefined {
  return window[HARNESS_BRIDGE_KEY];
}
