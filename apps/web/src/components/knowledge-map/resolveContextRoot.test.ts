import assert from "node:assert/strict";
import { claimRoot, debateRoot, passageRoot, questionRoot } from "./resolveContextRoot";

/** `npx tsx apps/web/src/components/knowledge-map/resolveContextRoot.test.ts` */

{
  const { node, label, breadcrumb } = passageRoot({ id: "p1", workId: "w1", workTitle: "On the Soul", summary: "The soul as form" });
  assert.equal(String(node.id), "passage:p1");
  assert.equal(node.displayKind, "passage");
  assert.deepEqual(node.sourceEntity, { kind: "passage_annotation", id: "p1" });
  assert.equal(node.destination, "/works/w1/reader");
  assert.equal(label, "The soul as form");
  assert.equal(breadcrumb, "On the Soul");
}
console.log("passageRoot: OK");

{
  const { node, breadcrumb } = questionRoot({ id: "q1", title: "Does form require matter?", summary: null });
  assert.equal(String(node.id), "question:q1");
  assert.equal(node.displayKind, "question");
  assert.equal(node.destination, "/research/q1");
  assert.equal(breadcrumb, "", "null summary never fabricated into a string");
}
console.log("questionRoot: OK");

{
  const { node, breadcrumb } = claimRoot({ id: "c1", claimText: "Form and matter are inseparable.", workTitle: null, corpusItemTitle: "Imported abstract" });
  assert.equal(String(node.id), "claim:c1");
  assert.equal(node.displayKind, "claim");
  assert.equal(node.destination, "/research/claims/c1");
  assert.equal(breadcrumb, "Imported abstract", "falls back to corpus-item title");
}
console.log("claimRoot: OK");

{
  const { node, breadcrumb } = debateRoot({ id: "d1", projectId: "proj1", name: "Hylomorphism vs. dualism", researchQuestion: "Is the soul separable?" });
  assert.equal(String(node.id), "debate:d1");
  assert.equal(node.displayKind, "debate");
  assert.equal(node.destination, "/research/proj1/debates/d1");
  assert.equal(breadcrumb, "Is the soul separable?");
}
console.log("debateRoot: OK");

console.log("resolveContextRoot.test.ts: all assertions passed");
