/**
 * Instance-aware ray picking for Prototype B (charter §13: "instance-aware
 * raycast picking (instanceId -> node id)").
 *
 * Each silhouette's `InstancedMesh` carries a parallel `instanceId -> nodeId`
 * array in `mesh.userData.nodeIdsByInstance`. Picking casts one ray against
 * every visible-silhouette mesh, takes the nearest intersection across all
 * of them (not just the first mesh checked), and resolves it back to a
 * stable fixture node id. A larger invisible picking radius than the visible
 * geometry is achieved by intersecting against the same "hit" mesh at a
 * bigger scale (`buildPickingGeometries`), never by changing the visible
 * mesh's own geometry (charter §10: "larger invisible picking volume ... must
 * not change the visible geometry").
 */
import * as THREE from "three";

export interface PickableMesh {
  mesh: THREE.InstancedMesh;
  nodeIdsByInstance: readonly string[];
}

export interface PickResult {
  nodeId: string;
  distance: number;
  instanceId: number;
}

const raycaster = new THREE.Raycaster();
// Slightly generous threshold helps picking against thin line-derived
// silhouettes; the InstancedMesh geometry itself is already the primary
// forgiving picking volume (see buildPickingGeometries).
raycaster.params.Line = { threshold: 2 };

/**
 * Casts from `camera` through normalized device coordinates `ndc` (each in
 * [-1, 1]) against every entry in `meshes`, returning the nearest hit's
 * resolved node id, or `null` if nothing was hit.
 */
const ndcVector = new THREE.Vector2();

export function pickNodeAt(
  ndc: { x: number; y: number },
  camera: THREE.Camera,
  meshes: readonly PickableMesh[],
): PickResult | null {
  ndcVector.set(ndc.x, ndc.y);
  raycaster.setFromCamera(ndcVector, camera);

  let best: PickResult | null = null;
  for (const { mesh, nodeIdsByInstance } of meshes) {
    const hits = raycaster.intersectObject(mesh, false);
    for (const hit of hits) {
      if (hit.instanceId === undefined || hit.instanceId === null) continue;
      const nodeId = nodeIdsByInstance[hit.instanceId];
      if (nodeId === undefined) continue;
      if (best === null || hit.distance < best.distance) {
        best = { nodeId, distance: hit.distance, instanceId: hit.instanceId };
      }
    }
  }
  return best;
}

/** Converts a pointer event's client coordinates plus the canvas's bounding
 * rect into normalized device coordinates for `pickNodeAt`. */
export function clientToNdc(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    y: -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
  };
}
