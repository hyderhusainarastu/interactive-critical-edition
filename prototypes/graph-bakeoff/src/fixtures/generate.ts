/**
 * Deterministic fixture generator for the renderer bakeoff (charter §13,
 * baseline audit §4/§10).
 *
 * Topology intent, derived directly from the audited real corpus
 * (docs/audits/ui-graph-redesign-baseline.md §4/§10, production account
 * `owner-review@palimnote-canary.test`):
 *   - 88.8% of *target* (non-root/non-hub) nodes have degree exactly 1.
 *   - 5.4% have degree 2-3; no target node was observed above degree 3.
 *   - The real shape is a root work fanning out directly to hundreds of
 *     mostly single-parent leaves ("wide, shallow tree", not a dense mesh),
 *     with a handful of secondary branch points ("few hubs") rather than a
 *     deep hierarchy. Root/hub nodes themselves legitimately carry high
 *     degree (that's what makes them the root/hubs) — the audited "degree
 *     <= 3" ceiling applies to ordinary leaf/target nodes, not to the one
 *     or few fan-out nodes, which this generator's `isRoot`/`isHub` flags
 *     make explicit rather than silently conflating.
 *   - Real single-work edge:node ratio is ~1.0 (377 edges / 377 nodes,
 *     138 / 137) for the 12/24/60/120 disclosure-boundary fixtures, so
 *     those use a tree-plus-small-bump construction that lands near that
 *     ratio. The 500/2,000 and 1,000/4,000 tiers are the charter's own
 *     fixed renderer-headroom/stress targets (4.0 edge:node ratio) — those
 *     are explicitly NOT claimed to mirror corpus topology; extra
 *     cross-links are added on top of the same tree/hub backbone purely to
 *     reach the mandated link count for rendering-load characterization.
 *     This is a generator design decision, not a discovered fact, and is
 *     recorded here and in each fixture's own metadata.
 *
 * Every fixture also gets the three mandatory edge cases (one self-link,
 * one parallel-link pair, one long label) and a representative minority of
 * nodes in every one of the six semantic bands, even though production data
 * today skews overwhelmingly toward the intellectual band (bibliographic
 * records + concepts, per baseline §9's data-source matrix).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mulberry32, rngInt, rngPick, rngWeightedPick, type Rng } from "./rng";
import type {
  BakeoffFixture,
  BakeoffFixtureMeta,
  BandLayer,
  DisplayEdgeFamily,
  DisplayKind,
  FixtureLink,
  FixtureNode,
} from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

interface BandSpec {
  layer: BandLayer;
  bandIndex: number;
  kinds: DisplayKind[];
}

const BANDS: readonly BandSpec[] = [
  { layer: "evidence", bandIndex: -2, kinds: ["passage", "evidence"] },
  {
    layer: "intellectual",
    bandIndex: -1,
    kinds: ["work", "reference", "peer_reviewed_source", "online_source", "concept", "person"],
  },
  { layer: "claim", bandIndex: 0, kinds: ["claim"] },
  { layer: "debate", bandIndex: 1, kinds: ["debate", "question", "position"] },
  { layer: "learning", bandIndex: 2, kinds: ["learning_step"] },
  { layer: "research", bandIndex: 3, kinds: ["hypothesis", "gap", "writing_project"] },
];

const bandByLayer = new Map(BANDS.map((b) => [b.layer, b]));

// Leaf-node band distribution: mirrors the audited corpus's dominant
// intellectual-band share (bibliographic_record + concept = 100% of the
// two real sampled works, baseline §4) while still including a
// representative minority of every other band, per charter §13's
// "representative node kinds across the charter's six semantic bands"
// requirement.
const LEAF_BAND_WEIGHTS: ReadonlyArray<{ value: BandLayer; weight: number }> = [
  { value: "intellectual", weight: 0.55 },
  { value: "claim", weight: 0.15 },
  { value: "evidence", weight: 0.1 },
  { value: "debate", weight: 0.08 },
  { value: "learning", weight: 0.07 },
  { value: "research", weight: 0.05 },
];

const HUB_KINDS: DisplayKind[] = ["work", "concept", "reference", "person"];

interface FixtureSpec {
  name: string;
  nodeCount: number;
  /** Explicit target link count. When omitted, the natural tree+bump count
   * is used (the 12/24/60/120 corpus-mirroring tiers). */
  targetLinkCount?: number;
  seed: number;
}

