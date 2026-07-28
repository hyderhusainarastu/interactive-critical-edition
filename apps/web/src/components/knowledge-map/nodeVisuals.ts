/**
 * Node Object3D construction — charter §10 ("Node geometry and color",
 * "State", "Credibility"). At most six base silhouettes (sphere,
 * icosahedron, capsule, slab, octahedron, hexagonal prism); geometries/
 * materials are cached per mounted-scene instance (`NodeVisualFactory`) so
 * a dense selection's many same-kind nodes share GPU resources, and
 * everything this factory allocates is disposed together in one
 * `dispose()` call on unmount (charter §14).
 *
 * Ported from `prototypes/graph-bakeoff/src/protoA/nodeVisuals.ts` per
 * spec §1.1, extended with the charter §10 treatments the bakeoff didn't
 * model (its fixtures carried no reading-state/credibility data):
 *   - Reading state: a small lower progress arc (`READING_STATE_ARC_*`).
 *   - Structural/display-only nodes: lower-saturation material
 *     (`desaturate()`/`isStructuralOrDisplayOnly()` from `./theme`).
 *   - Credibility: a six-segment ring, built ONLY lazily on first
 *     selection (never eagerly for every node — see `setSelected`'s doc
 *     comment) and shown only while selected, per charter §10 "Show the
 *     six separate credibility dimensions as a segmented ring only for
 *     selection/close focus."
 */
import * as THREE from "three";
import type { DisplayKind, DisplaySourceEntity } from "@ice/graph-display";
import type { CredibilityDimension, NodeType } from "../graph/types";
import { CREDIBILITY_DIMENSIONS } from "../graph/types";
import {
  CREDIBILITY_RING_LIT_COLOR,
  CREDIBILITY_RING_NOT_ASSESSED_COLOR,
  CREDIBILITY_RING_SEGMENT_COUNT,
  desaturate,
  DIMMED_NODE_OPACITY,
  HOVER_RING_COLOR,
  isStructuralOrDisplayOnly,
  KIND_VISUALS,
  READING_STATE_ARC_COLOR,
  READING_STATE_ARC_SWEEP_DEG,
  SELECTION_INNER_RING_COLOR,
  SELECTION_OUTER_RING_COLOR,
  UNAVAILABLE_WIREFRAME_COLOR,
} from "./theme";

type KMDisplayKind = DisplayKind<NodeType>;

const BASE_RADIUS = 4;
const LOW_POLY_SPHERE_SEGMENTS = 12;
const LOW_POLY_SPHERE_RINGS = 8;

/** Credibility scores (0-1, or `null` = "not assessed" for that dimension —
 *  charter §10 "Missing credibility data is 'not assessed,' never zero")
 *  keyed by the same `CREDIBILITY_DIMENSIONS` vocabulary
 *  `../graph/types` already defines, so a caller building this
 *  from a real `GraphNode.credibility` object needs no remapping. */
export type CredibilityRingInput = Record<CredibilityDimension, number | null>;

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
  /** `credibility` is read only the first time `selected` is `true` for
   *  this node — see the doc comment above `NodeVisualFactory.build` for
   *  why the ring is lazily built rather than eagerly attached to every
   *  node's Object3D. Passing `null`/omitting it while selecting a node
   *  that is later re-selected with real data still upgrades the ring the
   *  next time real data is available. */
  setSelected(selected: boolean, credibility?: CredibilityRingInput | null): void;
  setHovered(hovered: boolean): void;
  /** Charter §10 "Reading state: a small lower progress arc." Idempotent —
   *  safe to call every time the underlying node state is (re)computed. */
  setReading(reading: boolean): void;
  /** Charter §10 "Unrelated visible content while selected: 0.12" — applied
   *  to a NODE whenever `graphFocus.ts`'s active `FocusEmphasis` has at
   *  least one emphasized node and this one isn't in it. Idempotent, cheap
   *  (a material-reference swap between two already-cached materials, no
   *  allocation), safe to call every render. */
  setEmphasis(dimmed: boolean): void;
  /** Disposes any resources this specific node's visual lazily allocated
   *  beyond what `NodeVisualFactory` shares (today: the per-node
   *  credibility-ring materials — see `factory.build`'s doc comment). Must
   *  be called for every built `NodeVisual` during scene teardown,
   *  alongside `NodeVisualFactory.dispose()`. */
  dispose(): void;
}

