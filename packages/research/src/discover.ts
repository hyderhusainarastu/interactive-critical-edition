import { RESEARCH_LIMITS } from "./config";
import { dedupeResources, normalizedKey } from "./normalize";
import type { QueryLane } from "./relevance";
import type { ProviderAttempt, ProviderName, ProviderStatus, RawResource, SourceAdapter } from "./types";

export const PROVIDER_NOT_SELECTED_ERROR = "No generated discovery lane selected this provider.";

/**
 * Discovery orchestration core (plan §33). Pure over the injected adapters (which
 * are themselves mockable), so the cost/saturation/dedup guarantees are unit-
 * testable with no network. The worker supplies real adapters + LLM query
 * generation; this module owns the budget discipline.
 */

// ---- AI cost budget (never START a call projected to exceed the hard cap) ----
export interface CostBudget {
  softCapUsd: number;
  hardCapUsd: number;
  spentUsd: number;
}
export function makeBudget(
  soft = RESEARCH_LIMITS.costSoftCapUsd,
  hard = RESEARCH_LIMITS.costHardCapUsd,
): CostBudget {
  return { softCapUsd: soft, hardCapUsd: hard, spentUsd: 0 };
}
/** A call may start only if its projected cost keeps total spend within the hard cap. */
export function canAfford(b: CostBudget, projectedUsd: number): boolean {
  return b.spentUsd + projectedUsd <= b.hardCapUsd;
}
/** Past the soft cap: finish in-flight work, start no NEW discovery batches. */
export function overSoftCap(b: CostBudget): boolean {
  return b.spentUsd >= b.softCapUsd;
}
export function charge(b: CostBudget, usd: number): void {
  b.spentUsd += Math.max(0, usd);
}

// ---- Per-provider result budgets ----
export function perProviderLimit(p: ProviderName): number {
  switch (p) {
    case "youtube":
      return RESEARCH_LIMITS.maxYoutubeResults;
    case "tavily":
      return RESEARCH_LIMITS.maxWebResults;
    case "mastodon":
    case "bluesky":
      return RESEARCH_LIMITS.maxSocialResultsPerProvider;
    default:
      return 25; // scholarly per-query cap
  }
}

// Severity order so an aggregated attempt reports the most informative outcome.
const SEVERITY: Record<ProviderStatus, number> = {
  queried: 4,
  rate_limited: 3,
  failed: 2,
  unavailable: 1,
  disabled: 0,
};

function mergeAttempt(map: Map<ProviderName, ProviderAttempt>, a: ProviderAttempt): void {
  const prior = map.get(a.provider);
  if (!prior) {
    map.set(a.provider, { ...a, queries: [...a.queries] });
    return;
  }
  prior.resultCount += a.resultCount;
  prior.latencyMs += a.latencyMs;
  prior.inspectionDepth = Math.max(prior.inspectionDepth, a.inspectionDepth);
  prior.queries = [...new Set([...prior.queries, ...a.queries])];
  if (a.error && !prior.error) prior.error = a.error;
  // Prefer the more informative status (a later successful round upgrades it).
  if (SEVERITY[a.status] > SEVERITY[prior.status]) prior.status = a.status;
}

/**
 * Which providers are worth asking for a given lane. Routing is a cost control
 * AND a precision control: asking YouTube for a work's explicit citations
 * spends budget to return material the lane cannot use, and every extra
 * irrelevant result is another chance for a false positive to slip through.
 */
export function providersForLane(lane: QueryLane): ReadonlySet<ProviderName> {
  switch (lane) {
    case "lecture_course":
    case "video_podcast":
      return new Set<ProviderName>(["youtube", "tavily"]);
    case "blog_newsletter":
      return new Set<ProviderName>(["tavily"]);
    case "public_discussion":
      return new Set<ProviderName>(["mastodon", "bluesky", "tavily"]);
    case "primary_prerequisite":
      // Primary texts are catalogued as books far more often than as articles.
      return new Set<ProviderName>(["openlibrary", "googlebooks", "crossref", "openalex"]);
    default:
      return new Set<ProviderName>(["crossref", "openalex", "semanticscholar", "openlibrary", "googlebooks"]);
  }
}

/** How many of a document's own citations get an individual catalogue lookup.
 *  Bounded so a reference-heavy work cannot fan out without limit. */
const MAX_CITATION_LOOKUPS = Number(process.env.RESEARCH_MAX_CITATION_LOOKUPS ?? 30);

/** A discovery round scoped to one lane. */
export interface LaneRound {
  lane: QueryLane;
  queries: string[];
}

export interface DiscoveryResult {
  resources: RawResource[];
  attempts: ProviderAttempt[];
  saturationNote: string | null;
  rounds: number;
  /**
   * normalizedKey → the lane that FIRST surfaced the resource. First-wins
   * rather than last-wins: lanes run in priority order, so the earliest lane to
   * find something is the most specific claim about why it belongs.
   */
  laneByKey: Map<string, QueryLane>;
}

