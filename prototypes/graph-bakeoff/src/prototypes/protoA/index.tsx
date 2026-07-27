/**
 * Prototype A registration point — clean `react-force-graph-3d` (charter
 * §13). THIS FILE IS SCAFFOLDING ONLY, not the real Prototype A.
 *
 * Building the actual react-force-graph-3d prototype (default/shared
 * low-poly nodes, target-aware camera, capped screen-space labels, real
 * picking/selection/focus/filters/resize/remount) is explicitly out of
 * scope for this harness-building pass (orchestrator instruction: "Do NOT
 * build the prototypes themselves"). What's here exists only so:
 *   - `App.tsx`'s `?proto=a` route has something real to mount that
 *     satisfies `GraphPrototypeHandle` and registers the harness bridge,
 *     proving the router/interface/bridge wiring end to end.
 *   - A future implementation lane can replace this file's body without
 *     touching the router, fixtures, camera math, or bench runner.
 */
import type { GraphPrototypeHandle, PrototypeCallbacks } from "../../types/prototype";
import type { BakeoffFixture } from "../../fixtures/types";
import { computeHomePose } from "../../camera/cameraMath";

export function createProtoAHandle(): GraphPrototypeHandle {
  let container: HTMLElement | null = null;
  let currentFixture: BakeoffFixture | null = null;
  let selectedNodeId: string | null = null;
  let pose = { position: [0, 0, 300] as readonly [number, number, number], target: [0, 0, 0] as readonly [number, number, number] };

  return {
    async mount(el, fixture, callbacks: PrototypeCallbacks) {
      container = el;
      currentFixture = fixture;
      container.innerHTML = "";
      const placeholder = document.createElement("div");
      placeholder.setAttribute("data-testid", "proto-a-placeholder");
      placeholder.style.cssText =
        "color:#A7B6C2;font-family:sans-serif;padding:24px;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;";
      placeholder.textContent = `Prototype A (react-force-graph-3d) not yet implemented — harness-only scaffold. Fixture: ${fixture.name} (${fixture.nodeCount} nodes, ${fixture.linkCount} links).`;
      container.appendChild(placeholder);

      const rect = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      const measured = el.getBoundingClientRect();
      Object.assign(rect, { width: measured.width, height: measured.height });

      const home = computeHomePose({
        boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
        viewportWidth: Math.max(1, rect.width),
        viewportHeight: Math.max(1, rect.height),
        verticalFovDeg: 50,
      });
      pose = { position: home.position, target: home.target };

      callbacks.onPayloadReceived?.();
      callbacks.onInteractive?.();
    },
    select(nodeId) {
      selectedNodeId = nodeId;
    },
    focus(_nodeId) {
      // Not implemented — scaffold only.
    },
    home() {
      // Not implemented — scaffold only.
    },
    fit() {
      // Not implemented — scaffold only.
    },
    setFilter(_predicate) {
      // Not implemented — scaffold only.
    },
    resize() {
      // Not implemented — scaffold only.
    },
    getCameraPose() {
      return pose;
    },
    unmount() {
      if (container) container.innerHTML = "";
      container = null;
      currentFixture = null;
      selectedNodeId = null;
    },
  };
}
