import assert from "node:assert/strict";
import * as THREE from "three";
import type { CredibilityRingInput } from "./nodeVisuals";
import { NodeVisualFactory } from "./nodeVisuals";
import { desaturate, KIND_VISUALS } from "./theme";

/**
 * `three.js` geometry/material classes are plain JS objects — constructible
 * in Node without a DOM/WebGL context (verified: only the renderer/canvas
 * layer needs a browser). So this file, unlike `labelLayer.ts` (which
 * touches `document` directly in its constructor), CAN run as a plain
 * tsx+node:assert unit test. Run via
 * `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/nodeVisuals.test.ts`.
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

// --- geometries/materials are shared across two nodes of the same kind ---
{
  const factory = new NodeVisualFactory();
  const a = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
  const b = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "b" } });
  assert.equal(mainMesh(a.object).geometry, mainMesh(b.object).geometry, "same displayKind must share cached geometry");
  assert.equal(mainMesh(a.object).material, mainMesh(b.object).material, "same displayKind (both real, not display-only) must share cached material");
  a.dispose();
  b.dispose();
  factory.dispose();
}
console.log("geometry/material sharing: OK");

// --- unavailable nodes get the wireframe material, shared across kinds ---
{
  const factory = new NodeVisualFactory();
  const missingWork = factory.build({ displayKind: "work", unavailableReason: "Referenced, not acquired", sourceEntity: { kind: "work", id: "a" } });
  const missingRef = factory.build({ displayKind: "reference", unavailableReason: "Referenced, not acquired", sourceEntity: { kind: "bibliographic_record", id: "b" } });
  const mat = mainMesh(missingWork.object).material as THREE.MeshBasicMaterial;
  assert.equal(mat.wireframe, true);
  assert.equal(mainMesh(missingRef.object).material, mat, "the wireframe material is shared across every unavailable node regardless of kind");
  factory.dispose();
}
console.log("unavailable wireframe treatment: OK");

// --- structural/display-only nodes get the desaturated material, real nodes don't ---
{
  const factory = new NodeVisualFactory();
  const aggregate = factory.build({ displayKind: "aggregate", unavailableReason: null, sourceEntity: null });
  const realWork = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
  const aggregateMat = mainMesh(aggregate.object).material as THREE.MeshLambertMaterial;
  const realMat = mainMesh(realWork.object).material as THREE.MeshLambertMaterial;
  const expectedDesaturated = new THREE.Color(desaturate(KIND_VISUALS.aggregate.color));
  assert.ok(aggregateMat.color.equals(expectedDesaturated), "a display-only node (no sourceEntity) is desaturated");
  assert.ok(realMat.color.equals(new THREE.Color(KIND_VISUALS.work.color)), "a real node keeps its full-saturation color");
  factory.dispose();
}
console.log("structural/display-only desaturation: OK");

// --- selection/hover rings toggle without rebuilding the object ---
{
  const factory = new NodeVisualFactory();
  const visual = factory.build({ displayKind: "concept", unavailableReason: null, sourceEntity: { kind: "concept", id: "a" } });
  const before = countVisibleDescendants(visual.object);
  visual.setSelected(true);
  assert.equal(countVisibleDescendants(visual.object), before + 2, "selection turns on exactly the inner+outer ring");
  visual.setHovered(true);
  assert.equal(countVisibleDescendants(visual.object), before + 3);
  visual.setSelected(false);
  visual.setHovered(false);
  assert.equal(countVisibleDescendants(visual.object), before);
  factory.dispose();
}
console.log("selection/hover ring toggling: OK");

// --- reading-state arc toggles independently of selection/hover ---
{
  const factory = new NodeVisualFactory();
  const visual = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
  const before = countVisibleDescendants(visual.object);
  visual.setReading(true);
  assert.equal(countVisibleDescendants(visual.object), before + 1);
  visual.setReading(false);
  assert.equal(countVisibleDescendants(visual.object), before);
  factory.dispose();
}
console.log("reading-state arc: OK");

// --- credibility ring: lazily built, only visible while selected AND data is present ---
{
  const factory = new NodeVisualFactory();
  const visual = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
  const childCountBeforeAnySelection = visual.object.children.length;

  // Selecting with no credibility data must not build the ring at all.
  visual.setSelected(true);
  assert.equal(visual.object.children.length, childCountBeforeAnySelection, "no credibility data -> ring group is never attached");
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
  assert.equal(visual.object.children.length, childCountBeforeAnySelection + 1, "first real-data selection attaches exactly one ring group");
  const ringGroup = visual.object.children[visual.object.children.length - 1] as THREE.Group;
  assert.equal(ringGroup.visible, true);
  assert.equal(ringGroup.children.length, 6, "one mesh per credibility dimension");

  const notAssessedMesh = ringGroup.children[3] as THREE.Mesh; // hostProvenance, index 2? verify order below instead
  void notAssessedMesh;

  visual.setSelected(false);
  assert.equal(ringGroup.visible, false, "deselecting hides the ring without destroying it");
  visual.setSelected(true, fullCredibility);
  assert.equal(visual.object.children.length, childCountBeforeAnySelection + 1, "re-selecting reuses the already-built ring group, does not attach a second one");
  factory.dispose();
}
console.log("credibility ring lazy build + selection-only visibility: OK");

// --- setEmphasis (charter §10 "unrelated visible content dims to 0.12
// opacity") — the main mesh and any accessory mesh(es) swap to a
// transparent, low-opacity material variant, and back, without ever
// rebuilding geometry or losing the shared-material discipline. ---
{
  const factory = new NodeVisualFactory();
  // "work" carries an accessory (equatorial ring) — exercises BOTH the main
  // mesh and the accessory swap in one node.
  const a = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "a" } });
  const b = factory.build({ displayKind: "work", unavailableReason: null, sourceEntity: { kind: "work", id: "b" } });

  const mainA = mainMesh(a.object);
  const fullMaterial = mainA.material as THREE.MeshLambertMaterial;
  assert.equal(fullMaterial.transparent, false, "the default (non-dimmed) main material is fully opaque, not transparent");

  a.setEmphasis(true);
  const dimmedMaterial = mainA.material as THREE.MeshLambertMaterial;
  assert.notEqual(dimmedMaterial, fullMaterial, "dimming swaps to a different material instance");
  assert.equal(dimmedMaterial.transparent, true);
  assert.equal(dimmedMaterial.opacity, 0.12, "dimmed opacity matches charter's 0.12 (DIMMED_NODE_OPACITY)");

  // The accessory ring (child index 1 — after the main mesh) also swaps.
  const accessory = a.object.children[1] as THREE.Mesh;
  assert.equal((accessory.material as THREE.MeshLambertMaterial).transparent, true, "the accessory ring dims too, not just the main body");

  b.setEmphasis(true);
  assert.equal(mainMesh(b.object).material, dimmedMaterial, "two same-kind dimmed nodes SHARE one dimmed material instance (charter §14 'share materials')");

  a.setEmphasis(false);
  assert.equal(mainMesh(a.object).material, fullMaterial, "un-dimming restores the exact original full-opacity material reference");

  // Idempotent — calling with the same value twice must not throw or
  // allocate a third material.
  a.setEmphasis(false);
  assert.equal(mainMesh(a.object).material, fullMaterial);

  a.dispose();
  b.dispose();
  factory.dispose();
}
console.log("setEmphasis: main + accessory dim/undim, shared materials: OK");

// --- setEmphasis on an unavailable (wireframe) node — the dimmed variant
// must still be a wireframe, just transparent, never losing the
// "unavailable" visual signal while also dimmed. ---
{
  const factory = new NodeVisualFactory();
  const visual = factory.build({ displayKind: "reference", unavailableReason: "no_source_text", sourceEntity: { kind: "bibliographic_record", id: "x" } });
  const full = mainMesh(visual.object).material as THREE.MeshBasicMaterial;
  assert.equal(full.wireframe, true);
  visual.setEmphasis(true);
  const dimmed = mainMesh(visual.object).material as THREE.MeshBasicMaterial;
  assert.equal(dimmed.wireframe, true, "still renders as wireframe (unavailable) while dimmed");
  assert.equal(dimmed.transparent, true);
  assert.equal(dimmed.opacity, 0.12);
  visual.dispose();
  factory.dispose();
}
console.log("setEmphasis on an unavailable/wireframe node: OK");

// --- factory.dispose() is idempotent and actually disposes tracked resources ---
{
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
  assert.equal(disposeCalls, 1);
  factory.dispose(); // idempotent — must not throw or double-dispose
  assert.equal(disposeCalls, 1);
}
console.log("factory dispose idempotence: OK");

console.log("nodeVisuals.test.ts: all assertions passed");
