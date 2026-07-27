/**
 * Frozen-fixture data contract for the renderer bakeoff (charter §9, §13).
 *
 * This is a *display*-level contract, deliberately separate from the real
 * application's canonical `GraphNode`/`GraphLink` types — the bakeoff is
 * about renderer/camera/interaction behavior, not re-deriving the production
 * graph adapter. Both prototypes and the bench runner consume exactly this
 * shape and nothing else.
 */

/** Canonical nine-value NodeType union (mirrors apps/web's graph contract),
 * plus the charter §9 additive display kinds. */
export type DisplayKind =
  | "work"
  | "reference"
  | "peer_reviewed_source"
  | "online_source"
  | "concept"
  | "person"
  | "section"
  | "claim"
  | "debate"
  | "passage"
  | "question"
  | "position"
  | "evidence"
  | "learning_step"
  | "hypothesis"
  | "gap"
  | "writing_project"
  | "aggregate";

/** The six semantic depth bands (charter §8). */
export type BandLayer =
  | "evidence"
  | "intellectual"
  | "claim"
  | "debate"
  | "learning"
  | "research";

/** Canonical five-value EdgeFamily, unchanged, plus the additive
 * display-only `qualification` distinction (charter §10). */
export type DisplayEdgeFamily =
  | "reference"
  | "prerequisite"
  | "influence"
  | "opposition"
  | "structural"
  | "qualification";

export interface FixtureNode {
  id: string;
  displayKind: DisplayKind;
  layer: BandLayer;
  /** -2..3, see charter §8. */
  bandIndex: number;
  label: string;
  /** True for exactly one node per fixture: the entry/root context node. */
  isRoot: boolean;
  /** True for the small number of "few hubs" branch-point nodes (charter
   * §13's "wide shallow tree" topology). */
  isHub: boolean;
  /** Precomputed at generation time from the final link set — the count of
   * links touching this node (undirected degree), for bench/topology
   * assertions without re-deriving it at runtime. */
  degree: number;
  /** Present (non-null) only for the "missing/cited-only" minority, mirroring
   * the real corpus's held/unheld distinction; unused by the camera-math
   * layer but kept for prototype fidelity. */
  unavailableReason: string | null;
}

export interface FixtureLink {
  id: string;
  source: string;
  target: string;
  displayFamily: DisplayEdgeFamily;
  directed: boolean;
  isSelfLink: boolean;
  /** id of the link this one deliberately parallels (same source/target),
   * null for every other link. */
  parallelOf: string | null;
}

export interface BakeoffFixtureMeta {
  hubIds: string[];
  selfLinkId: string;
  parallelLinkIds: [string, string];
  longLabelNodeId: string;
  bandCounts: Record<BandLayer, number>;
  familyCounts: Record<DisplayEdgeFamily, number>;
  degreeHistogram: Record<string, number>;
  maxDegree: number;
}

export interface BakeoffFixture {
  /** Fixture name, e.g. "fixture-12". Matches the JSON filename stem. */
  name: string;
  /** Seed passed to the deterministic PRNG (mulberry32) that produced this
   * fixture. Regenerating with this seed via `generate.ts` reproduces byte
   * identical nodes/links. */
  seed: number;
  nodeCount: number;
  linkCount: number;
  /** sha256 of the canonicalized {seed, nodes, links} payload (this field
   * excluded), hex-encoded. Verifies the fixture hasn't drifted from its
   * seed and lets both prototypes assert they were handed byte-identical
   * data. */
  contentHash: string;
  nodes: FixtureNode[];
  links: FixtureLink[];
  meta: BakeoffFixtureMeta;
}

/** The fixed set of fixture names both prototypes and the bench runner
 * address by name (charter §13's mandatory/headroom/stress tiers). */
export const FIXTURE_NAMES = [
  "fixture-12",
  "fixture-24",
  "fixture-60",
  "fixture-120",
  "fixture-500",
  "fixture-1000",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];
