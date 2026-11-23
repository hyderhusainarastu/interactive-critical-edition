/**
 * Node Object3D construction for Prototype A — charter §10 ("Node geometry
 * and color", "State"). At most six base silhouettes (sphere, icosahedron,
 * capsule, slab, octahedron, hexagonal prism); geometries/materials are
 * cached per mounted-scene instance (see `NodeVisualFactory`) so a dense
 * fixture's many same-kind nodes share GPU resources, and everything this
 * factory allocates is disposed together in one `dispose()` call on
 * unmount (charter §14).
 */
import * as THREE from "three";
import type { DisplayKind, FixtureNode } from "../fixtures/types";
import { KIND_VISUALS, UNAVAILABLE_WIREFRAME_COLOR } from "./theme";

const BASE_RADIUS = 4;
const LOW_POLY_SPHERE_SEGMENTS = 12;
const LOW_POLY_SPHERE_RINGS = 8;

/**
 * `object`'s children always include a transparent, oversized invisible
 * picking-volume sphere (charter §10: "Use a larger invisible picking
 * volume so touch selection remains reliable; it must not change the
 * visible geometry") — react-force-graph-3d raycasts against whatever
 * geometry is present under the returned Object3D, so this is a plain
 * extra child, not a separate API.
 */
export interface NodeVisual {
  object: THREE.Object3D;
  setSelected(selected: boolean): void;
  setHovered(hovered: boolean): void;
}

function silhouetteGeometry(kind: DisplayKind, radius: number): THREE.BufferGeometry {
  const visual = KIND_VISUALS[kind];
  switch (visual.silhouette) {
    case "sphere":
      return new THREE.SphereGeometry(radius, LOW_POLY_SPHERE_SEGMENTS, LOW_POLY_SPHERE_RINGS);
    case "icosahedron":
      return new THREE.IcosahedronGeometry(radius, 0);
    case "capsule":
      return new THREE.CapsuleGeometry(radius * 0.45, radius * 1.1, 4, 8);
    case "slab":
      return new THREE.BoxGeometry(radius * 1.7, radius * 0.28, radius * 1.25);
    case "octahedron":
      return new THREE.OctahedronGeometry(radius, 0);
    case "hexPrism":
      return new THREE.CylinderGeometry(radius, radius, radius * 0.6, 6);
  }
}

/** Caches geometries/materials for exactly one mounted scene (see this
 * file's top comment for why the cache is instance-scoped, not a module
 * singleton). Every geometry/material it creates is tracked and disposed
 * together by `dispose()`. */
export class NodeVisualFactory {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private ringGeometry: THREE.BufferGeometry | null = null;
  private disposed = false;

