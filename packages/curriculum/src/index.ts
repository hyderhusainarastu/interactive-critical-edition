/**
 * Pure curriculum/study-guide construction (plan §34.4 9.6). No DB, no I/O —
 * takes the resource-role-shaped candidates for ONE work (the caller does
 * the Library-style join, see `apps/web/src/lib/curriculum.ts`) plus the
 * reader's profile, and returns a five-stage, route-filtered study guide.
 *
 * Deliberately a read-time view over data 9.4/9.5 already write and their
 * canaries already proved correct (plan §34.3 "reuse, don't rebuild") — no
 * new AI call, no new table, same posture as `@ice/roadmap` over
 * `graph_edge`. Kept pure so stage bucketing, route filtering and the
 * acyclic-ordering guarantee are deterministic Vitest units, per the
 * project's habit of proving invariants rather than asserting them (the
 * pure-function equivalent of `passage_annotation`'s DB CHECK constraint).
 */

import { KNOWN_THRESHOLD, type ReaderLevel, type RelationshipCategory, type ReadingStatus } from "@ice/roadmap";

export { KNOWN_THRESHOLD };

/**
 * The five pedagogical stages a study guide walks through, in a FIXED total
 * order — this is what makes "acyclic dependencies" true by construction:
 * every item's dependency is "finish the stages before mine", and stage
 * assignment is a pure function of relationship category, so no item can
 * ever depend on a later-or-equal stage. See `hasCycle()` below for the
 * general-purpose check this still proves against, rather than assumes.
 */
export type CurriculumStage =
  | "prerequisites"
  | "formative_context"
  | "core_engagement"
  | "interpretation_context"
  | "extension";

export const STAGE_ORDER: CurriculumStage[] = [
  "prerequisites",
  "formative_context",
  "core_engagement",
  "interpretation_context",
  "extension",
];

const STAGE_RANK: Record<CurriculumStage, number> = Object.fromEntries(
  STAGE_ORDER.map((s, i) => [s, i]),
) as Record<CurriculumStage, number>;

export const STAGE_LABEL: Record<CurriculumStage, string> = {
  prerequisites: "Prerequisites",
  formative_context: "Formative context",
  core_engagement: "Core engagement",
  interpretation_context: "Interpretation & context",
  extension: "Extension",
};

export const STAGE_DESCRIPTION: Record<CurriculumStage, string> = {
  prerequisites: "Read before the primary text — without these, the argument won't fully land.",
  formative_context: "What shaped the primary text, or what it argues against.",
  core_engagement: "Directly cited by, or written about, the primary text.",
  interpretation_context: "Situates or clarifies the primary text; helpful, not required.",
  extension: "Optional follow-up once the core is understood.",
};

// The same 10-category vocabulary `@ice/roadmap` collapses to 7 priority
// tiers, re-bucketed here to 5 pedagogical stages. Every relationship
// category maps to exactly one stage, so this is a total function.
const CATEGORY_STAGE: Record<RelationshipCategory, CurriculumStage> = {
  prerequisite: "prerequisites",
  conceptual_influence: "formative_context",
  disagreement_polemical_target: "formative_context",
  explicit_reference: "core_engagement",
  secondary_scholarly_recommendation: "core_engagement",
  historical_context: "interpretation_context",
  interpretive_aid: "interpretation_context",
  ai_inferred: "interpretation_context",
  parallel_comparison: "extension",
  optional_extension: "extension",
};

export function stageForRelationship(category: RelationshipCategory): CurriculumStage {
  return CATEGORY_STAGE[category];
}

export type CurriculumRoute = "minimal" | "university" | "graduate";
export const CURRICULUM_ROUTES: CurriculumRoute[] = ["minimal", "university", "graduate"];

export const ROUTE_LABEL: Record<CurriculumRoute, string> = {
  minimal: "Minimal",
  university: "University",
  graduate: "Graduate",
};

const ROUTE_STAGES: Record<CurriculumRoute, CurriculumStage[]> = {
  minimal: ["prerequisites", "core_engagement"],
  university: ["prerequisites", "formative_context", "core_engagement", "interpretation_context"],
  graduate: [...STAGE_ORDER],
};

const ROUTE_CAP: Record<CurriculumRoute, number> = {
  minimal: 3,
  university: 5,
  graduate: 12,
};