function silhouetteGeometry(kind: KMDisplayKind, radius: number): THREE.BufferGeometry {
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

/** Quantizes a 0-1 credibility score into a small number of discrete
 *  brightness buckets so the credibility-ring materials this factory
 *  builds can still be genuinely SHARED across nodes/segments/dimensions
 *  whenever two scores round to the same bucket, rather than allocating a
 *  brand-new material for every unique floating-point score (charter §14
 *  "Share geometries, materials, textures"). 12 buckets is coarse enough
 *  to share materials in practice, fine enough that the ring visibly
 *  differentiates "barely assessed" from "strongly assessed". */
const CREDIBILITY_BRIGHTNESS_BUCKETS = 12;

function bucketedBrightness(score: number): number {
  const clamped = Math.max(0, Math.min(1, score));
  return Math.round(clamped * CREDIBILITY_BRIGHTNESS_BUCKETS) / CREDIBILITY_BRIGHTNESS_BUCKETS;
}

/** Caches geometries/materials for exactly one mounted scene (see this
 * file's top comment for why the cache is instance-scoped, not a module
 * singleton). Every geometry/material it creates is tracked and disposed
 * together by `dispose()`. */
export class NodeVisualFactory {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private ringGeometry: THREE.BufferGeometry | null = null;
  private credibilitySegmentGeometry: THREE.BufferGeometry | null = null;
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

  /** One shared arc-segment shape for the credibility ring (charter §10:
   *  "segmented ring"). `TorusGeometry`'s `arc` parameter draws a partial
   *  torus, so a single cached geometry — rotated per segment index at
   *  placement time — covers all six segments on every node, rather than
   *  needing six distinct geometries. A small gap (`SEGMENT_GAP_RATIO`)
   *  between segments keeps the six dimensions visually distinguishable. */
  private getCredibilitySegmentGeometry(): THREE.BufferGeometry {
    if (!this.credibilitySegmentGeometry) {
      const segmentGapRatio = 0.15;
      const arc = ((Math.PI * 2) / CREDIBILITY_RING_SEGMENT_COUNT) * (1 - segmentGapRatio);
      this.credibilitySegmentGeometry = new THREE.TorusGeometry(1, 0.05, 6, 12, arc);
    }
    return this.credibilitySegmentGeometry;
  }

  /** Materials are shared whenever two (color, quantized-brightness) pairs
   *  match — see `bucketedBrightness`'s doc comment. */
  private getCredibilityMaterial(baseColor: string, brightnessBucket: number | "not-assessed"): THREE.Material {
    const key = `credibility:${baseColor}:${brightnessBucket}`;
    return this.getMaterial(key, () => {
      if (brightnessBucket === "not-assessed") {
        return new THREE.MeshBasicMaterial({ color: CREDIBILITY_RING_NOT_ASSESSED_COLOR, transparent: true, opacity: 0.55 });
      }
      const color = new THREE.Color(baseColor);
      // Brightness scales the *emissive-equivalent* intensity for a
      // MeshBasicMaterial (unlit) by darkening toward the not-assessed
      // color at low scores and full saturation at high scores, so "low
      // score" reads as visually muted, not simply "a dimmer light".
      const notAssessed = new THREE.Color(CREDIBILITY_RING_NOT_ASSESSED_COLOR);
      color.lerp(notAssessed, 1 - brightnessBucket);
      return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    });
  }

  /** The shared, non-dimmed accessory material for `color` — pulled out of
   *  `accessoryMesh` so `build()` can also resolve the DIMMED variant
   *  (`accessory:${color}:dimmed`) from the exact same color key without
   *  re-deriving `visual.accessoryColor ?? visual.color` a second time in a
   *  way that could silently drift from what `accessoryMesh` itself uses. */
  private getAccessoryMaterial(color: string, dimmed: boolean): THREE.Material {
    const key = dimmed ? `accessory:${color}:dimmed` : `accessory:${color}`;
    return this.getMaterial(key, () =>
      dimmed
        ? new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15, transparent: true, opacity: DIMMED_NODE_OPACITY })
        : new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 }),
    );
  }

  private accessoryMesh(kind: KMDisplayKind, radius: number): THREE.Object3D | null {
    const visual = KIND_VISUALS[kind];
    if (!visual.accessory) return null;
    const color = visual.accessoryColor ?? visual.color;
    const geom = this.getGeometry(`accessory:${visual.accessory}`, () => new THREE.TorusGeometry(1, 0.045, 8, 24));
    const mat = this.getAccessoryMaterial(color, false);
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

  /**
   * Builds one node's full visual: main mesh + accessory + (initially
   * hidden) selection/hover/reading rings + an oversized invisible picking
   * volume, all as children of one Group so react-force-graph-3d can
   * position/scale the whole thing as a single Object3D.
   *
   * The credibility ring's six segment meshes are deliberately NOT built
   * here — only on first `setSelected(true, credibility)` call (see
   * `NodeVisual.setSelected`'s doc comment) — because charter §10 scopes
   * this ring to "selection/close focus" only, and at most one node is
   * selected at a time: eagerly attaching six extra meshes to every one of
   * up to 120 visible nodes would resident-allocate GPU/JS resources for a
   * feature that is, at any given moment, visible on at most one of them.
   */
  build(node: { displayKind: KMDisplayKind; unavailableReason: string | null; sourceEntity: DisplaySourceEntity | null }): NodeVisual {
    const visual = KIND_VISUALS[node.displayKind];
    const radius = BASE_RADIUS * visual.relativeRadius;
    const group = new THREE.Group();

    const geometry = this.getGeometry(`${node.displayKind}:${radius}`, () => silhouetteGeometry(node.displayKind, radius));
    const isUnavailable = node.unavailableReason !== null;
    const displayOnly = isStructuralOrDisplayOnly({ displayKind: node.displayKind, sourceEntity: node.sourceEntity });
    const baseColor = displayOnly ? desaturate(visual.color) : visual.color;
    // Two variants of the SAME material family — full opacity (the default)
    // and DIMMED (charter §10 "unrelated visible content ... 0.12 opacity"
    // — `graphFocus.ts`'s emphasis, applied per-node via `setEmphasis`
    // below). Both are cached/shared the same way every other material here
    // is (charter §14 "share ... materials"), just under two keys instead
    // of one, so many same-kind dimmed nodes still share one GPU resource.
    const mainMaterial = isUnavailable
      ? this.getMaterial("unavailable-wireframe", () => new THREE.MeshBasicMaterial({ color: UNAVAILABLE_WIREFRAME_COLOR, wireframe: true }))
      : this.getMaterial(`solid:${node.displayKind}:${displayOnly ? "muted" : "full"}`, () => new THREE.MeshLambertMaterial({ color: baseColor }));
    const dimmedMainMaterial = isUnavailable
      ? this.getMaterial("unavailable-wireframe:dimmed", () => new THREE.MeshBasicMaterial({ color: UNAVAILABLE_WIREFRAME_COLOR, wireframe: true, transparent: true, opacity: DIMMED_NODE_OPACITY }))
      : this.getMaterial(`solid:${node.displayKind}:${displayOnly ? "muted" : "full"}:dimmed`, () => new THREE.MeshLambertMaterial({ color: baseColor, transparent: true, opacity: DIMMED_NODE_OPACITY }));

    const mainMesh = new THREE.Mesh(geometry, mainMaterial);
    group.add(mainMesh);

    const accessoryColor = visual.accessoryColor ?? visual.color;
    const accessory = this.accessoryMesh(node.displayKind, radius);
    if (accessory) group.add(accessory);
    // Both resolved via the cache (`getAccessoryMaterial`), so `full` here
    // is the EXACT SAME material instance `accessoryMesh()` already
    // assigned — re-fetching it (rather than threading it back out of that
    // method) keeps `accessoryMesh()`'s own signature unchanged.
    const fullAccessoryMaterial = accessory ? this.getAccessoryMaterial(accessoryColor, false) : null;
    const dimmedAccessoryMaterial = accessory ? this.getAccessoryMaterial(accessoryColor, true) : null;

    // Selection ring (bone inner + gold outer) and hover ring (thin bone),
    // hidden by default — cheap to keep resident and just toggle .visible
    // rather than allocate on every selection change.
    const ringGeom = this.getRingGeometry();
    const selectionInnerMat = this.getMaterial("selection-inner", () => new THREE.MeshBasicMaterial({ color: SELECTION_INNER_RING_COLOR }));
    const selectionOuterMat = this.getMaterial("selection-outer", () => new THREE.MeshBasicMaterial({ color: SELECTION_OUTER_RING_COLOR }));
    const hoverMat = this.getMaterial("hover-ring", () => new THREE.MeshBasicMaterial({ color: HOVER_RING_COLOR, transparent: true, opacity: 0.6 }));

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

    // Reading-state progress arc (charter §10 "a small lower progress
    // arc") — reuses the shared ring geometry at a fixed sweep (see
    // ./theme's doc comment on why this is non-proportional), positioned
    // below the node and hidden by default.
    const readingArcGeom = this.getGeometry("reading-arc", () =>
      new THREE.TorusGeometry(1, 0.05, 6, 16, (READING_STATE_ARC_SWEEP_DEG * Math.PI) / 180),
    );
    const readingArcMat = this.getMaterial("reading-arc", () => new THREE.MeshBasicMaterial({ color: READING_STATE_ARC_COLOR }));
    const readingArc = new THREE.Mesh(readingArcGeom, readingArcMat);
    readingArc.scale.setScalar(radius * 1.35);
    readingArc.rotation.x = Math.PI / 2;
    // Center the arc's sweep on "straight down" (-Y) so it reads as a
    // lower progress indicator rather than starting at an arbitrary edge.
    readingArc.rotation.z = Math.PI / 2 + degToRad(READING_STATE_ARC_SWEEP_DEG) / 2;
    readingArc.visible = false;
    group.add(readingArc);

    // Larger invisible picking volume (charter: reliable touch selection
    // without changing the visible geometry).
    const pickGeom = this.getGeometry("pick-sphere-unit", () => new THREE.SphereGeometry(1, 8, 6));
    const pickMat = this.getMaterial("pick-invisible", () => new THREE.MeshBasicMaterial({ visible: false }));
    const pickMesh = new THREE.Mesh(pickGeom, pickMat);
    pickMesh.scale.setScalar(radius * 2.2);
    group.add(pickMesh);

    // Credibility ring: lazily-built group of 6 segment meshes, attached
    // only the first time real data is available (see build()'s doc
    // comment). `getCredibilityMaterial` is a factory-level (shared,
    // bucketed) lookup, but the six Mesh instances and their placement
    // Group are per-node — cheap (no geometry/material allocation of
    // their own) and disposed by this NodeVisual's own `dispose()`.
    let credibilityRingGroup: THREE.Group | null = null;

    // Arrow functions (not `function` declarations) so `this` inside them
    // stays lexically bound to the enclosing `build()` call's instance —
    // no `const factory = this` alias needed.
    const ensureCredibilityRing = (): THREE.Group => {
      if (credibilityRingGroup) return credibilityRingGroup;
      const ringGroup = new THREE.Group();
      const segGeom = this.getCredibilitySegmentGeometry();
      for (let i = 0; i < CREDIBILITY_RING_SEGMENT_COUNT; i++) {
        const mesh = new THREE.Mesh(segGeom, this.getCredibilityMaterial(CREDIBILITY_RING_LIT_COLOR, "not-assessed"));
        mesh.rotation.x = Math.PI / 2;
        mesh.rotation.z = (i / CREDIBILITY_RING_SEGMENT_COUNT) * Math.PI * 2;
        mesh.scale.setScalar(radius * 2.05);
        ringGroup.add(mesh);
      }
      ringGroup.visible = false;
      group.add(ringGroup);
      credibilityRingGroup = ringGroup;
      return ringGroup;
    };

    const updateCredibilityRing = (credibility: CredibilityRingInput): void => {
      const ringGroup = ensureCredibilityRing();
      CREDIBILITY_DIMENSIONS.forEach((dimension, i) => {
        const mesh = ringGroup.children[i] as THREE.Mesh;
        const score = credibility[dimension];
        mesh.material = score == null ? this.getCredibilityMaterial(CREDIBILITY_RING_LIT_COLOR, "not-assessed") : this.getCredibilityMaterial(CREDIBILITY_RING_LIT_COLOR, bucketedBrightness(score));
      });
    };

    return {
      object: group,
      setSelected(selected: boolean, credibility?: CredibilityRingInput | null) {
        selectionInner.visible = selected;
        selectionOuter.visible = selected;
        if (selected && credibility) {
          updateCredibilityRing(credibility);
        }
        if (credibilityRingGroup) credibilityRingGroup.visible = selected && credibility != null;
      },
      setHovered(hovered: boolean) {
        hoverRing.visible = hovered;
      },
      setReading(reading: boolean) {
        readingArc.visible = reading;
      },
      setEmphasis(dimmed: boolean) {
        mainMesh.material = dimmed ? dimmedMainMaterial : mainMaterial;
        // `accessory` is a single Mesh (ring/band) or a Group of exactly
        // two Meshes (double-band) that all share ONE material reference —
        // reassigning `.material` on every Mesh child covers both shapes
        // without needing to know which one this particular kind built.
        if (accessory && dimmedAccessoryMaterial) {
          const full = fullAccessoryMaterial;
          accessory.traverse((child) => {
            if (child instanceof THREE.Mesh) child.material = dimmed ? dimmedAccessoryMaterial : full;
          });
        }
      },
      dispose() {
        // The Group/Mesh instances themselves need no explicit disposal
        // (they hold no GPU resources of their own beyond the shared
        // geometry/materials tracked by NodeVisualFactory); nothing extra
        // to release here today. Present as a real method (not a no-op
        // silently assumed by callers) so a future per-node resource
        // never gets added without a corresponding disposal path.
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.ringGeometry?.dispose();
    this.credibilitySegmentGeometry?.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.ringGeometry = null;
    this.credibilitySegmentGeometry = null;
  }
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
