import { canonicalizeDoi, canonicalizeUrl, normalizedKey } from "./normalize";

/**
 * The citation-resolution → `research_resource` bridge (floors-capability-
 * proposal §2.3). Two independent pipelines can each establish "this document
 * cites work X": the run's own discovery/acceptance loop (which writes
 * `research_resource` directly), and the separate citation-resolution
 * pathway (`resolveCitationMetadata`'s live/catalogue lookup, or
 * `linkCitationsToRunDiscoveries`'s same-run reuse) — which historically
 * wrote `citations`/Library/`graph_edge` rows but never a `research_resource`
 * row, the ONLY table the direct-source-floor gate counts.
 *
 * This module builds the row for the FIRST case only — a citation resolved
 * through a live lookup or a catalogue-match reuse, genuinely not yet
 * reflected in this run's own `research_resource` rows. It deliberately does
 * NOT cover `linkCitationsToRunDiscoveries`'s reuse path: that match is, BY
 * CONSTRUCTION, already a `research_resource` row in this exact run (that is
 * where the match came from), so bridging it again would either no-op
 * against the same key or risk a near-duplicate row for no coverage gain.
 * The worker call site only ever calls this for the genuinely-new
 * resolution, never the already-present one.
 *
 * No new lookup, no new AI cost, no fabricated credibility signal: every
 * field below is copied from data the citation-resolution pathway already
 * verified. `provider` is deliberately prefixed `citation-resolution:` (never
 * a bare provider name) so the Library/Visualization can never mistake this
 * for a fresh discovery hit — it is visibly citation-grounded provenance,
 * not dressed up as research output. Authority/credibility are left entirely
 * unset (no `credibility_assessment` row is written by this bridge) rather
 * than guessed — an honest absence, not an invented one.
 */

export type BridgeableSourceType = "bibliography" | "footnote" | "endnote" | "inline";

/** Only a genuine document-cited reference earns a bridged row — an inline
 *  mention is a weaker signal the acceptance/discovery pipeline itself never
 *  treats as an explicit citation on its own (relevance.ts). */
export function shouldBridgeCitationToResearchResource(sourceType: BridgeableSourceType): boolean {
  return sourceType !== "inline";
}

/** Minimal shape of a resolved citation match — satisfied by `CitationMatch`
 *  in `apps/worker/src/analyze.ts` (a live `@ice/bibliographic` result, a
 *  catalogue reuse, or a same-run research_resource reuse) without importing
 *  anything from the worker into this DB-free package. */
export interface CitationBridgeMatch {
  /** Honest original provenance — e.g. `"crossref"`, `"catalog:openalex"`,
   *  `"research:googlebooks"` — folded into the bridged row's `provider`. */
  source: string;
  title: string;
  /** Raw authors string, semicolon/comma/"and"-separated, as returned by
   *  `@ice/bibliographic` — parsed the same way the citation's own Library
   *  projection already does. */
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
}

export interface BridgedResearchResourceRow {
  runId: string;
  title: string;
  url: string | null;
  resourceType: "bibliographic";
  provider: string;
  accessStatus: "metadata_only";
  doi: string | null;
  isbn: null;
  canonicalUrl: string | null;
  normalizedKey: string | null;
  year: number | null;
  authors: string[];
  bibRecordId: string;
  raw: { bridgedFrom: "citation-resolution"; citationId: string; originalSource: string };
}

/** Same author-string parsing `resolvedCitationLibraryFields` already applies
 *  when projecting a resolved citation into the Library, reused here so the
 *  bridged row's `authors` array is never a second, independently-drifting
 *  implementation of the same split. */
export function parseCitationAuthors(authors: string | null): string[] {
  return authors
    ? authors.split(/\s*;\s*|\s+and\s+|\s*,\s*/).map((a) => a.trim()).filter(Boolean)
    : [];
}

/**
 * Build the bridged `research_resource` row for one resolved citation. Pure —
 * no DB, no network — so the exact provenance shape is a plain unit test; the
 * worker call site only adds the `db.insert(...).onConflictDoNothing(...)`.
 */
export function buildCitationBridgeResource(input: {
  runId: string;
  citationId: string;
  bibId: string;
  match: CitationBridgeMatch;
}): BridgedResearchResourceRow {
  const authors = parseCitationAuthors(input.match.authors);
  const doi = canonicalizeDoi(input.match.doi);
  const canonicalUrl = canonicalizeUrl(input.match.url);
  return {
    runId: input.runId,
    title: input.match.title,
    url: input.match.url,
    resourceType: "bibliographic",
    // Never a bare provider name: visibly citation-grounded, not discovery
    // output, while still preserving the underlying source for audit.
    provider: `citation-resolution:${input.match.source}`,
    accessStatus: "metadata_only",
    doi,
    isbn: null,
    canonicalUrl,
    normalizedKey: normalizedKey({ doi, url: input.match.url, title: input.match.title, authors, year: input.match.year }),
    year: input.match.year,
    authors,
    bibRecordId: input.bibId,
    raw: { bridgedFrom: "citation-resolution", citationId: input.citationId, originalSource: input.match.source },
  };
}