/** Which stages a route shows — a route only ever narrows which stages are
 *  visible, never what a later route would also include (each route's stage
 *  set is a superset of the one before it). This cumulative "route" axis is
 *  deliberately distinct from `@ice/roadmap`'s reader-level bands: a route
 *  is a pedagogical-depth choice ("how far through the five fixed stages do
 *  I go"), not a reader-level tag, and the owner's 2026-07-26
 *  mutually-exclusive-bands directive scopes only to reader_level filtering
 *  (`tiersForReaderLevel`/`matchesReaderLevel`) — it does not touch this
 *  route/stage axis, which stays intentionally cumulative. */
export function stagesForRoute(route: CurriculumRoute): Set<CurriculumStage> {
  return new Set(ROUTE_STAGES[route]);
}

/**
 * Default route from the reader's saved global level (plan §34.3 reuses
 * `users.readerLevel`) — a starting point only. Picking a route on the page
 * is a page-local filter and never writes back to the profile, the same
 * "browsing alone never silently changes a level" posture
 * `suggestReaderLevelFromCompletions` documents in `@ice/roadmap`.
 */
export function defaultRouteForReaderLevel(level: ReaderLevel | null): CurriculumRoute {
  if (level === "beginner") return "minimal";
  if (level === "research") return "graduate";
  return "university"; // undergraduate, advanced, and "not chosen" all land here
}

// Deterministic, template-based — no AI call, so no risk of a fabricated
// self-check. Same technique as `reasonFor()` in `packages/roadmap/src/index.ts`.
const CHECKPOINT: Record<RelationshipCategory, string> = {
  prerequisite: "Could you explain this source's core claim in your own words before returning to the primary text?",
  conceptual_influence: "Name one idea in the primary text that traces back to this source.",
  disagreement_polemical_target: "What is the primary text arguing against here, specifically?",
  explicit_reference: "How does this source support or complicate the primary text's argument?",
  secondary_scholarly_recommendation: "What does this scholarship add that the primary text doesn't say itself?",
  historical_context: "What changed in the intellectual landscape that this reflects?",
  interpretive_aid: "What did this clarify that the primary text left ambiguous?",
  ai_inferred: "This connection is uncertain — does it hold up once you've read the source?",
  parallel_comparison: "Where does this converge with, or diverge from, the primary text?",
  optional_extension: "What new question does this open up?",
};

export function checkpointFor(category: RelationshipCategory): string {
  return CHECKPOINT[category];
}

// Rough reading-time estimate by resource type, same "we rarely know true
// length" honesty as `@ice/roadmap`'s `estimateMinutes()`.
const RESOURCE_TYPE_MINUTES: Record<string, number> = {
  book: 600,
  article: 60,
  webpage: 15,
  video: 30,
  social_post: 5,
  dataset: 20,
  "unresolved-citation": 60,
};
const DEFAULT_MINUTES = 45;

export function estimatedMinutesForResourceType(resourceType: string): number {
  return RESOURCE_TYPE_MINUTES[resourceType] ?? DEFAULT_MINUTES;
}

export interface CurriculumCandidate {
  learningResourceId: string;
  title: string;
  authors: string[];
  year: number | null;
  resourceType: string;
  relationship: RelationshipCategory;
  /** null = "at every level", same convention as `resource_role.reader_level`. */
  readerLevel: ReaderLevel | null;
  rationale: string | null;
  confidence: number;
}

export interface ProfileEntry {
  score?: number;
  status?: ReadingStatus;
}

export interface CurriculumItem {
  learningResourceId: string;
  title: string;
  authors: string[];
  year: number | null;
  stage: CurriculumStage;
  relationship: RelationshipCategory;
  rationale: string | null;
  estimatedMinutes: number;
  /** Falls back to a stage-appropriate default when the role carries no level. */
  difficulty: ReaderLevel;
  checkpoint: string;
  confidence: number;
  /** score >= KNOWN_THRESHOLD or status completed → review-only, never removed. */
  known: boolean;
  status?: ReadingStatus;
  sequence: number;
}

export interface CurriculumStageResult {
  stage: CurriculumStage;
  label: string;
  description: string;
  items: CurriculumItem[];
  /** True when items existed for this stage but were cut by the route's cap. */
  truncated: boolean;
}

export interface CurriculumResult {
  route: CurriculumRoute;
  stages: CurriculumStageResult[];
}

const DEFAULT_DIFFICULTY_BY_STAGE: Record<CurriculumStage, ReaderLevel> = {
  prerequisites: "undergraduate",
  formative_context: "undergraduate",
  core_engagement: "advanced",
  interpretation_context: "undergraduate",
  extension: "research",
};

