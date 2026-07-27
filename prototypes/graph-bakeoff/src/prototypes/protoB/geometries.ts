/**
 * Shared geometry factory for Prototype B's six base silhouettes (charter
 * §10/§13: "InstancedMesh per repeated silhouette (six max)"). One
 * `THREE.BufferGeometry` instance is built per silhouette and reused across
 * every node of that silhouette via `InstancedMesh` — never one geometry per
 * node (charter §14: "Share geometries, materials, textures, and label
 * resources").
 *
 * A base unit size of 1 world-unit radius/half-extent is used for every
 * geometry; the actual on-screen size comes entirely from each instance's
 * per-instance transform matrix (`computeNodeScale`, applied as a uniform
 * scale), never from rebuilding geometry at a different size.
 */
import * as THREE from "three";
import type { SilhouetteKey } from "./visuals";

// A dimensionless unit size (1 world unit) — the *actual* on-screen node
// size comes from multiplying this by a scene-computed `worldNodeUnit`
// (derived from the fixture's own layout bounding-sphere radius, see
// `GraphSceneB.tsx`) and each node's `computeNodeScale()` factor. Baking a
// fixed absolute size here (independent of a given fixture's physical
// layout scale) was tried first and produced sub-pixel, effectively
// invisible nodes on denser/larger-spread fixtures — charter §10's "tune
// world dimensions so ordinary nodes project to roughly 10-24px" requires
// sizing relative to the actual framed scene, not a fixture-independent
// constant.
const BASE_UNIT = 1;

function buildGeometry(key: SilhouetteKey): THREE.BufferGeometry {
  switch (key) {
    case "sphere":
      return new THREE.SphereGeometry(BASE_UNIT, 16, 12);
    case "icosahedron":
      return new THREE.IcosahedronGeometry(BASE_UNIT, 0);
    case "capsule":
      return new THREE.CapsuleGeometry(BASE_UNIT * 0.55, BASE_UNIT * 1.4, 4, 8);
    case "slab":
      return new THREE.BoxGeometry(BASE_UNIT * 1.6, BASE_UNIT * 1.6, BASE_UNIT * 0.35);
    case "octahedron":
      return new THREE.OctahedronGeometry(BASE_UNIT, 0);
    case "hexPrism":
      return new THREE.CylinderGeometry(BASE_UNIT, BASE_UNIT, BASE_UNIT * 0.9, 6);
    default: {
      const exhaustive: never = key;
      throw new Error(`Unhandled silhouette key: ${String(exhaustive)}`);
    }
  }
}

/** One shared, disposable geometry per silhouette. Built once per mount by
 * the scene component and disposed on teardown — never rebuilt per node or
 * per frame. */
export function buildSilhouetteGeometries(): Record<SilhouetteKey, THREE.BufferGeometry> {
  return {
    sphere: buildGeometry("sphere"),
    icosahedron: buildGeometry("icosahedron"),
    capsule: buildGeometry("capsule"),
    slab: buildGeometry("slab"),
    octahedron: buildGeometry("octahedron"),
    hexPrism: buildGeometry("hexPrism"),
  };
}

/** A single shared thin torus/ring geometry reused for every ring accent
 * (gold equatorial ring, green double band, umber single band, burgundy
 * orbital ring) — differentiated by color/instance transform, not a
 * separate geometry per accent kind, keeping the six-silhouette cap intact
 * (rings are an accessory decoration layered on the base silhouette, not a
 * seventh entity silhouette — see visuals.ts's doc comment). */
export function buildRingGeometry(): THREE.TorusGeometry {
  return new THREE.TorusGeometry(BASE_UNIT * 1.15, BASE_UNIT * 0.06, 8, 24);
}

/** Selection/hover ring geometry, slightly larger than the accent ring so
 * both can coexist without z-fighting. */
export function buildStateRingGeometry(): THREE.TorusGeometry {
  return new THREE.TorusGeometry(BASE_UNIT * 1.4, BASE_UNIT * 0.05, 8, 24);
}

export function disposeGeometries(geometries: Record<string, THREE.BufferGeometry>): void {
  for (const geometry of Object.values(geometries)) {
    geometry.dispose();
  }
}
