import { describe, expect, it } from "vitest";
import { RESEARCH_MODE_LABEL as CANONICAL_LABEL, RESEARCH_MODES as CANONICAL_MODES } from "@ice/rag";
import { RESEARCH_MODE_LABEL, RESEARCH_MODES } from "./researchModeTaxonomy";

/**
 * `RagChatPanel.tsx` cannot import `@ice/rag`'s `RESEARCH_MODES`/
 * `RESEARCH_MODE_LABEL` directly (see `researchModeTaxonomy.ts`'s own doc
 * comment — that package's barrel pulls Node-only built-ins into the client
 * bundle), so it keeps a hand-maintained local mirror instead. A hand
 * mirror with no automated check is exactly the kind of thing that
 * silently drifts the next time `@ice/rag` gains or renames a mode — this
 * test is that check, run server-side (no React/DOM) so it can compare the
 * two canonical sources directly.
 */
describe("researchModeTaxonomy mirror parity with @ice/rag", () => {
  it("mirrors the exact same mode set, in the same order", () => {
    expect(RESEARCH_MODES).toEqual(CANONICAL_MODES);
  });

  it("mirrors the exact same label for every mode", () => {
    expect(RESEARCH_MODE_LABEL).toEqual(CANONICAL_LABEL);
  });

  it("has no fewer and no more modes than the canonical export (a mode neither added nor dropped silently)", () => {
    expect(RESEARCH_MODES.length).toBe(CANONICAL_MODES.length);
    expect(Object.keys(RESEARCH_MODE_LABEL).length).toBe(Object.keys(CANONICAL_LABEL).length);
  });
});