const FIXTURE_SPECS: readonly FixtureSpec[] = [
  { name: "fixture-12", nodeCount: 12, seed: 0x9e12 },
  { name: "fixture-24", nodeCount: 24, seed: 0x9e24 },
  { name: "fixture-60", nodeCount: 60, seed: 0x9e60 },
  { name: "fixture-120", nodeCount: 120, seed: 0x9e12_0 },
  { name: "fixture-500", nodeCount: 500, targetLinkCount: 2000, seed: 0x9e50_0 },
  { name: "fixture-1000", nodeCount: 1000, targetLinkCount: 4000, seed: 0x9e10_00 },
];

function labelFor(kind: DisplayKind, index: number): string {
  const nouns: Partial<Record<DisplayKind, string>> = {
    work: "Uploaded Work",
    reference: "Cited Reference",
    peer_reviewed_source: "Peer-Reviewed Source",
    online_source: "Online Source",
    concept: "Concept",
    person: "Person",
    section: "Section",
    claim: "Claim",
    debate: "Debate",
    passage: "Passage",
    question: "Research Question",
    position: "Position",
    evidence: "Evidence",
    learning_step: "Learning Step",
    hypothesis: "Hypothesis",
    gap: "Research Gap",
    writing_project: "Writing Project",
    aggregate: "Aggregate",
  };
  return `${nouns[kind] ?? kind} ${index}`;
}

function familyForKind(kind: DisplayKind, rng: Rng): DisplayEdgeFamily {
  switch (kind) {
    case "work":
    case "reference":
    case "peer_reviewed_source":
    case "online_source":
    case "section":
      return rng() < 0.85 ? "reference" : "structural";
    case "concept":
    case "person":
      if (rng() < 0.75) return "influence";
      return rng() < 0.5 ? "qualification" : "opposition";
    case "claim": {
      const r = rng();
      if (r < 0.55) return "influence";
      if (r < 0.75) return "qualification";
      if (r < 0.9) return "opposition";
      return "structural";
    }
    case "debate":
    case "question":
    case "position":
      return rng() < 0.6 ? "structural" : "opposition";
    case "learning_step":
      return "prerequisite";
    case "passage":
    case "evidence":
      return rng() < 0.7 ? "reference" : "structural";
    case "hypothesis":
    case "gap":
    case "writing_project":
      return rng() < 0.6 ? "structural" : "reference";
    default:
      return "structural";
  }
}

interface BuildResult {
  nodes: FixtureNode[];
  links: FixtureLink[];
  hubIds: string[];
}