export function buildCurriculum(
  candidates: CurriculumCandidate[],
  profile: Map<string, ProfileEntry>,
  route: CurriculumRoute,
): CurriculumResult {
  const allowedStages = stagesForRoute(route);
  const cap = ROUTE_CAP[route];

  const byStage = new Map<CurriculumStage, CurriculumItem[]>();
  for (const stage of STAGE_ORDER) byStage.set(stage, []);

  for (const c of candidates) {
    const stage = stageForRelationship(c.relationship);
    const pe = profile.get(c.learningResourceId) ?? {};
    const known = (pe.score ?? 0) >= KNOWN_THRESHOLD || pe.status === "completed";

    byStage.get(stage)!.push({
      learningResourceId: c.learningResourceId,
      title: c.title,
      authors: c.authors,
      year: c.year,
      stage,
      relationship: c.relationship,
      rationale: c.rationale,
      estimatedMinutes: estimatedMinutesForResourceType(c.resourceType),
      difficulty: c.readerLevel ?? DEFAULT_DIFFICULTY_BY_STAGE[stage],
      checkpoint: checkpointFor(c.relationship),
      confidence: c.confidence,
      known,
      status: pe.status,
      sequence: 0,
    });
  }

  const stages: CurriculumStageResult[] = STAGE_ORDER.filter((s) => allowedStages.has(s)).map((stage) => {
    const items = byStage.get(stage)!;
    // known/review-only items sink to the bottom, same as rankRoadmap; then
    // by confidence, then title as a stable tiebreaker.
    items.sort((a, b) => {
      if (a.known !== b.known) return a.known ? 1 : -1;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.title.localeCompare(b.title);
    });
    const truncated = items.length > cap;
    const capped = items.slice(0, cap).map((it, i) => ({ ...it, sequence: i + 1 }));
    return { stage, label: STAGE_LABEL[stage], description: STAGE_DESCRIPTION[stage], items: capped, truncated };
  });

  return { route, stages };
}

/**
 * How many items each route would show for the SAME candidates — mirrors
 * `countByReaderLevel` so the route selector's counts can never drift from
 * what picking that route would actually show.
 */
export function countByRoute(
  candidates: CurriculumCandidate[],
  profile: Map<string, ProfileEntry>,
): Record<CurriculumRoute, number> {
  const counts = {} as Record<CurriculumRoute, number>;
  for (const route of CURRICULUM_ROUTES) {
    const result = buildCurriculum(candidates, profile, route);
    counts[route] = result.stages.reduce((n, s) => n + s.items.length, 0);
  }
  return counts;
}

/**
 * General-purpose cycle check over an explicit dependency graph — proves
 * "acyclic dependencies" rather than assuming it from the fixed stage order
 * above. `dependsOn` values are item ids that must come before the item
 * (its own stage's predecessor stages by default, see
 * `stageDependencyEdges()`), so this also works if item-level dependencies
 * (e.g. one concept requiring another) are added later.
 */
export function hasCycle(items: { id: string; dependsOn: string[] }[]): boolean {
  const NOT_VISITED = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const byId = new Map(items.map((i) => [i.id, i]));

  function visit(id: string): boolean {
    const s = state.get(id) ?? NOT_VISITED;
    if (s === DONE) return false;
    if (s === VISITING) return true; // back-edge found
    state.set(id, VISITING);
    const item = byId.get(id);
    if (item) {
      for (const dep of item.dependsOn) {
        if (visit(dep)) return true;
      }
    }
    state.set(id, DONE);
    return false;
  }

  for (const item of items) {
    if (visit(item.id)) return true;
  }
  return false;
}

/**
 * The dependency edges implied by stage order alone: every item in a stage
 * depends on every item in a strictly earlier stage. Trivially acyclic
 * (stage rank is a total order), asserted by `assertAcyclicStages()` so the
 * property is verified rather than just implied by the code's shape.
 */
export function stageDependencyEdges(items: CurriculumItem[]): { id: string; dependsOn: string[] }[] {
  const byEarlierStage = (stage: CurriculumStage) =>
    items.filter((i) => STAGE_RANK[i.stage] < STAGE_RANK[stage]).map((i) => i.learningResourceId);
  return items.map((i) => ({ id: i.learningResourceId, dependsOn: byEarlierStage(i.stage) }));
}

export function assertAcyclicStages(items: CurriculumItem[]): void {
  if (hasCycle(stageDependencyEdges(items))) {
    throw new Error("Curriculum stage dependencies contain a cycle — this should be structurally impossible");
  }
}
