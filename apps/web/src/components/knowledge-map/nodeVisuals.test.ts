import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CredibilityRingInput } from "./nodeVisuals";
import { NodeVisualFactory } from "./nodeVisuals";
import { desaturate, KIND_VISUALS } from "./theme";

/**
 * `three.js` geometry/material classes are plain JS objects — constructible
 * in Node without a DOM/WebGL context (verified: only the renderer/canvas
 * layer needs a browser). So this file, unlike `labelLayer.ts` (which
 * touches `document` directly in its constructor), CAN run as a plain
 * Node-side unit test.
 */

function mainMesh(object: THREE.Object3D): THREE.Mesh {
  return object.children[0] as THREE.Mesh;
}

function countVisibleDescendants(object: THREE.Object3D): number {
  let n = 0;
  object.traverse((child) => {
    if ((child as THREE.Mesh).visible) n += 1;
  });
  return n;
}

describe("NodeVisualFactory", () => {
  // --- geometries/materials are shared across two nodes of the same kind ---
  it("shares geometries/materials across two nodes of the same kind", () => {
    const factory = new NodeVisualFactory();
    const a = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
    const b = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "b" } });
    // same displayKind must share cached geometry
    expect(mainMesh(a.object).geometry).toBe(mainMesh(b.object).geometry);
    // same displayKind (both real, not display-only) must share cached material
    expect(mainMesh(a.object).material).toBe(mainMesh(b.object).material);
    a.dispose();
    b.dispose();
    factory.dispose();
  });

  // --- unavailable nodes get the wireframe material, shared across kinds ---
  it("gives unavailable nodes the wireframe material, shared across kinds", () => {
    const factory = new NodeVisualFactory();
    const missingWork = factory.build({ displayKind: "work", unavailableReason: "Referenced, not acquired", sourceEntity: { kind: "work", id: "a" } });
    const missingRef = factory.build({ displayKind: "reference", unavailableReason: "Referenced, not acquired", sourceEntity: { kind: "bibliographic_record", id: "b" } });
    const mat = mainMesh(missingWork.object).material as THREE.MeshBasicMaterial;
    expect(mat.wireframe).toBe(true);
    // the wireframe material is shared across every unavailable node regardless of kind
    expect(mainMesh(missingRef.object).material).toBe(mat);
    factory.dispose();
  });

  // --- structural/display-only nodes get the desaturated material, real nodes don't ---
  it("desaturates structural/display-only nodes but keeps real nodes at full saturation", () => {
    const factory = new NodeVisualFactory();
    const aggregate = factory.build({ displayKind: "aggregate", unavailableReason: null, sourceEntity: null });
    const realWork = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
    const aggregateMat = mainMesh(aggregate.object).material as THREE.MeshLambertMaterial;
    const realMat = mainMesh(realWork.object).material as THREE.MeshLambertMaterial;
    const expectedDesaturated = new THREE.Color(desaturate(KIND_VISUALS.aggregate.color));
    // a display-only node (no sourceEntity) is desaturated
    expect(aggregateMat.color.equals(expectedDesaturated)).toBeTruthy();
    // a real node keeps its full-saturation color
    expect(realMat.color.equals(new THREE.Color(KIND_VISUALS.work.color))).toBeTruthy();
    factory.dispose();
  });

  // --- selection/hover rings toggle without rebuilding the object ---
  it("toggles selection/hover rings without rebuilding the object", () => {
    const factory = new NodeVisualFactory();
    const visual = factory.build({ displayKind: "concept", unavailableReason: null, sourceEntity: { kind: "concept", id: "a" } });
    const before = countVisibleDescendants(visual.object);
    visual.setSelected(true);
    // selection turns on exactly the inner+outer ring
    expect(countVisibleDescendants(visual.object)).toBe(before + 2);
    visual.setHovered(true);
    expect(countVisibleDescendants(visual.object)).toBe(before + 3);
    visual.setSelected(false);
    visual.setHovered(false);
    expect(countVisibleDescendants(visual.object)).toBe(before);
    factory.dispose();
  });

  // --- reading-state arc toggles independently of selection/hover ---
  it("toggles the reading-state arc independently of selection/hover", () => {
    const factory = new NodeVisualFactory();
    const visual = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
    const before = countVisibleDescendants(visual.object);
    visual.setReading(true);
    expect(countVisibleDescendants(visual.object)).toBe(before + 1);
    visual.setReading(false);
    expect(countVisibleDescendants(visual.object)).toBe(before);
    factory.dispose();
  });

  // --- credibility ring: lazily built, only visible while selected AND data is present ---
  it("builds the credibility ring lazily and shows it only while selected AND data is present", () => {
    const factory = new NodeVisualFactory();
    const visual = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
    const childCountBeforeAnySelection = visual.object.children.length;

    // Selecting with no credibility data must not build the ring at all.
    visual.setSelected(true);
    // no credibility data -> ring group is never attached
    expect(visual.object.children.length).toBe(childCountBeforeAnySelection);
    visual.setSelected(false);

    const fullCredibility: CredibilityRingInput = {
      publicationRigor: 0.9,
      creatorExpertise: 0.5,
      hostProvenance: null, // "not assessed" — must render distinctly, never as 0
      pedagogicalValue: 0.1,
      relevance: 0.7,
      evidenceStrength: null,
    };
    visual.setSelected(true, fullCredibility);
    // first real-data selection attaches exactly one ring group
    expect(visual.object.children.length).toBe(childCountBeforeAnySelection + 1);
    const ringGroup = visual.object.children[visual.object.children.length - 1] as THREE.Group;
    expect(ringGroup.visible).toBe(true);
    // one mesh per credibility dimension
    expect(ringGroup.children.length).toBe(6);

    const notAssessedMesh = ringGroup.children[3] as THREE.Mesh; // hostProvenance, index 2? verify order below instead
    void notAssessedMesh;

    visual.setSelected(false);
    // deselecting hides the ring without destroying it
    expect(ringGroup.visible).toBe(false);
    visual.setSelected(true, fullCredibility);
    // re-selecting reuses the already-built ring group, does not attach a second one
    expect(visual.object.children.length).toBe(childCountBeforeAnySelection + 1);
    factory.dispose();
  });

  // --- setEmphasis (charter §10 "unrelated visible content dims to 0.12
  // opacity") — the main mesh and any accessory mesh(es) swap to a
  // transparent, low-opacity material variant, and back, without ever
  // rebuilding geometry or losing the shared-material discipline. ---
  it("dims/undims the main mesh and accessory via shared material variants, idempotently", () => {
    const factory = new NodeVisualFactory();
    // "work" carries an accessory (equatorial ring) — exercises BOTH the main
    // mesh and the accessory swap in one node.
    const a = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
    const b = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "b" } });

    const mainA = mainMesh(a.object);
    const fullMaterial = mainA.material as THREE.MeshLambertMaterial;
    // the default (non-dimmed) main material is fully opaque, not transparent
    expect(fullMaterial.transparent).toBe(false);

    a.setEmphasis(true);
    const dimmedMaterial = mainA.material as THREE.MeshLambertMaterial;
    // dimming swaps to a different material instance
    expect(dimmedMaterial).not.toBe(fullMaterial);
    expect(dimmedMaterial.transparent).toBe(true);
    // dimmed opacity matches charter's 0.12 (DIMMED_NODE_OPACITY)
    expect(dimmedMaterial.opacity).toBe(0.12);

    // The accessory ring (child index 1 — after the main mesh) also swaps.
    const accessory = a.object.children[1] as THREE.Mesh;
    // the accessory ring dims too, not just the main body
    expect((accessory.material as THREE.MeshLambertMaterial).transparent).toBe(true);

    b.setEmphasis(true);
    // two same-kind dimmed nodes SHARE one dimmed material instance (charter §14 'share materials')
    expect(mainMesh(b.object).material).toBe(dimmedMaterial);

    a.setEmphasis(false);
    // un-dimming restores the exact original full-opacity material reference
    expect(mainMesh(a.object).material).toBe(fullMaterial);

    // Idempotent — calling with the same value twice must not throw or
    // allocate a third material.
    a.setEmphasis(false);
    expect(mainMesh(a.object).material).toBe(fullMaterial);

    a.dispose();
    b.dispose();
    factory.dispose();
  });

  // --- setEmphasis on an unavailable (wireframe) node — the dimmed variant
  // must still be a wireframe, just transparent, never losing the
  // "unavailable" visual signal while also dimmed. ---
  it("keeps an unavailable node's wireframe signal while dimming it", () => {
    const factory = new NodeVisualFactory();
    const visual = factory.build({ displayKind: "reference", unavailableReason: "no_source_text", sourceEntity: { kind: "bibliographic_record", id: "x" } });
    const full = mainMesh(visual.object).material as THREE.MeshBasicMaterial;
    expect(full.wireframe).toBe(true);
    visual.setEmphasis(true);
    const dimmed = mainMesh(visual.object).material as THREE.MeshBasicMaterial;
    // still renders as wireframe (unavailable) while dimmed
    expect(dimmed.wireframe).toBe(true);
    expect(dimmed.transparent).toBe(true);
    expect(dimmed.opacity).toBe(0.12);
    visual.dispose();
    factory.dispose();
  });

  // --- factory.dispose() is idempotent and actually disposes tracked resources ---
  it("disposes tracked resources exactly once, idempotently", () => {
    const factory = new NodeVisualFactory();
    const visual = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
    let disposeCalls = 0;
    const geometry = mainMesh(visual.object).geometry;
    const originalDispose = geometry.dispose.bind(geometry);
    geometry.dispose = () => {
      disposeCalls += 1;
      originalDispose();
    };
    factory.dispose();
    expect(disposeCalls).toBe(1);
    factory.dispose(); // idempotent — must not throw or double-dispose
    expect(disposeCalls).toBe(1);
  });
});
