import assert from "node:assert/strict";
import {
  buildNodeAdjacency,
  computeFocusEmphasis,
  emphasisStateForNode,
  EMPTY_FOCUS_EMPHASIS,
  type FocusableLink,
  type FocusableNode,
} from "./graphFocus";

/**
 * Run via `pnpm --filter web exec tsx
 * apps/web/src/components/knowledge-map/graphFocus.test.ts` (no vitest
 * wiring under `apps/web` — see `sizing.test.ts`/`theme.test.ts`'s own doc
 * comments for the same convention). Ported from the pre-rebuild
 * `components/graph/graphFocus.test.ts` (Phase 21.6/D-21-2) and extended to
 * the charter's 5-value `GraphFocusState` vocabulary (`all`/`neighborhood`/
 * `expand2`/`concepts`/`readingPath`) — this is the confirmed Stage 3 gap
 * `stage3-kmap-verification.md` §4 flagged ("the 4 non-default focus modes
 * have no real implementation anywhere in the rebuild"), now implemented
 * and covered.
 *
 * Fixture: work -> bib (reference), work -> concept, work -> section — the
 * same shape the old fixture used, so a selected bib has exactly one
 * one-hop neighbor (work) and two genuinely unrelated nodes (concept,
 * section) — proving emphasis actually excludes something, not just that
 * everything stays lit.
 */

function node(id: string, displayKind: string): FocusableNode {
  return { id, displayKind };
}
function link(id: string, source: string, target: string): FocusableLink {
  return { id, source, target };
}

const nodes: FocusableNode[] = [node("work:1", "work"), node("external:bib:1", "reference"), node("concept:1", "concept"), node("section:1", "section")];
const links: FocusableLink[] = [link("l1", "work:1", "external:bib:1"), link("l2", "work:1", "concept:1"), link("l3", "work:1", "section:1")];

// --- buildNodeAdjacency --------------------------------------------------

{
  const adjacency = buildNodeAdjacency(links);
  assert.deepEqual([...(adjacency.get("work:1") ?? [])].sort(), ["concept:1", "external:bib:1", "section:1"]);
  assert.deepEqual([...(adjacency.get("external:bib:1") ?? [])], ["work:1"]);
  assert.equal(adjacency.get("concept:1")?.size, 1);
  assert.equal(adjacency.has("nonexistent"), false, "a node with no edges has no adjacency entry at all");
}

// --- computeFocusEmphasis: "all" / no selection --------------------------

{
  assert.deepEqual(computeFocusEmphasis(nodes, links, null, "neighborhood"), EMPTY_FOCUS_EMPHASIS, "no selection -> no emphasis regardless of mode");
  assert.deepEqual(computeFocusEmphasis(nodes, links, undefined, "expand2"), EMPTY_FOCUS_EMPHASIS);
  assert.deepEqual(computeFocusEmphasis(nodes, links, "external:bib:1", "all"), EMPTY_FOCUS_EMPHASIS, "'all' always returns empty, even with a real selection");
  assert.deepEqual(computeFocusEmphasis(nodes, links, "nonexistent-id", "neighborhood"), EMPTY_FOCUS_EMPHASIS, "a stale selection degrades to empty, not a ghost focus");
}

// --- computeFocusEmphasis: "neighborhood" (one hop) ----------------------

{
  const emphasis = computeFocusEmphasis(nodes, links, "external:bib:1", "neighborhood");
  assert.deepEqual([...emphasis.emphasizedNodeIds].sort(), ["external:bib:1", "work:1"]);
  assert.deepEqual([...emphasis.dimmedNodeIds].sort(), ["concept:1", "section:1"], "concept and section are NOT neighbors of bib, so they dim");
  assert.deepEqual([...emphasis.emphasizedLinkIds], ["l1"], "only the reference edge has both endpoints emphasized");
}

// --- computeFocusEmphasis: "expand2" (two hops) --------------------------

{
  const emphasis = computeFocusEmphasis(nodes, links, "external:bib:1", "expand2");
  assert.deepEqual(
    [...emphasis.emphasizedNodeIds].sort(),
    ["concept:1", "external:bib:1", "section:1", "work:1"],
    "expand2 reaches work's other one-hop neighbors too (concept, section)",
  );
  assert.deepEqual([...emphasis.dimmedNodeIds], [], "nothing left to dim once every node is within two hops");
  assert.deepEqual([...emphasis.emphasizedLinkIds].sort(), ["l1", "l2", "l3"], "every edge now has both endpoints emphasized");
}

