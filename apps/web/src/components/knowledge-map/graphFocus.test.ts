import { describe, expect, it } from "vitest";
import {
  buildNodeAdjacency,
  computeFocusEmphasis,
  emphasisStateForNode,
  EMPTY_FOCUS_EMPHASIS,
  type FocusableLink,
  type FocusableNode,
} from "./graphFocus";

/**
 * Ported from the pre-rebuild `components/graph/graphFocus.test.ts`
 * (Phase 21.6/D-21-2) and extended to the charter's 5-value
 * `GraphFocusState` vocabulary (`all`/`neighborhood`/`expand2`/`concepts`/
 * `readingPath`) — this is the confirmed Stage 3 gap
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

describe("buildNodeAdjacency", () => {
  it("builds an undirected adjacency map with no entry for edgeless nodes", () => {
    const adjacency = buildNodeAdjacency(links);
    expect([...(adjacency.get("work:1") ?? [])].sort()).toEqual(["concept:1", "external:bib:1", "section:1"]);
    expect([...(adjacency.get("external:bib:1") ?? [])]).toEqual(["work:1"]);
    expect(adjacency.get("concept:1")?.size).toBe(1);
    // a node with no edges has no adjacency entry at all
    expect(adjacency.has("nonexistent")).toBe(false);
  });
});

describe("computeFocusEmphasis", () => {
  // --- computeFocusEmphasis: "all" / no selection --------------------------
  it('"all" / no selection produces no emphasis', () => {
    // no selection -> no emphasis regardless of mode
    expect(computeFocusEmphasis(nodes, links, null, "neighborhood")).toEqual(EMPTY_FOCUS_EMPHASIS);
    expect(computeFocusEmphasis(nodes, links, undefined, "expand2")).toEqual(EMPTY_FOCUS_EMPHASIS);
    // 'all' always returns empty, even with a real selection
    expect(computeFocusEmphasis(nodes, links, "external:bib:1", "all")).toEqual(EMPTY_FOCUS_EMPHASIS);
    // a stale selection degrades to empty, not a ghost focus
    expect(computeFocusEmphasis(nodes, links, "nonexistent-id", "neighborhood")).toEqual(EMPTY_FOCUS_EMPHASIS);
  });

  // --- computeFocusEmphasis: "neighborhood" (one hop) ----------------------
  it('"neighborhood" emphasizes exactly one hop', () => {
    const emphasis = computeFocusEmphasis(nodes, links, "external:bib:1", "neighborhood");
    expect([...emphasis.emphasizedNodeIds].sort()).toEqual(["external:bib:1", "work:1"]);
    // concept and section are NOT neighbors of bib, so they dim
    expect([...emphasis.dimmedNodeIds].sort()).toEqual(["concept:1", "section:1"]);
    // only the reference edge has both endpoints emphasized
    expect([...emphasis.emphasizedLinkIds]).toEqual(["l1"]);
  });

  // --- computeFocusEmphasis: "expand2" (two hops) --------------------------
  it('"expand2" reaches two hops', () => {
    const emphasis = computeFocusEmphasis(nodes, links, "external:bib:1", "expand2");
    // expand2 reaches work's other one-hop neighbors too (concept, section)
    expect([...emphasis.emphasizedNodeIds].sort()).toEqual(["concept:1", "external:bib:1", "section:1", "work:1"]);
    // nothing left to dim once every node is within two hops
    expect([...emphasis.dimmedNodeIds]).toEqual([]);
    // every edge now has both endpoints emphasized
    expect([...emphasis.emphasizedLinkIds].sort()).toEqual(["l1", "l2", "l3"]);
  });

  // --- computeFocusEmphasis: "concepts" -------------------------------------
  it('"concepts" narrows by node kind, not just by hop distance', () => {
    // work:1 has three one-hop neighbors of three different displayKinds: a
    // reference, a concept, and a person -- "concepts" must keep only the
    // concept/person ones, proving it genuinely narrows by KIND rather than
    // just being "neighborhood" under another name.
    const typedNodes: FocusableNode[] = [node("work:1", "work"), node("external:bib:1", "reference"), node("concept:1", "concept"), node("person:1", "person")];
    const typedLinks: FocusableLink[] = [link("l1", "work:1", "external:bib:1"), link("l2", "work:1", "concept:1"), link("l3", "work:1", "person:1")];

    const emphasis = computeFocusEmphasis(typedNodes, typedLinks, "work:1", "concepts");
    // 'concepts' keeps the selection plus only its concept/person one-hop neighbors
    expect([...emphasis.emphasizedNodeIds].sort()).toEqual(["concept:1", "person:1", "work:1"]);
    // the reference neighbor is excluded from 'concepts', unlike 'neighborhood'
    expect([...emphasis.dimmedNodeIds]).toEqual(["external:bib:1"]);
    // only edges to the kept concept/person neighbors stay emphasized
    expect([...emphasis.emphasizedLinkIds].sort()).toEqual(["l2", "l3"]);

    // A selection with NO concept/person neighbors at all still emphasizes
    // (only) itself, never falling back to "neighborhood"'s full one-hop set.
    const noConceptNeighbors = computeFocusEmphasis(typedNodes, typedLinks, "external:bib:1", "concepts");
    expect([...noConceptNeighbors.emphasizedNodeIds]).toEqual(["external:bib:1"]);
  });

  // --- computeFocusEmphasis: "readingPath" ----------------------------------
  it('"readingPath" follows the supplied set and overrides selection-driven emphasis', () => {
    // Ignores selection entirely -- a selected node NOT on the reading path
    // still dims, and the emphasis is driven purely by the supplied set.
    const readingPathIds = new Set(["work:1", "concept:1"]);
    const emphasis = computeFocusEmphasis(nodes, links, "external:bib:1", "readingPath", readingPathIds);
    // emphasis follows the reading-path set, not the selection
    expect([...emphasis.emphasizedNodeIds].sort()).toEqual(["concept:1", "work:1"]);
    // the selected bib is dimmed too -- readingPath overrides selection-driven emphasis
    expect([...emphasis.dimmedNodeIds].sort()).toEqual(["external:bib:1", "section:1"]);
    // only the work<->concept edge has both endpoints on the reading path
    expect([...emphasis.emphasizedLinkIds]).toEqual(["l2"]);

    // No reading-path data yet (e.g. a non-work context, or the roadmap fetch
    // hasn't resolved) -- degrades to an honest empty emphasis, never a crash
    // and never a silent fallback to a different mode.
    // empty reading-path set -> no emphasis
    expect(computeFocusEmphasis(nodes, links, "work:1", "readingPath")).toEqual(EMPTY_FOCUS_EMPHASIS);
    // a reading-path id that isn't in the current node set contributes nothing, not a ghost entry
    expect(computeFocusEmphasis(nodes, links, "work:1", "readingPath", new Set(["not-in-this-context"]))).toEqual(EMPTY_FOCUS_EMPHASIS);
  });
});

// --- emphasisStateForNode --------------------------------------------------

describe("emphasisStateForNode", () => {
  it("reports selected/neighbor/dimmed, and none whenever there is no focus", () => {
    const emphasis = computeFocusEmphasis(nodes, links, "external:bib:1", "neighborhood");
    expect(emphasisStateForNode("external:bib:1", "external:bib:1", emphasis)).toBe("selected");
    expect(emphasisStateForNode("work:1", "external:bib:1", emphasis)).toBe("neighbor");
    expect(emphasisStateForNode("concept:1", "external:bib:1", emphasis)).toBe("dimmed");
    // "all" mode (or no selection): every node reports "none", even the
    // literally-selected one -- data-selected and data-emphasis are two
    // different signals, not the same fact twice.
    const noFocus = computeFocusEmphasis(nodes, links, "external:bib:1", "all");
    expect(emphasisStateForNode("external:bib:1", "external:bib:1", noFocus)).toBe("none");
    expect(emphasisStateForNode("external:bib:1", null, EMPTY_FOCUS_EMPHASIS)).toBe("none");
  });
});
