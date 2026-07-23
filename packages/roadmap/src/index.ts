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
  /** Other catalog rows collapsed into this one by `collapseDuplicateCandidates`
   *  (D-22-2) — different editions/reviews/reprints the traversal reached
   *  as separate `bibliographic_record` rows but which name the same work.
   *  Populated by the collapse step, not by the caller. */
  mergedBibIds?: string[];
  /** True when the reader explicitly pulled this target in via the
   *  roadmap's "add a reference" search (plan §22.5 "manual add"), rather
   *  than the traversal reaching it through a classified edge. */
  addedManually?: boolean;
  /** The caller's own owned work matching this target by title, if any —
   *  lets the roadmap link straight to that work/Reader (D-22-4). */
  workId?: string | null;
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
/** Whether a selected reader-level view accumulates foundational material or
 * shows only material explicitly tagged for that level. */
export type ReaderLevelMatchMode = "cumulative" | "exact";

/**
 * Null represents universal material. A cumulative selection includes that
 * material, the selected level, and every earlier/foundational level. The
 * exact facet intentionally still includes universal material: it is not
 * tagged for a different level and must remain reachable in every view.
 */
export function matchesReaderLevel(
  materialLevel: ReaderLevel | null | undefined,
  selectedLevel: ReaderLevelFilter,
  mode: ReaderLevelMatchMode = "cumulative",
): boolean {
  if (selectedLevel === "all" || materialLevel == null) return true;
  if (mode === "exact") return materialLevel === selectedLevel;
  return READER_LEVELS.indexOf(materialLevel) <= READER_LEVELS.indexOf(selectedLevel);
}

export interface RankOptions {
  mode?: RoadmapMode;
  readerLevel?: ReaderLevelFilter;
  /** Cumulative is the default; exact preserves a depth-only facet. */
  readerLevelMode?: ReaderLevelMatchMode;
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
  /** How many other catalog rows (editions/reviews/reprints of the same
   *  work) were folded into this one item (D-22-2). 0 when this target had
   *  no duplicates. */
  mergedCount: number;
  /** True when the reader added this target manually rather than the
   *  traversal reaching it (D-22-3). */
  addedManually: boolean;
  /** The reader's own owned work matching this target, if any — lets the
   *  UI link straight to it (D-22-4). */
  workId: string | null;
}

/** Rough reading-time estimate — books longer than articles. Approximate
 *  by design (we rarely know true page counts); surfaced as an estimate. */
function estimateMinutes(c: RoadmapCandidate): number {
  return c.isBook ? 600 : 75;
}

/**
 * Same normalization the DB-side traversal already uses to match a
 * `bibliographic_record` title against an owned `work.title`
 * (`apps/web/src/lib/roadmap.ts`'s `NORM_TITLE`) — lowercase, strip
 * everything but letters/digits. Kept here as a pure, unit-testable
 * function so `collapseDuplicateCandidates` doesn't have to duplicate SQL
 * logic to decide two candidates name the same work.
 */
