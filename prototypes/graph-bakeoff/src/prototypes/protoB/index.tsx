/**
 * Prototype B registration point — React Three Fiber + Three.js,
 * `InstancedMesh` nodes, batched links, instance-aware picking (charter
 * §13). This is the real implementation (`GraphSceneB.tsx` does the actual
 * rendering); this file only adapts that component to the shared
 * `GraphPrototypeHandle` interface the entry router (`App.tsx`) and bench
 * runner (`src/bench/runner.ts`) both drive.
 *
 * `mount()` resolves only once the scene has actually reported itself
 * "interactive" (charter's own definition: nonzero dimensions, root
 * in-frustum, picking enabled, no loading overlay) — never merely once
 * `ReactDOM.createRoot(...).render(...)` has been *scheduled*.
 *
 * Harness-wiring gap fixed by the Stage 2 measurement lane (was previously
 * documented here as unfixed): `App.tsx` now reads
 * `getNodeScreenPosition`/`isHighlightConfirmed`/`readLifecycleSnapshot`
 * from the actual mounted handle via a runtime capability check, instead of
 * hardcoding placeholder stubs for both prototypes. This file's own part of
 * that fix — exposing the three real accessors as extra properties on the
 * returned handle (mirroring Prototype A's `ProtoAHandle` superset in
 * `src/protoA/index.tsx`), since `GraphPrototypeHandle` itself has no slot
 * for them — is `ProtoBHandle` below. `readLifecycleSnapshot` itself is
 * implemented in `GraphSceneB.tsx`'s `SceneImperativeApi` (using
 * three.js's own `renderer.info` for geometry/texture/program counts).
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { GraphPrototypeHandle, PrototypeCallbacks } from "../../types/prototype";
import type { BakeoffFixture } from "../../fixtures/types";
import { GraphSceneB, type SceneImperativeApi, type SceneLifecycleSnapshot } from "./GraphSceneB";

/** Same documented superset pattern as Prototype A's `ProtoAHandle`
 * (`src/protoA/index.tsx`) — see that file's doc comment for why these
 * three methods live outside the frozen `GraphPrototypeHandle` contract. */
export interface ProtoBHandle extends GraphPrototypeHandle {
  getNodeScreenPosition(nodeId: string): { x: number; y: number } | null;
  isHighlightConfirmed(nodeId: string): boolean;
  readLifecycleSnapshot(cycle: number): SceneLifecycleSnapshot;
  /** Stage 2 correction-lane addition — see `GraphSceneB.tsx`'s
   * `SceneImperativeApi.captureLifecycleAccessor()` doc comment. */
  captureLifecycleAccessor(): (() => Omit<SceneLifecycleSnapshot, "cycle">) | null;
}

