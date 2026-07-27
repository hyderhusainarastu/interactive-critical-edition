/**
 * Shared prototype interface (charter §5 / rebuild prompt §13).
 *
 * Both Prototype A (clean react-force-graph-3d) and Prototype B (React Three
 * Fiber + InstancedMesh) implement this exact surface so the bench runner
 * (src/bench/runner.ts) can drive either one identically, and so neither
 * prototype's internals leak into the benchmark or the entry-page router.
 *
 * This file intentionally contains no rendering logic — it is the contract,
 * not an implementation. Building Prototype A/B is explicitly out of scope
 * for this harness-building pass.
 */

import type { BakeoffFixture, FixtureNode } from "../fixtures/types";

/** A predicate used by `setFilter` to hide/show nodes without remounting. */
export type NodeFilterPredicate = (node: FixtureNode) => boolean;

/** Lifecycle/interaction callbacks the harness listens to. */
export interface PrototypeCallbacks {
  /** Fired once the fixture/payload the prototype needs is fully available
   * to it (charter bakeoff step 2, "payload-received"). */
  onPayloadReceived?: () => void;
  /** Fired on the first frame where the renderer has nonzero dimensions,
   * the root node is in-frustum, picking is enabled, and no loading
   * overlay blocks input (charter bakeoff step 3, "interactive"). */
  onInteractive?: () => void;
  /** Fired whenever a node is selected (click/tap or programmatic `select`). */
  onSelect?: (nodeId: string | null) => void;
  /** Fired whenever a node is focused (camera moved to it). */
  onFocus?: (nodeId: string) => void;
  /** Fired on every rendered frame; used by the bench runner to sample
   * `requestAnimationFrame` intervals during the scripted orbit. Must not
   * allocate or trigger React state updates on the hot path. */
  onFrame?: (timestampMs: number) => void;
  /** Fired when a WebGL context is lost. */
  onContextLost?: () => void;
  /** Fired when a WebGL context is restored. */
  onContextRestored?: () => void;
}

/** Camera pose the harness can both read and command, expressed in the
 * same coordinate convention as `src/camera/cameraMath.ts` (Z-up, world
 * units, not renderer-internal Y-up). */
export interface CameraPose {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

/**
 * The interface every renderer prototype must implement. The bench runner
 * (src/bench/runner.ts) calls these methods through a thin Playwright/DOM
 * bridge (see `src/bench/harnessBridge.ts`) — see that file for the exact
 * `window`-level hook prototypes must register under.
 */
export interface GraphPrototypeHandle {
  /** Mount the renderer into `container`, rendering `fixture`. Must resolve
   * only after the scene is actually attached (not merely scheduled). */
  mount(
    container: HTMLElement,
    fixture: BakeoffFixture,
    callbacks: PrototypeCallbacks,
  ): Promise<void>;

  /** Select a node by id without moving the camera (single click/tap
   * semantics, charter §11 "Focus"). Passing `null` clears selection. */
  select(nodeId: string | null): void;

  /** Move the camera to frame `nodeId` per the shared camera-math focus
   * contract (charter §11). Must not remount the renderer. */
  focus(nodeId: string): void;

  /** Return to the canonical home pose (charter §11). */
  home(): void;

  /** Fit the camera to the current visible render bounds. */
  fit(): void;

  /** Apply a node-visibility filter without remounting or losing camera
   * state (charter §14, "No renderer remount for ... ordinary filter
   * changes"). */
  setFilter(predicate: NodeFilterPredicate | null): void;

  /** Notify the prototype that its container's measured size changed. */
  resize(): void;

  /** Read the current camera pose (for camera/frustum assertions). */
  getCameraPose(): CameraPose;

  /** Tear down the renderer, controls, listeners, observers, timers, and
   * workers completely (charter §14 lifecycle-cleanup requirement). Must be
   * safe to call unmount without ever having called mount fully (race
   * cancellation). */
  unmount(): void;
}

/** A prototype module's public factory — one instance per mount. */
export type GraphPrototypeFactory = () => GraphPrototypeHandle;

/** The two prototype ids the entry page and bench runner both understand. */
export type PrototypeId = "a" | "b";
