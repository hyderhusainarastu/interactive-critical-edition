/**
 * Prototype B registration point — React Three Fiber + Three.js,
 * `InstancedMesh` nodes, batched links, instance-aware picking (charter
 * §13). THIS FILE IS SCAFFOLDING ONLY, not the real Prototype B.
 *
 * Same status as `../protoA/index.tsx`: building the actual R3F/Three
 * implementation is explicitly out of scope for this harness-building
 * pass. `@react-three/fiber` and `three` are already installed as isolated
 * prototype-only dependencies (never added to the main app's
 * package.json) so a future lane can build the real thing here without
 * touching dependency wiring.
 */
import type { GraphPrototypeHandle, PrototypeCallbacks } from "../../types/prototype";
import type { BakeoffFixture } from "../../fixtures/types";
import { computeHomePose } from "../../camera/cameraMath";

export function createProtoBHandle(): GraphPrototypeHandle {
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
      placeholder.setAttribute("data-testid", "proto-b-placeholder");
      placeholder.style.cssText =
        "color:#A7B6C2;font-family:sans-serif;padding:24px;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;";
      placeholder.textContent = `Prototype B (React Three Fiber + InstancedMesh) not yet implemented — harness-only scaffold. Fixture: ${fixture.name} (${fixture.nodeCount} nodes, ${fixture.linkCount} links).`;
      container.appendChild(placeholder);

      const measured = el.getBoundingClientRect();
      const home = computeHomePose({
        boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
        viewportWidth: Math.max(1, measured.width),
        viewportHeight: Math.max(1, measured.height),
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
