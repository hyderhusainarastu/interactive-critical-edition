import { RESEARCH_LIMITS } from "./config";
import { dedupeResources } from "./normalize";
import type { ProviderAttempt, ProviderName, ProviderStatus, RawResource, SourceAdapter } from "./types";

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

export interface DiscoveryResult {
  resources: RawResource[];
  attempts: ProviderAttempt[];
  saturationNote: string | null;
  rounds: number;
}

/**
 * Run successive query rounds across all adapters, accumulating deduped
 * resources until: the pre-dedup cap is hit, saturation fires (N consecutive
 * rounds each adding < the min new fraction), or the rounds are exhausted.
 * Every adapter (enabled or not) contributes exactly one aggregated attempt.
 */
export async function runDiscovery(input: {
  adapters: SourceAdapter[];
  rounds: string[][];
  isRelevant?: (r: RawResource) => boolean;
  timeoutMs?: number;
}): Promise<DiscoveryResult> {
  const relevant = input.isRelevant ?? (() => true);
  const attempts = new Map<ProviderName, ProviderAttempt>();
  let resources: RawResource[] = [];
  let lowGrowthStreak = 0;
  let saturationNote: string | null = null;
  let roundsRun = 0;

  for (const queries of input.rounds) {
    if (resources.length >= RESEARCH_LIMITS.maxResourcesPreDedup) {
      saturationNote = `Reached pre-dedup resource cap (${RESEARCH_LIMITS.maxResourcesPreDedup}).`;
      break;
    }
    roundsRun++;
    const before = resources.length;
    const results = await Promise.all(
      input.adapters.map((a) =>
        a.search(queries, { maxResults: perProviderLimit(a.provider), timeoutMs: input.timeoutMs }),
      ),
    );
    for (const r of results) {
      mergeAttempt(attempts, r.attempt);
      for (const res of r.resources) if (relevant(res)) resources.push(res);
    }
    resources = dedupeResources(resources).slice(0, RESEARCH_LIMITS.maxResourcesPreDedup);

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

  return { resources, attempts: [...attempts.values()], saturationNote, rounds: roundsRun };
}