function buildGraph(spec: FixtureSpec, rng: Rng): BuildResult {
  const { nodeCount } = spec;
  const nodes: FixtureNode[] = [];
  const links: FixtureLink[] = [];

  // --- Root ---
  const rootBand = bandByLayer.get("intellectual")!;
  nodes.push({
    id: "n0",
    displayKind: "work",
    layer: rootBand.layer,
    bandIndex: rootBand.bandIndex,
    label: "Root Work",
    isRoot: true,
    isHub: false,
    degree: 0,
    unavailableReason: null,
  });

  // --- Hubs ("few hubs" per charter §13) ---
  const numHubs =
    nodeCount <= 120
      ? Math.min(4, Math.max(1, Math.round(nodeCount / 25)))
      : Math.min(12, Math.max(4, Math.round(nodeCount / 40)));
  const hubIds: string[] = [];
  for (let i = 0; i < numHubs && nodes.length < nodeCount; i++) {
    const kind = HUB_KINDS[i % HUB_KINDS.length];
    const id = `n${nodes.length}`;
    nodes.push({
      id,
      displayKind: kind,
      layer: "intellectual",
      bandIndex: -1,
      label: labelFor(kind, i + 1) + " (hub)",
      isRoot: false,
      isHub: true,
      degree: 0,
      unavailableReason: null,
    });
    hubIds.push(id);
    // Every hub attaches to root — this is what makes it a branch point.
    links.push({
      id: `e${links.length}`,
      source: "n0",
      target: id,
      displayFamily: "reference",
      directed: true,
      isSelfLink: false,
      parallelOf: null,
    });
  }

  // --- Leaves: mostly degree-1, attached to root or a hub ---
  const parentPool = ["n0", ...hubIds];
  let leafIndex = 0;
  const leafIds: string[] = [];
  while (nodes.length < nodeCount) {
    const band = bandByLayer.get(rngWeightedPick(rng, LEAF_BAND_WEIGHTS))!;
    const kind = rngPick(rng, band.kinds);
    const id = `n${nodes.length}`;
    leafIndex += 1;
    nodes.push({
      id,
      displayKind: kind,
      layer: band.layer,
      bandIndex: band.bandIndex,
      label: labelFor(kind, leafIndex),
      isRoot: false,
      isHub: false,
      degree: 0,
      // A small, deterministic minority is "cited but not held", mirroring
      // the real Library's missing-link concept (baseline §4/§9).
      unavailableReason: rng() < 0.12 ? "cited, not yet acquired" : null,
    });
    leafIds.push(id);
    const parent = nodes.length <= numHubs + 2 || rng() < 0.5 ? "n0" : rngPick(rng, parentPool);
    links.push({
      id: `e${links.length}`,
      source: parent,
      target: id,
      displayFamily: familyForKind(kind, rng),
      directed: true,
      isSelfLink: false,
      parallelOf: null,
    });
  }

  // --- Degree-2/3 minority bump, mirroring the audited 5.4% (baseline §4) ---
  const degree2Count = Math.max(1, Math.round(leafIds.length * 0.05));
  const degree3Count = Math.max(0, Math.round(leafIds.length * 0.01));
  const bumpTargets = new Set<string>();
  const shuffledLeaves = [...leafIds];
  // deterministic partial shuffle (Fisher-Yates) using the same rng
  for (let i = shuffledLeaves.length - 1; i > 0; i--) {
    const j = rngInt(rng, i + 1);
    [shuffledLeaves[i], shuffledLeaves[j]] = [shuffledLeaves[j], shuffledLeaves[i]];
  }
  let cursor = 0;
  for (let i = 0; i < degree2Count && cursor < shuffledLeaves.length; i++, cursor++) {
    bumpTargets.add(shuffledLeaves[cursor]);
    const target = shuffledLeaves[cursor];
    const existingParent = links.find((l) => l.target === target)?.source;
    const candidateParents = parentPool.filter((p) => p !== existingParent);
    const parent = candidateParents.length > 0 ? rngPick(rng, candidateParents) : "n0";
    const node = nodes.find((n) => n.id === target)!;
    links.push({
      id: `e${links.length}`,
      source: parent,
      target,
      displayFamily: familyForKind(node.displayKind, rng),
      directed: true,
      isSelfLink: false,
      parallelOf: null,
    });
  }
  // Degree-3 nodes are a THIRD edge added on top of already degree-2 nodes
  // (the first `degree3Count` entries bumped above), not a fresh set of
  // leaves getting one bump each — otherwise this would silently produce
  // more degree-2 nodes instead of the intended degree-3 minority.
  const degree3TargetCount = Math.min(degree3Count, degree2Count);
  for (let i = 0; i < degree3TargetCount; i++) {
    const target = shuffledLeaves[i];
    const existingParents = new Set(links.filter((l) => l.target === target).map((l) => l.source));
    const candidateParents = parentPool.filter((p) => !existingParents.has(p));
    const parent = candidateParents.length > 0 ? rngPick(rng, candidateParents) : "n0";
    const node = nodes.find((n) => n.id === target)!;
    links.push({
      id: `e${links.length}`,
      source: parent,
      target,
      displayFamily: familyForKind(node.displayKind, rng),
      directed: true,
      isSelfLink: false,
      parallelOf: null,
    });
  }

  // --- Fill to an explicit target link count (500/1000 headroom/stress
  // tiers only) with additional random cross-links between existing nodes,
  // reserving the last 2 slots for the mandatory self-link + parallel pair. ---
  if (spec.targetLinkCount !== undefined) {
    const reserve = 2;
    const fillTarget = spec.targetLinkCount - reserve;
    let guard = 0;
    while (links.length < fillTarget && guard < fillTarget * 20) {
      guard += 1;
      const a = rngPick(rng, nodes);
      const b = rngPick(rng, nodes);
      if (a.id === b.id) continue; // no accidental extra self-links
      const dup = links.some((l) => l.source === a.id && l.target === b.id);
      if (dup) continue;
      links.push({
        id: `e${links.length}`,
        source: a.id,
        target: b.id,
        displayFamily: familyForKind(b.displayKind, rng),
        directed: true,
        isSelfLink: false,
        parallelOf: null,
      });
    }
  }

  // --- Mandatory edge cases ---
  // One self-link, on the last leaf generated (never root/hub, so it can't
  // be mistaken for a legitimate high-degree branch point).
  const selfLinkNode = leafIds[leafIds.length - 1];
  const selfLinkId = `e${links.length}`;
  links.push({
    id: selfLinkId,
    source: selfLinkNode,
    target: selfLinkNode,
    displayFamily: "structural",
    directed: false,
    isSelfLink: true,
    parallelOf: null,
  });

  // One parallel-link pair: duplicate the very first leaf-attachment edge
  // (root/hub -> first leaf) with a distinct id and a different display
  // family, so renderers must handle two same-endpoint links, not just
  // detect+dedupe them away.
  const originalEdge = links.find((l) => !l.isSelfLink && l.parallelOf === null)!;
  const parallelId = `e${links.length}`;
  links.push({
    id: parallelId,
    source: originalEdge.source,
    target: originalEdge.target,
    displayFamily: originalEdge.displayFamily === "reference" ? "influence" : "reference",
    directed: true,
    isSelfLink: false,
    parallelOf: originalEdge.id,
  });

  // One long label, on a node that is not the root/a hub/the self-link node
  // (keeps those legible for camera/home-pose tests).
  const longLabelNode =
    leafIds.find((id) => id !== selfLinkNode) ?? leafIds[0];
  const longLabelTarget = nodes.find((n) => n.id === longLabelNode)!;
  longLabelTarget.label =
    "A deliberately long fixture label used to exercise label truncation, " +
    "collision avoidance, and two-line wrapping in the screen-space label " +
    "layer: “On the Disputed Attribution of the Fragmentary Commentary " +
    "Tradition Surrounding Book Delta of the Nicomachean Ethics”";

  return { nodes, links, hubIds };
}

