/**
 * Pure reading-roadmap ranking (plan §13). No DB, no I/O — takes the
 * candidate targets reached from a root work (the caller does the graph
 * traversal), the user's knowledge profile, and their manual overrides,
 * and returns a dependency-aware, priority-ranked, personalized sequence.
 * Kept pure precisely so the plan's Heidegger/Vico acceptance cases can be
 * unit-tested deterministically (see rank.test.ts), per plan §13 step 9 /
 * §21.
 */

export type RelationshipCategory =
  | "explicit_reference"
  | "secondary_scholarly_recommendation"
  | "historical_context"
  | "prerequisite"
  | "conceptual_influence"
  | "disagreement_polemical_target"
  | "interpretive_aid"
  | "parallel_comparison"
  | "optional_extension"
  | "ai_inferred";

export type PriorityTier =
  | "essential"
  | "high"
  | "strongly_recommended"
  | "contextual"
  | "interpretive_aid"
  | "comparative"
  | "optional";

export type ReadingStatus = "planned" | "reading" | "completed" | "abandoned";

// Category → tier (plan §13 step 2). A prerequisite is essential; a work
// the text builds on or argues against is high; something merely cited or
// recommended is strongly recommended; and so on down to optional.
const CATEGORY_TIER: Record<RelationshipCategory, PriorityTier> = {
  prerequisite: "essential",
  conceptual_influence: "high",
  disagreement_polemical_target: "high",
  explicit_reference: "strongly_recommended",
  secondary_scholarly_recommendation: "strongly_recommended",
  interpretive_aid: "interpretive_aid",
  historical_context: "contextual",
  ai_inferred: "contextual",
  parallel_comparison: "comparative",
  optional_extension: "optional",
};

export const TIER_ORDER: PriorityTier[] = [
  "essential",
  "high",
  "strongly_recommended",
  "contextual",
  "interpretive_aid",
  "comparative",
  "optional",
];

const TIER_RANK: Record<PriorityTier, number> = Object.fromEntries(
  TIER_ORDER.map((t, i) => [t, i]),
) as Record<PriorityTier, number>;

export const TIER_LABEL: Record<PriorityTier, string> = {
  essential: "Essential",
  high: "High priority",
  strongly_recommended: "Strongly recommended",
  contextual: "Contextual",
  interpretive_aid: "Interpretive aid",
  comparative: "Parallel / comparison",
  optional: "Optional",
};

/** Understanding score at or above this = "working understanding"; the
 *  roadmap deprioritizes it to "review only" (plan §13 step 4). */
export const KNOWN_THRESHOLD = 60;

export interface RoadmapCandidate {
  bibId: string;
  title: string;
  authors: string | null;
  year: number | null;
  /** Every category this target was reached by (a work can be both an
   *  influence and a prerequisite); the strongest tier wins. */
  categories: RelationshipCategory[];
  /** Max classification confidence across the reaching edges (0..1). */
  confidence: number;
  /** How many of the user's works reference this target — graph centrality
   *  (plan §13 step 2: a work many things depend on ranks higher). */
  centrality: number;
  /** Fewest hops from the root work (1 = directly referenced). */
  depth: number;
  /** Rough length signal for the time estimate (book vs. article). */
  isBook: boolean;
  /** True if this target corresponds to a work already in the user's
   *  library (not a "missing link"). */
  inLibrary: boolean;
}

export interface ProfileEntry {
  /** 0..100 understanding rating, if the user set one. */
  score?: number;
  /** Reading status, if tracked. */
  status?: ReadingStatus;
}

export interface OverrideEntry {
  hidden?: boolean;
  manualTier?: PriorityTier;
  /** A hard pin: this item sorts to exactly this 1-based position. */
  manualPosition?: number;
}

export type RoadmapMode = "concise" | "comprehensive";
/**
 * Phase 9.4 (plan §34.4): the four-level reader-level vocabulary, replacing
 * the old three-level `preferences.expertise` (`intermediate` → `undergraduate`,
 * see `packages/db/src/schema.ts`'s `readerLevelEnum`). `"all"` is not a real
 * level — it is the explicit "show every tier regardless of level" override
 * the plan requires always be available (distinct from picking "research",
 * which is a level choice that happens to also resolve to every tier today).
 */