export function normalizeTitleForDedup(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Duplicate collapse (D-22-2, plan §22.5): the roadmap traversal reaches
 * `bibliographic_record` rows, and a single cited work can resolve to
 * several of those rows (the book itself, a review of it, a second
 * edition) — each would otherwise surface as its own roadmap item. This
 * groups candidates by normalized title and merges each group into one
 * candidate, so "duplicate collapse" holds at the level this older,
 * `bibliographic_record`-based pipeline can actually support (title
 * matching), the same honest-about-the-data posture the DB traversal
 * itself already takes for work-to-work transitivity.
 *
 * The surviving candidate per group ("primary") is chosen deterministically
 * — prefer one already in the reader's library, then the shallowest reach,
 * then the highest centrality, then a stable bibId tiebreak — so repeated
 * requests over the same data always pick the same primary. Categories are
 * unioned and confidence/centrality reflect the combined evidence, so
 * nothing the traversal found is silently dropped, only de-duplicated.
 *
 * A blank/untitled title never merges with another blank title (each
 * empty-title candidate gets its own synthetic group key), since an empty
 * normalized title is not evidence two records are the same work.
 */
export function collapseDuplicateCandidates(candidates: RoadmapCandidate[]): RoadmapCandidate[] {
  const groups = new Map<string, RoadmapCandidate[]>();
  for (const c of candidates) {
    const normalized = normalizeTitleForDedup(c.title);
    const key = normalized.length > 0 ? normalized : `__untitled__${c.bibId}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const result: RoadmapCandidate[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push({ ...group[0], mergedBibIds: group[0].mergedBibIds ?? [] });
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      if (a.inLibrary !== b.inLibrary) return a.inLibrary ? -1 : 1;
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (b.centrality !== a.centrality) return b.centrality - a.centrality;
      return a.bibId.localeCompare(b.bibId);
    });
    const [primary, ...rest] = sorted;
    result.push({
      ...primary,
      categories: [...new Set(group.flatMap((g) => g.categories))],
      confidence: Math.max(...group.map((g) => g.confidence)),
      centrality: group.reduce((sum, g) => sum + g.centrality, 0),
      depth: Math.min(...group.map((g) => g.depth)),
      inLibrary: group.some((g) => g.inLibrary),
      addedManually: group.some((g) => g.addedManually),
      workId: primary.workId ?? group.find((g) => g.workId)?.workId ?? null,
      mergedBibIds: [...rest.map((g) => g.bibId), ...rest.flatMap((g) => g.mergedBibIds ?? [])],
    });
  }
  return result;
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

/**
 * The Roadmap stores priority tiers rather than a separate role-level column.
 * Its exact facet therefore shows the tiers introduced at that depth while
 * retaining `essential` prerequisites as universal material.
 */
export function exactTiersForReaderLevel(level: ReaderLevelFilter): Set<PriorityTier> {
  if (level === "all") return new Set<PriorityTier>(TIER_ORDER);
  if (level === "beginner") return new Set<PriorityTier>(["essential", "high", "strongly_recommended"]);
  if (level === "undergraduate") return new Set<PriorityTier>(["essential", "contextual", "interpretive_aid"]);
  if (level === "advanced") return new Set<PriorityTier>(["essential", "comparative"]);
  return new Set<PriorityTier>(["essential", "optional"]);
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
  const allowedTiers = options.readerLevelMode === "exact"
    ? exactTiersForReaderLevel(readerLevel)
    : tiersForReaderLevel(readerLevel);

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

    // A manually added target wasn't reached by any classified edge, so the
    // category-based reason ("Directly cited...") isn't actually true of
    // it — say plainly that the reader chose it instead (D-22-3).
    let reason = reasonFor(category, c.centrality, known);
    if (c.addedManually) reason = `Added by you, not detected automatically. ${reason}`;

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
      reason,
      overBudget: false,
      mergedCount: (c.mergedBibIds ?? []).length,
      addedManually: Boolean(c.addedManually),
      workId: c.workId ?? null,
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

/** How many completed items at a level are enough evidence to suggest that
 *  level — deliberately conservative so one lucky completion doesn't nudge
 *  a reader who hasn't actually built up a pattern. */
const SUGGESTION_MIN_COMPLETIONS = 2;

/**
 * Suggests a higher reader level from a pattern in what the reader has
 * actually finished (plan §35.2: "reading behavior gauges reader's
 * knowledge level"), the same *inference*-not-*override* posture 9.4's
 * `inferMasteryFromCompletedWorks` already established for concept mastery —
 * evidence only ever nudges upward from what's already known, and the
 * caller (never this function) is responsible for treating the result as a
 * dismissible suggestion rather than writing it back to the profile
 * (plan §34.4: "browsing alone never silently changes a level").
 *
 * Deliberately a pure function over data the app already has (Library
 * completion status + each item's own reader level) — no new AI call and no
 * worker involvement, the same posture 9.6's Curriculum took over
 * `resource_role`/`learning_resource` (see the project log's Design
 * Decisions for the parallel).
 */
export function suggestReaderLevelFromCompletions(
  completedLevels: Array<ReaderLevel | null>,
  currentLevel: ReaderLevel | null,
): ReaderLevel | null {
  const counts: Record<ReaderLevel, number> = { beginner: 0, undergraduate: 0, advanced: 0, research: 0 };
  for (const level of completedLevels) {
    if (level) counts[level] += 1;
  }

  const currentIndex = currentLevel ? READER_LEVELS.indexOf(currentLevel) : -1;
  // Highest level first: if the reader has completed enough at "research",
  // that's the strongest signal and should win over a weaker signal at a
  // lower level.
  for (let i = READER_LEVELS.length - 1; i > currentIndex; i--) {
    const level = READER_LEVELS[i];
    if (counts[level] >= SUGGESTION_MIN_COMPLETIONS) return level;
  }
  return null;
}

/** One selected roadmap root's already-built candidates and its OWN saved
 *  overrides. `computeRoadmap` fetches overrides scoped to `(userId, rootWorkId)`,
 *  so overrides genuinely differ per root — which is what the multi-root
 *  hidden semantics below depend on (feature plan §2.4). */
export interface RootRoadmapInput {
  rootWorkId: string;
  candidates: RoadmapCandidate[];
  overrides: Map<string, OverrideEntry>;
}

export interface MergedRoadmap {
  items: RoadmapItem[];
  /** Surviving (post-collapse) bibId → the sorted, unique root work ids that
   *  reached it. Multi-root provenance for the graph annotation's
   *  `rootWorkIds` (feature plan §2.2). */
  rootWorkIdsByBib: Map<string, string[]>;
  /** Surviving bibId → the bib ids collapsed INTO it (its `mergedBibIds`).
   *  `RoadmapItem` only carries `mergedCount`, but the roadmap-graph
   *  annotation join (feature plan §2.3 step (b)) has to try every folded bib
   *  id against the graph's node ids, so the ids themselves are surfaced here. */
  mergedBibIdsByBib: Map<string, string[]>;
  /** The composed restore list: items hidden under EVERY reaching root
   *  (feature plan §2.4). An item hidden under one root but reached un-hidden
   *  by another is NOT here — it is in `items`. */
  hiddenItems: Array<{ bibId: string; title: string; authors: string | null; year: number | null }>;
}

/**
 * Merge several roots' roadmaps into one dependency-ordered sequence (feature
 * plan §2.3). This is deliberately NOT a new merge algorithm: it concatenates
 * every root's candidates and re-runs the PROVEN `collapseDuplicateCandidates`
 * (D-22-2) + `rankRoadmap` over the union, so a work shared as a prerequisite
 * of two selected roots collapses to one item exactly the way an edition and
 * its review already collapse — union categories, max confidence, summed
 * centrality, min depth, deterministic primary.
 *
 * The two things it adds on top of that reuse are both about provenance the
 * single-root pipeline never needed:
 *
 * 1. **`rootWorkIds`** — which selected roots reached each surviving item,
 *    aggregated over the item's own bibId and every bibId collapsed into it.
 * 2. **Multi-root override composition (§2.4)** — overrides are stored per
 *    `rootWorkId`, so an item hidden under root A but genuinely reached by a
 *    selected root B still appears; only items hidden under every reaching
 *    root go to the composed restore list. A manual tier/position pin is taken
 *    from the first shown (root, member) pair that carries one, deterministically.
 *
 * Accepted trade-off (feature plan §2.5, kept honest): because the reused
 * collapse sums centrality, a bib reached by two roots contributes its
 * centrality twice. Centrality only breaks ranking ties (never tier), the same
 * bib carries the same global centrality from each root, and the alternative
 * would mean forking a second collapse — so this follows the plan's explicit
 * "reuse, don't invent" instruction rather than special-casing it.
 */
export function mergeRoadmapsAcrossRoots(
  perRoot: RootRoadmapInput[],
  profile: Map<string, ProfileEntry>,
  options: RankOptions = {},
): MergedRoadmap {
  // 1) Union the raw candidates, remembering which root produced each bibId
  //    and that root's override for it (keyed per (root, bibId)).
  const rootsByBib = new Map<string, Set<string>>();
  const overrideByRootBib = new Map<string, OverrideEntry>();
  const union: RoadmapCandidate[] = [];
  for (const p of perRoot) {
    for (const c of p.candidates) {
      union.push(c);
      const roots = rootsByBib.get(c.bibId) ?? new Set<string>();
      roots.add(p.rootWorkId);
      rootsByBib.set(c.bibId, roots);
      const ov = p.overrides.get(c.bibId);
      if (ov) overrideByRootBib.set(`${p.rootWorkId} ${c.bibId}`, ov);
    }
  }

  // 2) Collapse across the union — the reused, proven D-22-2 merge.
  const collapsed = collapseDuplicateCandidates(union);

  // 3) Per survivor: reaching roots, composed override, provenance.
  const rootWorkIdsByBib = new Map<string, string[]>();
  const mergedBibIdsByBib = new Map<string, string[]>();
  const mergedOverrides = new Map<string, OverrideEntry>();
  for (const survivor of collapsed) {
    const members = [survivor.bibId, ...(survivor.mergedBibIds ?? [])];
    mergedBibIdsByBib.set(survivor.bibId, survivor.mergedBibIds ?? []);
    const reachingRoots = new Set<string>();
    for (const member of members) {
      for (const root of rootsByBib.get(member) ?? []) reachingRoots.add(root);
    }
    rootWorkIdsByBib.set(survivor.bibId, [...reachingRoots].sort());

    // Every (root, member) pair that actually occurred, with its override
    // (an absent override reads as "not hidden, no pin").
    const pairs: Array<{ root: string; member: string; ov: OverrideEntry }> = [];
    for (const root of reachingRoots) {
      for (const member of members) {
        if (!rootsByBib.get(member)?.has(root)) continue;
        pairs.push({ root, member, ov: overrideByRootBib.get(`${root} ${member}`) ?? {} });
      }
    }
    // Hidden iff every reaching pair is explicitly hidden (§2.4). A pair with
    // no override (or hidden:false) keeps the item shown.
    const hidden = pairs.length > 0 && pairs.every((pr) => pr.ov.hidden === true);
    const shownPairs = pairs
      .filter((pr) => pr.ov.hidden !== true)
      .sort((a, b) => a.root.localeCompare(b.root) || a.member.localeCompare(b.member));
    const manualTier = shownPairs.find((pr) => pr.ov.manualTier)?.ov.manualTier;
    const manualPosition = shownPairs.find((pr) => pr.ov.manualPosition != null)?.ov.manualPosition;
    mergedOverrides.set(survivor.bibId, { hidden, manualTier, manualPosition });
  }

  // 4) Rank once over the collapsed union with the composed overrides.
  const items = rankRoadmap(collapsed, profile, mergedOverrides, options);

  // 5) Composed restore list: survivors hidden under every reaching root.
  const hiddenItems = collapsed
    .filter((survivor) => mergedOverrides.get(survivor.bibId)?.hidden)
    .map((survivor) => ({ bibId: survivor.bibId, title: survivor.title, authors: survivor.authors, year: survivor.year }));

  return { items, rootWorkIdsByBib, mergedBibIdsByBib, hiddenItems };
}
