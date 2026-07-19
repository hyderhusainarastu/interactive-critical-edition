import type { AgreementState, CredibilityComponents, RawResource, SourceAuthority } from "./types";
import { canonicalizeUrl } from "./normalize";

/**
 * Credibility scoring (plan §33). Authority is a deterministic function of the
 * source's nature — NEVER its popularity. A YouTube lecture with a million
 * views is not more authoritative than a peer-reviewed article; popularity only
 * ever feeds `relevance`/ranking, never `authority`.
 *
 * Authority bands:
 *   A — peer-reviewed article / canonical primary source (has a DOI from a
 *       scholarly index, or a book from an established catalogue).
 *   B — reputable secondary scholarship (indexed but weaker signal; academic
 *       books; preprints from a scholarly host).
 *   C — credible non-scholarly web (institutional/edu/gov/org domains).
 *   D — general web / video metadata without independent corroboration.
 *   E — anonymous or unverifiable (social posts, unknown authorship).
 */

const SCHOLARLY = new Set(["crossref", "openalex", "semanticscholar"]);
const BOOK_SOURCES = new Set(["openlibrary", "googlebooks"]);
const CREDIBLE_TLD = /\.(edu|gov|ac\.[a-z]{2}|edu\.[a-z]{2})$/i;
const CREDIBLE_HOST = /(^|\.)(stanford|harvard|mit|ox\.ac|cam\.ac|jstor|plato\.stanford|archive|nature|science|springer|wiley|cambridge|oup|tandfonline|sciencedirect|arxiv|philpapers)\./i;

export function classifyAuthority(r: RawResource): SourceAuthority {
  if (SCHOLARLY.has(r.provider)) {
    // A scholarly index match with a DOI on an article is the strongest signal.
    if (r.doi && (r.resourceType === "article" || r.resourceType === "book")) return "A";
    return "B";
  }
  if (BOOK_SOURCES.has(r.provider)) {
    // Catalogued books are credible secondary sources.
    return r.isbn ? "B" : "C";
  }
  if (r.provider === "tavily" || r.resourceType === "webpage") {
    const host = canonicalizeUrl(r.url)?.split("/")[0] ?? "";
    return CREDIBLE_TLD.test(host) || CREDIBLE_HOST.test(host) ? "C" : "D";
  }
  if (r.provider === "youtube" || r.resourceType === "video") return "D";
  // mastodon / bluesky / social — anonymous-by-default.
  return "E";
}

const AUTHORITY_WEIGHT: Record<SourceAuthority, number> = { A: 1, B: 0.8, C: 0.55, D: 0.3, E: 0.1 };

/** Whether a source can independently support a *factual* claim (plan §33:
 *  A/B qualifies alone; C needs a second independent C). */
export function isFactualGradeAuthority(a: SourceAuthority): boolean {
  return a === "A" || a === "B";
}

export function credibilityScore(components: {
  authority: SourceAuthority;
  relevance: number;
  evidenceStrength: number;
}): number {
  const a = AUTHORITY_WEIGHT[components.authority];
  // Authority dominates; relevance and evidence strength modulate within band.
  const score = a * 0.6 + components.relevance * 0.2 + components.evidenceStrength * 0.2;
  return Math.max(0, Math.min(1, score));
}

export function buildCredibility(
  r: RawResource,
  opts: { relevance: number; inspectionDepth: number; evidenceStrength: number },
): CredibilityComponents {
  const authority = classifyAuthority(r);
  const score = credibilityScore({ authority, relevance: opts.relevance, evidenceStrength: opts.evidenceStrength });
  const rationale =
    `authority ${authority} (${r.provider}${r.doi ? ", DOI" : ""}${r.isbn ? ", ISBN" : ""}); ` +
    `relevance ${opts.relevance.toFixed(2)}; inspection depth ${opts.inspectionDepth}; ` +
    `evidence ${opts.evidenceStrength.toFixed(2)}. Popularity excluded by design.`;
  return {
    authority,
    relevance: opts.relevance,
    inspectionDepth: opts.inspectionDepth,
    evidenceStrength: opts.evidenceStrength,
    score,
    rationale,
  };
}

/**
 * Deterministic agreement label across the independent sources bearing on a
 * claim (plan §33). "Independent" = distinct works (already deduped upstream);
 * the caller passes how many credible sources support vs. contradict.
 *   strong      — ≥3 independent supporting AND no credible contradiction
 *   contested   — ≥2 credible on each side
 *   mixed       — some credible support AND some credible contradiction,
 *                 below the contested threshold
 *   insufficient — anything else (too few credible sources either way)
 */
export function computeAgreement(supporting: number, contradicting: number): AgreementState {
  if (supporting >= 3 && contradicting === 0) return "strong";
  if (supporting >= 2 && contradicting >= 2) return "contested";
  if (supporting >= 1 && contradicting >= 1) return "mixed";
  return "insufficient";
}

/**
 * Whether a factual claim clears the evidence bar to be published as factual
 * (plan §33): at least one A/B source, OR at least two independent C sources.
 * Lower-authority material stays supplementary and cannot be the sole support.
 */
export function meetsFactualBar(authorities: SourceAuthority[]): boolean {
  if (authorities.some(isFactualGradeAuthority)) return true;
  return authorities.filter((a) => a === "C").length >= 2;
}