/**
 * Run successive query rounds across all adapters, accumulating deduped
 * resources until: the pre-dedup cap is hit, saturation fires (N consecutive
 * rounds each adding < the min new fraction), or the rounds are exhausted.
 * Every adapter (enabled or not) contributes exactly one aggregated attempt.
 */
export async function runDiscovery(input: {
  adapters: SourceAdapter[];
  /** Plain rounds query every adapter; lane rounds route to the providers that
   *  can actually serve the lane and tag what they find. */
  rounds: string[][] | LaneRound[];
  isRelevant?: (r: RawResource) => boolean;
  timeoutMs?: number;
}): Promise<DiscoveryResult> {
  const relevant = input.isRelevant ?? (() => true);
  const attempts = new Map<ProviderName, ProviderAttempt>();
  const laneByKey = new Map<string, QueryLane>();
  let resources: RawResource[] = [];
  let lowGrowthStreak = 0;
  let saturationNote: string | null = null;
  let roundsRun = 0;

  const normalized: LaneRound[] = input.rounds.flatMap((r) => {
    if (Array.isArray(r)) return [{ lane: undefined as unknown as QueryLane, queries: r }];
    // Adapters deliberately issue ONE query per call to stay polite with the
    // free APIs, so a lane's extra queries are never searched. That is fine for
    // exploratory lanes, where the queries are rephrasings of one question —
    // but in the explicit-citation lane every query is a DIFFERENT work the
    // document actually cites. Collapsing them to one search is why a run with
    // nine extracted citations only ever looked up the first.
    if (r.lane === "explicit_citation" && r.queries.length > 1) {
      return r.queries.slice(0, MAX_CITATION_LOOKUPS).map((q) => ({ lane: r.lane, queries: [q] }));
    }
    return [r];
  });

  for (const round of normalized) {
    const { lane, queries } = round;
    if (resources.length >= RESEARCH_LIMITS.maxResourcesPreDedup) {
      saturationNote = `Reached pre-dedup resource cap (${RESEARCH_LIMITS.maxResourcesPreDedup}).`;
      break;
    }
    roundsRun++;
    const before = resources.length;
    // A lane only queries providers that can serve it. Every adapter still
    // records an attempt across the run as a whole, so "not consulted for this
    // lane" never masquerades as "not consulted at all".
    const allowed = lane ? providersForLane(lane) : null;
    const active = allowed ? input.adapters.filter((a) => allowed.has(a.provider)) : input.adapters;
    const results = await Promise.all(
      active.map((a) =>
        a.search(queries, { maxResults: perProviderLimit(a.provider), timeoutMs: input.timeoutMs }),
      ),
    );
    for (const r of results) {
      mergeAttempt(attempts, r.attempt);
      for (const res of r.resources) {
        if (!relevant(res)) continue;
        resources.push(res);
        if (lane) {
          const key = normalizedKey({ doi: res.doi, isbn: res.isbn, url: res.url, title: res.title, authors: res.authors, year: res.year });
          if (key && !laneByKey.has(key)) laneByKey.set(key, lane);
        }
      }
    }
    resources = dedupeResources(resources).slice(0, RESEARCH_LIMITS.maxResourcesPreDedup);

    // Explicit-citation lookups are exempt from saturation: each one targets a
    // specific known work, so "this round added few new resources" means the
    // catalogue lacks that book, not that discovery has converged. Letting it
    // trip the saturation stop would abandon the remaining citations.
    if (lane === "explicit_citation") continue;

    const added = resources.length - before;
    const growth = before === 0 ? 1 : added / before;
    if (growth < RESEARCH_LIMITS.saturationMinNewFraction) {
      lowGrowthStreak++;
      if (lowGrowthStreak >= RESEARCH_LIMITS.saturationBatches) {
        saturationNote =
          `Saturated: ${lowGrowthStreak} consecutive rounds added < ` +
          `${RESEARCH_LIMITS.saturationMinNewFraction * 100}% new resources.`;
        break;
      }
    } else {
      lowGrowthStreak = 0;
    }
  }

  // Providers that never ran in ANY lane still owe the run an honest attempt
  // record — silence must never be mistaken for "nothing was found".
  for (const a of input.adapters) {
    if (attempts.has(a.provider)) continue;
    mergeAttempt(attempts, {
      provider: a.provider,
      status: a.isEnabled() ? "unavailable" : "disabled",
      queries: [],
      resultCount: 0,
      inspectionDepth: 0,
      latencyMs: 0,
      error: a.isEnabled() ? PROVIDER_NOT_SELECTED_ERROR : undefined,
    });
  }

  return { resources, attempts: [...attempts.values()], saturationNote, rounds: roundsRun, laneByKey };
}
