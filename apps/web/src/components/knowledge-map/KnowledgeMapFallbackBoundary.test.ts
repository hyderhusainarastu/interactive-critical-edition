import assert from "node:assert/strict";
import { messageForReason, probeWebglAvailable, type FallbackReason } from "./KnowledgeMapFallbackBoundary";

/**
 * Pure-logic coverage only (spec §7.2's own convention — the React
 * component itself, its DOM-dependent probe behavior with a real/stubbed
 * `HTMLCanvasElement.prototype.getContext`, and the full context-lost/
 * context-restored/scene-error scenarios are Playwright territory, see
 * `apps/web/e2e/knowledge-map-fallback.spec.ts`).
 * `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/KnowledgeMapFallbackBoundary.test.ts`
 */

// --- probeWebglAvailable never throws with no DOM (this script's own
// Node.js runtime) and honestly reports unavailable rather than crashing ---
{
  assert.equal(typeof document, "undefined", "this test intentionally runs with no DOM");
  assert.equal(probeWebglAvailable(), false);
}

// --- messageForReason is total over every FallbackReason and every
// message is distinguishable (the direct fix for the baseline's "reads
// like a network problem" complaint — three failure modes, three messages) ---
{
  const reasons: FallbackReason[] = ["webgl-unavailable", "context-lost", "scene-error"];
  const messages = reasons.map(messageForReason);
  for (const message of messages) assert.ok(message.length > 0);
  assert.equal(new Set(messages).size, 3, "every reason must produce a distinct message");
}

console.log("KnowledgeMapFallbackBoundary.test.ts: all assertions passed");