  private getGeometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geometries.get(key);
    if (!g) {
      g = build();
      this.geometries.set(key, g);
    }
    return g;
  }

  private getMaterial(key: string, build: () => THREE.Material): THREE.Material {
    let m = this.materials.get(key);
    if (!m) {
      m = build();
      this.materials.set(key, m);
    }
    return m;
  }

  private getRingGeometry(): THREE.BufferGeometry {
    if (!this.ringGeometry) {
      this.ringGeometry = new THREE.TorusGeometry(1, 0.06, 8, 24);
    }
    return this.ringGeometry;
  }

  private accessoryMesh(kind: DisplayKind, radius: number): THREE.Object3D | null {
    const visual = KIND_VISUALS[kind];
    if (!visual.accessory) return null;
    const color = visual.accessoryColor ?? visual.color;
    const geom = this.getGeometry(`accessory:${visual.accessory}`, () => new THREE.TorusGeometry(1, 0.045, 8, 24));
    const mat = this.getMaterial(`accessory:${color}`, () => new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 }));
    const mesh = new THREE.Mesh(geom, mat);
    switch (visual.accessory) {
      case "equatorial-ring":
        mesh.scale.setScalar(radius * 1.18);
        break;
      case "double-band": {
        // Two bands, tilted oppositely, to visually distinguish from a
        // single equatorial ring per charter's "green double band".
        const group = new THREE.Group();
        const bandA = mesh;
        bandA.scale.setScalar(radius * 1.12);
        bandA.rotation.x = Math.PI / 5;
        const bandB = new THREE.Mesh(geom, mat);
        bandB.scale.setScalar(radius * 1.12);
        bandB.rotation.x = -Math.PI / 5;
        group.add(bandA, bandB);
        return group;
      }
      case "single-band":
        mesh.scale.setScalar(radius * 1.12);
        mesh.rotation.x = Math.PI / 2.4;
        break;
      case "orbital-ring":
        mesh.scale.setScalar(radius * 1.35);
        mesh.rotation.x = Math.PI / 2;
        break;
    }
    return mesh;
  }

  /** Builds one node's full visual: main mesh + accessory + (initially
   * hidden) selection/hover rings + an oversized invisible picking volume,
   * all as children of one Group so react-force-graph-3d can position/scale
   * the whole thing as a single Object3D. */
  build(node: Pick<FixtureNode, "displayKind" | "unavailableReason">): NodeVisual {
    const visual = KIND_VISUALS[node.displayKind];
    const radius = BASE_RADIUS * visual.relativeRadius;
    const group = new THREE.Group();

    const geometry = this.getGeometry(`${node.displayKind}:${radius}`, () => silhouetteGeometry(node.displayKind, radius));
    const isUnavailable = node.unavailableReason !== null;
    const mainMaterial = isUnavailable
      ? this.getMaterial("unavailable-wireframe", () => new THREE.MeshBasicMaterial({ color: UNAVAILABLE_WIREFRAME_COLOR, wireframe: true }))
      : this.getMaterial(`solid:${node.displayKind}`, () => new THREE.MeshLambertMaterial({ color: visual.color }));

    const mainMesh = new THREE.Mesh(geometry, mainMaterial);
    group.add(mainMesh);

    const accessory = this.accessoryMesh(node.displayKind, radius);
    if (accessory) group.add(accessory);

    // Selection ring (bone inner + gold outer) and hover ring (thin bone),
    // hidden by default — cheap to keep resident and just toggle .visible
    // rather than allocate on every selection change.
    const ringGeom = this.getRingGeometry();
    const selectionInnerMat = this.getMaterial("selection-inner", () => new THREE.MeshBasicMaterial({ color: "#FDF8EE" }));
    const selectionOuterMat = this.getMaterial("selection-outer", () => new THREE.MeshBasicMaterial({ color: "#F0C47C" }));
    const hoverMat = this.getMaterial("hover-ring", () => new THREE.MeshBasicMaterial({ color: "#FDF8EE", transparent: true, opacity: 0.6 }));

    const selectionInner = new THREE.Mesh(ringGeom, selectionInnerMat);
    selectionInner.scale.setScalar(radius * 1.5);
    selectionInner.rotation.x = Math.PI / 2;
    selectionInner.visible = false;

    const selectionOuter = new THREE.Mesh(ringGeom, selectionOuterMat);
    selectionOuter.scale.setScalar(radius * 1.75);
    selectionOuter.rotation.x = Math.PI / 2;
    selectionOuter.visible = false;

    const hoverRing = new THREE.Mesh(ringGeom, hoverMat);
    hoverRing.scale.setScalar(radius * 1.55);
    hoverRing.rotation.x = Math.PI / 2;
    hoverRing.visible = false;

    group.add(selectionInner, selectionOuter, hoverRing);

    // Larger invisible picking volume (charter: reliable touch selection
    // without changing the visible geometry).
    const pickGeom = this.getGeometry("pick-sphere-unit", () => new THREE.SphereGeometry(1, 8, 6));
    const pickMat = this.getMaterial("pick-invisible", () => new THREE.MeshBasicMaterial({ visible: false }));
    const pickMesh = new THREE.Mesh(pickGeom, pickMat);
    pickMesh.scale.setScalar(radius * 2.2);
    group.add(pickMesh);

    return {
      object: group,
      setSelected(selected: boolean) {
        selectionInner.visible = selected;
        selectionOuter.visible = selected;
      },
      setHovered(hovered: boolean) {
        hoverRing.visible = hovered;
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.ringGeometry?.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.ringGeometry = null;
  }
}