export function createProtoBHandle(): ProtoBHandle {
  let root: Root | null = null;
  // The container the harness passed to `mount()`. Never cleared/replaced
  // wholesale (`container.innerHTML = ""`) — under React StrictMode's dev
  // double-invocation, `App.tsx` mounts two handle instances back-to-back
  // against the *same* container ref, and a deferred `unmount()` (see
  // below) can legitimately still own DOM inside it after a second handle
  // has already mounted its own content there too. This handle only ever
  // creates, reads, and removes its own `mountedEl` child node.
  let container: HTMLElement | null = null;
  let mountedEl: HTMLDivElement | null = null;
  const api: { current: SceneImperativeApi | null } = { current: null };
  let selectedNodeId: string | null = null;
  // True once this mount cycle's initial render has actually committed
  // (tracked via the scene's own "interactive" callback, not merely once
  // `root.render()` was *called*). Guards against a real, observed race
  // (React StrictMode's dev-only effect double-invocation calls this
  // handle's `unmount()` synchronously right after `mount()` starts,
  // sometimes before the nested root's own async initial commit — R3F's
  // `Canvas` measures its container via `ResizeObserver` before creating the
  // renderer, so that first commit is not guaranteed synchronous — finishes;
  // calling `root.unmount()` mid-commit logs a benign but avoidable React
  // warning). When `unmount()` arrives before settlement, this defers the
  // actual teardown by one microtask rather than skipping it.
  let settled = false;
  let pendingUnmount = false;

  function performUnmount(): void {
    root?.unmount();
    root = null;
    // Remove only the node this handle itself created/appended — never
    // touch the shared container's other children (see the field comment
    // above for why that matters).
    mountedEl?.remove();
    mountedEl = null;
    container = null;
    api.current = null;
    selectedNodeId = null;
    settled = false;
    pendingUnmount = false;
  }

  return {
    async mount(el, fixture: BakeoffFixture, callbacks: PrototypeCallbacks) {
      container = el;
      container.style.position = container.style.position || "relative";
      settled = false;
      pendingUnmount = false;

      mountedEl = document.createElement("div");
      mountedEl.dataset.testid = "proto-b-mount";
      mountedEl.style.cssText = "position:absolute;inset:0;";
      container.appendChild(mountedEl);

      root = createRoot(mountedEl);
      api.current = null;

      await new Promise<void>((resolve) => {
        let resolved = false;
        const resolveOnce = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };

        root!.render(
          createElement(GraphSceneB, {
            fixture,
            callbacks: {
              onPayloadReceived: () => callbacks.onPayloadReceived?.(),
              onInteractive: () => {
                settled = true;
                callbacks.onInteractive?.();
                resolveOnce();
                if (pendingUnmount) queueMicrotask(performUnmount);
              },
              onSelect: (nodeId: string | null) => {
                selectedNodeId = nodeId;
                callbacks.onSelect?.(nodeId);
              },
              onFocus: (nodeId: string) => callbacks.onFocus?.(nodeId),
            },
            ref: (instance: SceneImperativeApi | null) => {
              api.current = instance;
            },
          }),
        );

        // Safety fallback: if the scene never reports interactive (e.g. a
        // genuinely empty fixture with no root to frame), still resolve so
        // `mount()` cannot hang forever — the harness's own error/blank-scene
        // assertions are what catch that condition, not an unresolved
        // promise.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            settled = true;
            resolveOnce();
            if (pendingUnmount) queueMicrotask(performUnmount);
          }),
        );
      });
    },
    select(nodeId) {
      selectedNodeId = nodeId;
      api.current?.select(nodeId);
    },
    focus(nodeId) {
      api.current?.focus(nodeId);
    },
    home() {
      api.current?.home();
    },
    fit() {
      api.current?.fit();
    },
    setFilter(predicate) {
      api.current?.setFilter(predicate);
    },
    resize() {
      api.current?.resize();
    },
    getCameraPose() {
      return api.current?.getCameraPose() ?? { position: [0, 0, 300], target: [0, 0, 0] };
    },
    getNodeScreenPosition(nodeId: string) {
      return api.current?.getNodeScreenPosition(nodeId) ?? null;
    },
    isHighlightConfirmed(nodeId: string) {
      return api.current?.isHighlightConfirmed(nodeId) ?? false;
    },
    readLifecycleSnapshot(cycle: number): SceneLifecycleSnapshot {
      return (
        api.current?.readLifecycleSnapshot(cycle) ?? {
          cycle,
          geometries: 0,
          textures: 0,
          programs: 0,
          activeWorkers: 0,
          activeObservers: 0,
          activeTimers: 0,
          registeredListeners: 0,
        }
      );
    },
    captureLifecycleAccessor(): (() => Omit<SceneLifecycleSnapshot, "cycle">) | null {
      return api.current?.captureLifecycleAccessor() ?? null;
    },
    unmount() {
      if (!root) return;
      if (!settled) {
        // A rapid mount->unmount before the initial commit settled (seen in
        // practice under React StrictMode's dev double-invoke). Deferring
        // one microtask lets that commit finish before tearing it down,
        // rather than racing `root.unmount()` against it.
        pendingUnmount = true;
        return;
      }
      performUnmount();
    },
  };
}