export type ReaderLevel = "beginner" | "undergraduate" | "advanced" | "research";
export const READER_LEVELS: ReaderLevel[] = ["beginner", "undergraduate", "advanced", "research"];
export type ReaderLevelFilter = ReaderLevel | "all";

export interface RankOptions {
  mode?: RoadmapMode;
  readerLevel?: ReaderLevelFilter;
  /** Time budget in minutes; a greedy pass keeps the highest-priority
   *  items that fit and marks the rest as over-budget (plan §13 step 6). */
  maxMinutes?: number;
}

export interface RoadmapItem {
  bibId: string;
  title: string;
  authors: string | null;
  year: number | null;
  tier: PriorityTier;
  /** 1-based order in the reading sequence. */
  sequence: number;
  category: RelationshipCategory;
  confidence: number;
  centrality: number;
  estimatedMinutes: number;
  /** score >= KNOWN_THRESHOLD or status completed → deprioritized to review. */
  known: boolean;
  status?: ReadingStatus;
  inLibrary: boolean;
  /** True when a manual override changed this item's tier/position/visibility. */
  overridden: boolean;
  /** Short human-readable "why this, here" line. */
  reason: string;
  overBudget: boolean;
}

/** Rough reading-time estimate — books longer than articles. Approximate
 *  by design (we rarely know true page counts); surfaced as an estimate. */
function estimateMinutes(c: RoadmapCandidate): number {
  return c.isBook ? 600 : 75;
}

function strongestCategory(categories: RelationshipCategory[]): RelationshipCategory {
  if (categories.length === 0) return "ai_inferred";
  return [...categories].sort(
    (a, b) => TIER_RANK[CATEGORY_TIER[a]] - TIER_RANK[CATEGORY_TIER[b]],
  )[0];
}

function reasonFor(category: RelationshipCategory, centrality: number, known: boolean): string {
  const base: Record<RelationshipCategory, string> = {
    prerequisite: "A prerequisite — best understood before the primary text.",
    conceptual_influence: "Shaped the ideas of the primary text.",
    disagreement_polemical_target: "The primary text argues against it.",
    explicit_reference: "Directly cited in the text.",
    secondary_scholarly_recommendation: "Scholarship about the primary text.",
    interpretive_aid: "Helps interpret a difficult part of the text.",
    historical_context: "Situates the text in its intellectual moment.",
    ai_inferred: "An inferred, uncertain connection.",
    parallel_comparison: "A comparable work worth reading alongside.",
    optional_extension: "Optional follow-up reading.",
  };
  let r = base[category];
  if (centrality > 1) r += ` Referenced across ${centrality} of your works.`;
  if (known) r = `Review only — you rated this as already understood. ${r}`;
  return r;
}

/**
 * Which tiers a given reader level sees by default (plan §13 step 6, plan
 * §34.4 9.4). Each level is a strict superset of the one before it, ending
 * at `research`/`all` = every tier — level only ever narrows the DEFAULT
 * view, never what is reachable (the caller always offers "Show all
 * levels", which resolves to `"all"` here). `undergraduate`'s set is
 * unchanged from the old three-level `intermediate` it replaces, so the one
 * production user already backfilled onto it sees no behavior change.
 */
export function tiersForReaderLevel(level: ReaderLevelFilter): Set<PriorityTier> {
  if (level === "beginner") {
    return new Set<PriorityTier>(["essential", "high", "strongly_recommended"]);
  }
  if (level === "undergraduate") {
    return new Set<PriorityTier>([
      "essential",
      "high",
      "strongly_recommended",
      "contextual",
      "interpretive_aid",
    ]);
  }
  if (level === "advanced") {
    return new Set<PriorityTier>([
      "essential",
      "high",
      "strongly_recommended",
      "contextual",
      "interpretive_aid",
      "comparative",
    ]);
  }
  // "research" and the explicit "all" override both resolve to every tier —
  // see the ReaderLevelFilter doc comment for why they're kept as distinct
  // concepts even though they agree today.
  return new Set<PriorityTier>(TIER_ORDER);
}

