import { describe, expect, it } from "vitest";
import { messageForReason, probeWebglAvailable, type FallbackReason } from "./KnowledgeMapFallbackBoundary";

/**
 * Pure-logic coverage only (spec §7.2's own convention — the React
 * component itself, its DOM-dependent probe behavior with a real/stubbed
 * `HTMLCanvasElement.prototype.getContext`, and the full context-lost/
 * context-restored/scene-error scenarios are Playwright territory, see
 * `apps/web/e2e/knowledge-map-fallback.spec.ts`).
 */

describe("KnowledgeMapFallbackBoundary", () => {
  // --- probeWebglAvailable never throws with no DOM (this script's own
  // Node.js runtime) and honestly reports unavailable rather than crashing ---
  it("probeWebglAvailable reports unavailable rather than crashing with no DOM", () => {
    // this test intentionally runs with no DOM
    expect(typeof document).toBe("undefined");
    expect(probeWebglAvailable()).toBe(false);
  });

  // --- messageForReason is total over every FallbackReason and every
  // message is distinguishable (the direct fix for the baseline's "reads
  // like a network problem" complaint — three failure modes, three messages) ---
  it("messageForReason is total over every FallbackReason and every message is distinguishable", () => {
    const reasons: FallbackReason[] = ["webgl-unavailable", "context-lost", "scene-error"];
    const messages = reasons.map(messageForReason);
    for (const message of messages) expect(message.length > 0).toBeTruthy();
    // every reason must produce a distinct message
    expect(new Set(messages).size).toBe(3);
  });
});