function computeDegrees(nodes: FixtureNode[], links: FixtureLink[]): void {
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const l of links) {
    if (l.isSelfLink) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      continue;
    }
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  for (const n of nodes) n.degree = degree.get(n.id) ?? 0;
}

function buildMeta(spec: FixtureSpec, nodes: FixtureNode[], links: FixtureLink[], hubIds: string[]): BakeoffFixtureMeta {
  const bandCounts: Record<string, number> = {};
  for (const n of nodes) bandCounts[n.layer] = (bandCounts[n.layer] ?? 0) + 1;

  const familyCounts: Record<string, number> = {};
  for (const l of links) familyCounts[l.displayFamily] = (familyCounts[l.displayFamily] ?? 0) + 1;

  const degreeHistogram: Record<string, number> = {};
  let maxDegree = 0;
  for (const n of nodes) {
    if (n.isRoot || n.isHub) continue; // audited ceiling applies to leaves
    const bucket = n.degree >= 4 ? "4+" : String(n.degree);
    degreeHistogram[bucket] = (degreeHistogram[bucket] ?? 0) + 1;
    if (n.degree > maxDegree) maxDegree = n.degree;
  }

  const selfLink = links.find((l) => l.isSelfLink)!;
  const parallelLink = links.find((l) => l.parallelOf !== null)!;

  const longLabelNode = nodes.find((n) => n.label.length > 100)!;

  return {
    hubIds,
    selfLinkId: selfLink.id,
    parallelLinkIds: [parallelLink.parallelOf!, parallelLink.id],
    longLabelNodeId: longLabelNode.id,
    bandCounts: bandCounts as BakeoffFixtureMeta["bandCounts"],
    familyCounts: familyCounts as BakeoffFixtureMeta["familyCounts"],
    degreeHistogram,
    maxDegree,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function contentHashFor(seed: number, nodes: FixtureNode[], links: FixtureLink[]): string {
  const canonical = canonicalize({ seed, nodes, links });
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json).digest("hex");
}

function generateOne(spec: FixtureSpec): BakeoffFixture {
  const rng = mulberry32(spec.seed);
  const { nodes, links, hubIds } = buildGraph(spec, rng);
  computeDegrees(nodes, links);
  const contentHash = contentHashFor(spec.seed, nodes, links);
  const meta = buildMeta(spec, nodes, links, hubIds);

  return {
    name: spec.name,
    seed: spec.seed,
    nodeCount: nodes.length,
    linkCount: links.length,
    contentHash,
    nodes,
    links,
    meta,
  };
}

function main(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const summary: Array<{ name: string; nodeCount: number; linkCount: number; contentHash: string }> = [];

  for (const spec of FIXTURE_SPECS) {
    const fixture = generateOne(spec);
    const outPath = join(DATA_DIR, `${spec.name}.json`);
    writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
    summary.push({
      name: fixture.name,
      nodeCount: fixture.nodeCount,
      linkCount: fixture.linkCount,
      contentHash: fixture.contentHash,
    });
    // eslint-disable-next-line no-console
    console.log(
      `wrote ${outPath} (nodes=${fixture.nodeCount} links=${fixture.linkCount} hash=${fixture.contentHash.slice(0, 12)}…)`,
    );
  }

  writeFileSync(
    join(DATA_DIR, "manifest.json"),
    JSON.stringify({ generatedBy: "src/fixtures/generate.ts", fixtures: summary }, null, 2) + "\n",
    "utf8",
  );
}

main();
