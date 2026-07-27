/**
 * Prototype A — clean `react-force-graph-3d@1.29.1` (charter §13 Prototype
 * A / rebuild prompt §13). Implements the harness's `GraphPrototypeHandle`
 * (src/types/prototype.ts) by mounting a small, self-contained React root
 * around `GraphScene` (see GraphScene.tsx for the actual scene logic —
 * this file is just the imperative adapter between that component and the
 * `mount/select/focus/home/fit/setFilter/resize/getCameraPose/unmount`
 * surface the bench harness and `App.tsx`'s router drive).
 *
 * Race-safety note (charter/interface requirement: "Must be safe to call
 * unmount without ever having called mount fully"): every method here
 * checks `disposed` first, and `mount()`'s async continuation re-checks it
 * after each await, so a `mount()` that's still in flight when `unmount()`
 * is called tears down cleanly without resurrecting anything. This matters
 * in practice, not just in theory — `main.tsx` renders `<StrictMode>`,
 * which double-invokes `App.tsx`'s effect (and therefore this handle's
 * mount/unmount) once per real mount in dev.
 */
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { GraphPrototypeHandle, NodeFilterPredicate, PrototypeCallbacks } from "../types/prototype";
import type { CameraPose } from "../types/prototype";
import type { BakeoffFixture } from "../fixtures/types";
import { GraphScene, type GraphSceneApi } from "./GraphScene";
import type { LifecycleSnapshotLike } from "./lifecycle";

const IDLE_CAMERA_POSE: CameraPose = { position: [0, 0, 300], target: [0, 0, 0] };

const EMPTY_LIFECYCLE_SNAPSHOT: Omit<LifecycleSnapshotLike, "cycle"> = {
  geometries: 0,
  textures: 0,
  programs: 0,
  activeWorkers: 0,
  activeObservers: 0,
  activeTimers: 0,
  registeredListeners: 0,
};

/**
 * `GraphPrototypeHandle` (the frozen shared interface) has no slot for the
 * bench's `getNodeScreenPosition`/`isHighlightConfirmed`/
 * `readLifecycleSnapshot` — those three live only on `HarnessBridge`
 * (`src/bench/harnessBridge.ts`), which `App.tsx` constructs itself with
 * hardcoded stubs (`() => null` / `() => false` / an all-zero snapshot),
 * commented "wired by the real prototype implementation" but with no
 * actual wiring path from a `GraphPrototypeHandle` to that bridge object.
 * That's a real gap in the shared harness, not something a single
 * prototype lane can close without editing `App.tsx` — flagged in this
 * lane's return notes rather than silently patched here.
 *
 * The most useful thing this file can do without touching `App.tsx` is
 * make the real implementations available as extra properties on the
 * returned handle, so whichever lane eventually wires the bridge (or a
 * corrected `App.tsx`) has real logic to call instead of writing it from
 * scratch. `ProtoAHandle` documents that superset explicitly rather than
 * relying on silent structural excess.
 */
export interface ProtoAHandle extends GraphPrototypeHandle {
  getNodeScreenPosition(nodeId: string): { x: number; y: number } | null;
  isHighlightConfirmed(nodeId: string): boolean;
  readLifecycleSnapshot(cycle: number): LifecycleSnapshotLike;
}

export function createProtoAHandle(): ProtoAHandle {
  let root: Root | null = null;
  let apiRef: { current: GraphSceneApi | null } = { current: null };
  let disposed = false;
  let pendingFilter: NodeFilterPredicate | null = null;
  let pendingSelection: string | null = null;

  return {
    async mount(container, fixture: BakeoffFixture, callbacks: PrototypeCallbacks): Promise<void> {
      if (disposed) return; // torn down before mount ever started (race)

      root = createRoot(container);
      apiRef = { current: null };

      await new Promise<void>((resolve) => {
        let resolved = false;
        const handleReady = (api: GraphSceneApi) => {
          apiRef.current = api;
          // Replay any select()/setFilter() calls the outer handle received
          // while mount() was still in flight.
          if (pendingFilter) api.setFilter(pendingFilter);
          if (pendingSelection) api.select(pendingSelection);
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };

        if (disposed || !root) {
          resolve();
          return;
        }

        root.render(
          createElement(GraphScene, {
            fixture,
            callbacks: {
              ...callbacks,
              // Deferred one macrotask: `App.tsx` only calls
              // `registerHarnessBridge()` in the `.then()` that follows
              // this very `mount()` call resolving, so calling
              // `onInteractive` synchronously here — before `mount()` has
              // even returned — would find `window.__graphBakeoffHarness`
              // still undefined and silently drop the timestamp write. A
              // `setTimeout(0)` always fires after that microtask chain
              // (mount()'s own promise settling, then App.tsx's `.then()`)
              // has drained, so the bridge is guaranteed to exist by then.
              onInteractive: () => {
                if (disposed) return;
                setTimeout(() => {
                  if (!disposed) callbacks.onInteractive?.();
                }, 0);
              },
            },
            onReady: handleReady,
            apiRef,
          }),
        );
      });

      // Same bridge-not-registered-yet race as `onInteractive` above
      // applies here too — deferred for the same reason.
      setTimeout(() => {
        if (!disposed) callbacks.onPayloadReceived?.();
      }, 0);
    },

    select(nodeId: string | null) {
      if (disposed) return;
      if (apiRef.current) {
        apiRef.current.select(nodeId);
      } else {
        pendingSelection = nodeId;
      }
    },

    focus(nodeId: string) {
      if (disposed) return;
      apiRef.current?.focus(nodeId);
    },

    home() {
      if (disposed) return;
      apiRef.current?.home();
    },

    fit() {
      if (disposed) return;
      apiRef.current?.fit();
    },

    setFilter(predicate: NodeFilterPredicate | null) {
      if (disposed) return;
      if (apiRef.current) {
        apiRef.current.setFilter(predicate);
      } else {
        pendingFilter = predicate;
      }
    },

    resize() {
      if (disposed) return;
      apiRef.current?.resize();
    },

    getCameraPose(): CameraPose {
      return apiRef.current?.getCameraPose() ?? IDLE_CAMERA_POSE;
    },

    getNodeScreenPosition(nodeId: string) {
      return apiRef.current?.getNodeScreenPosition(nodeId) ?? null;
    },

    isHighlightConfirmed(nodeId: string) {
      return apiRef.current?.isHighlightConfirmed(nodeId) ?? false;
    },

    readLifecycleSnapshot(cycle: number): LifecycleSnapshotLike {
      return apiRef.current?.readLifecycleSnapshot(cycle) ?? { cycle, ...EMPTY_LIFECYCLE_SNAPSHOT };
    },

    unmount() {
      if (disposed) return;
      disposed = true;
      root?.unmount();
      root = null;
      apiRef.current = null;
    },
  };
}