export function rankRoadmap(
  candidates: RoadmapCandidate[],
  profile: Map<string, ProfileEntry>,
  overrides: Map<string, OverrideEntry>,
  options: RankOptions = {},
): RoadmapItem[] {
  const mode = options.mode ?? "comprehensive";
  // Default to the full view (all tiers); reader level is an opt-in narrowing
  // filter, so the untouched roadmap shows everything reached (plan §13:
  // comprehensive is the natural default, concise/beginner narrow it).
  const readerLevel = options.readerLevel ?? "all";
  const allowedTiers = tiersForReaderLevel(readerLevel);

  type Interim = RoadmapItem & { _manualPosition?: number };
  const items: Interim[] = [];

  for (const c of candidates) {
    const ov = overrides.get(c.bibId) ?? {};
    if (ov.hidden) continue; // hidden items are excluded from the sequence

    const category = strongestCategory(c.categories);
    const baseTier = CATEGORY_TIER[category];
    const tier = ov.manualTier ?? baseTier;

    // Concise mode = essential + high only (a filter on the same ranking).
    if (mode === "concise" && TIER_RANK[tier] > TIER_RANK["high"]) continue;
    // Reader-level filter (a manual tier pin always shows through).
    if (!ov.manualTier && !allowedTiers.has(tier)) continue;

    const pe = profile.get(c.bibId) ?? {};
    const known = (pe.score ?? 0) >= KNOWN_THRESHOLD || pe.status === "completed";

    items.push({
      bibId: c.bibId,
      title: c.title,
      authors: c.authors,
      year: c.year,
      tier,
      sequence: 0,
      category,
      confidence: c.confidence,
      centrality: c.centrality,
      estimatedMinutes: estimateMinutes(c),
      known,
      status: pe.status,
      inLibrary: c.inLibrary,
      overridden: Boolean(ov.manualTier || ov.manualPosition),
      reason: reasonFor(category, c.centrality, known),
      overBudget: false,
      _manualPosition: ov.manualPosition,
    });
  }

  // Sort: known/completed items sink below unknown ones (review-only);
  // then by tier, then centrality, then confidence, then depth-ish via
  // title as a stable final tiebreaker. Manual position pins override all.
  items.sort((a, b) => {
    if (a._manualPosition != null || b._manualPosition != null) {
      const pa = a._manualPosition ?? Number.MAX_SAFE_INTEGER;
      const pb = b._manualPosition ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
    }
    if (a.known !== b.known) return a.known ? 1 : -1;
    if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (b.centrality !== a.centrality) return b.centrality - a.centrality;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.title.localeCompare(b.title);
  });

  // Time-budget pass: greedily keep the highest-priority items that fit
  // under maxMinutes; mark the rest over-budget (kept, not dropped).
  if (options.maxMinutes != null) {
    let spent = 0;
    for (const it of items) {
      if (it.known) continue; // review-only items don't consume the budget
      if (spent + it.estimatedMinutes <= options.maxMinutes) {
        spent += it.estimatedMinutes;
      } else {
        it.overBudget = true;
      }
    }
  }

  return items.map((it, i) => {
    const { _manualPosition, ...rest } = it;
    void _manualPosition;
    return { ...rest, sequence: i + 1 };
  });
}

/**
 * How many items each reader level would show for the SAME candidates —
 * the "per-level counts" the plan requires always be visible alongside the
 * level selector, so choosing a level is an informed narrowing rather than
 * a blind one (plan §34.4 9.4). Reuses `rankRoadmap` itself (cheap: no I/O,
 * just re-filtering already-fetched candidates) rather than duplicating its
 * tier/hidden-item logic, so the counts can never drift from what selecting
 * that level would actually show.
 */
export function countByReaderLevel(
  candidates: RoadmapCandidate[],
  profile: Map<string, ProfileEntry>,
  overrides: Map<string, OverrideEntry>,
  baseOptions: Omit<RankOptions, "readerLevel"> = {},
): Record<ReaderLevelFilter, number> {
  const levels: ReaderLevelFilter[] = [...READER_LEVELS, "all"];
  const counts = {} as Record<ReaderLevelFilter, number>;
  for (const level of levels) {
    counts[level] = rankRoadmap(candidates, profile, overrides, { ...baseOptions, readerLevel: level }).length;
  }
  return counts;
}