// --- computeFocusEmphasis: "concepts" -------------------------------------

{
  // work:1 has three one-hop neighbors of three different displayKinds: a
  // reference, a concept, and a person -- "concepts" must keep only the
  // concept/person ones, proving it genuinely narrows by KIND rather than
  // just being "neighborhood" under another name.
  const typedNodes: FocusableNode[] = [node("work:1", "work"), node("external:bib:1", "reference"), node("concept:1", "concept"), node("person:1", "person")];
  const typedLinks: FocusableLink[] = [link("l1", "work:1", "external:bib:1"), link("l2", "work:1", "concept:1"), link("l3", "work:1", "person:1")];

  const emphasis = computeFocusEmphasis(typedNodes, typedLinks, "work:1", "concepts");
  assert.deepEqual(
    [...emphasis.emphasizedNodeIds].sort(),
    ["concept:1", "person:1", "work:1"],
    "'concepts' keeps the selection plus only its concept/person one-hop neighbors",
  );
  assert.deepEqual([...emphasis.dimmedNodeIds], ["external:bib:1"], "the reference neighbor is excluded from 'concepts', unlike 'neighborhood'");
  assert.deepEqual([...emphasis.emphasizedLinkIds].sort(), ["l2", "l3"], "only edges to the kept concept/person neighbors stay emphasized");

  // A selection with NO concept/person neighbors at all still emphasizes
  // (only) itself, never falling back to "neighborhood"'s full one-hop set.
  const noConceptNeighbors = computeFocusEmphasis(typedNodes, typedLinks, "external:bib:1", "concepts");
  assert.deepEqual([...noConceptNeighbors.emphasizedNodeIds], ["external:bib:1"]);
}

// --- computeFocusEmphasis: "readingPath" ----------------------------------

{
  // Ignores selection entirely -- a selected node NOT on the reading path
  // still dims, and the emphasis is driven purely by the supplied set.
  const readingPathIds = new Set(["work:1", "concept:1"]);
  const emphasis = computeFocusEmphasis(nodes, links, "external:bib:1", "readingPath", readingPathIds);
  assert.deepEqual([...emphasis.emphasizedNodeIds].sort(), ["concept:1", "work:1"], "emphasis follows the reading-path set, not the selection");
  assert.deepEqual([...emphasis.dimmedNodeIds].sort(), ["external:bib:1", "section:1"], "the selected bib is dimmed too -- readingPath overrides selection-driven emphasis");
  assert.deepEqual([...emphasis.emphasizedLinkIds], ["l2"], "only the work<->concept edge has both endpoints on the reading path");

  // No reading-path data yet (e.g. a non-work context, or the roadmap fetch
  // hasn't resolved) -- degrades to an honest empty emphasis, never a crash
  // and never a silent fallback to a different mode.
  assert.deepEqual(computeFocusEmphasis(nodes, links, "work:1", "readingPath"), EMPTY_FOCUS_EMPHASIS, "empty reading-path set -> no emphasis");
  assert.deepEqual(
    computeFocusEmphasis(nodes, links, "work:1", "readingPath", new Set(["not-in-this-context"])),
    EMPTY_FOCUS_EMPHASIS,
    "a reading-path id that isn't in the current node set contributes nothing, not a ghost entry",
  );
}

// --- emphasisStateForNode --------------------------------------------------

{
  const emphasis = computeFocusEmphasis(nodes, links, "external:bib:1", "neighborhood");
  assert.equal(emphasisStateForNode("external:bib:1", "external:bib:1", emphasis), "selected");
  assert.equal(emphasisStateForNode("work:1", "external:bib:1", emphasis), "neighbor");
  assert.equal(emphasisStateForNode("concept:1", "external:bib:1", emphasis), "dimmed");
  // "all" mode (or no selection): every node reports "none", even the
  // literally-selected one -- data-selected and data-emphasis are two
  // different signals, not the same fact twice.
  const noFocus = computeFocusEmphasis(nodes, links, "external:bib:1", "all");
  assert.equal(emphasisStateForNode("external:bib:1", "external:bib:1", noFocus), "none");
  assert.equal(emphasisStateForNode("external:bib:1", null, EMPTY_FOCUS_EMPHASIS), "none");
}

console.log("graphFocus.test.ts: all assertions passed");
