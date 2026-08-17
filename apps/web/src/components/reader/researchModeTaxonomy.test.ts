import assert from "node:assert/strict";
import { RESEARCH_MODE_LABEL as CANONICAL_LABEL, RESEARCH_MODES as CANONICAL_MODES } from "@ice/rag";
import { RESEARCH_MODE_LABEL, RESEARCH_MODES } from "./researchModeTaxonomy";

/**
 * `RagChatPanel.tsx` cannot import `@ice/rag`'s `RESEARCH_MODES`/
 * `RESEARCH_MODE_LABEL` directly (see `researchModeTaxonomy.ts`'s own doc
 * comment — that package's barrel pulls Node-only built-ins into the client
 * bundle), so it keeps a hand-maintained local mirror instead. A hand
 * mirror with no automated check is exactly the kind of thing that
 * silently drifts the next time `@ice/rag` gains or renames a mode — this
 * is that check, run server-side (no React/DOM, plain `node:assert` per
 * this package's own `tsx`-run test convention — see `matchNoteToBlock.test.ts`)
 * so it can compare the two canonical sources directly.
 */

// Mirrors the exact same mode set, in the same order.
assert.deepEqual(RESEARCH_MODES, CANONICAL_MODES);

// Mirrors the exact same label for every mode.
assert.deepEqual(RESEARCH_MODE_LABEL, CANONICAL_LABEL);

// Has no fewer and no more modes than the canonical export (a mode neither
// added nor dropped silently).
assert.equal(RESEARCH_MODES.length, CANONICAL_MODES.length);
assert.equal(Object.keys(RESEARCH_MODE_LABEL).length, Object.keys(CANONICAL_LABEL).length);
