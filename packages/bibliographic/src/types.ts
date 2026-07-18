/**
 * Bibliographic resolution adapters (plan §11). Every external source
 * sits behind the same `BibliographicSource` interface and normalizes
 * into one `ResolvedRecord` shape, so the pipeline never depends on a
 * specific vendor's JSON. All sources here are free and keyless
 * (OpenAlex/Crossref/Open Library), so this stage works in local dev and
 * CI with no secrets — unlike the AI stage, it isn't stubbed.
 *
 * The anti-hallucination rule (plan §11/§12): a bibliographic fact
 * (title/author/year/DOI) may ONLY come from a real lookup here, never
 * from an LLM. An unmatched citation stays unresolved rather than being
 * guessed.
 */

export type BibSourceName = "crossref" | "openalex" | "openlibrary";

export type AccessStatus =
  | "open"
  | "subscription"
  | "metadata_only"
  | "user_uploaded"
  | "unavailable";

export interface ResolvedRecord {
  source: BibSourceName;
  externalId: string | null;
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  accessStatus: AccessStatus;
  raw: unknown;
}

export interface BibliographicSource {
  readonly name: BibSourceName;
  search(query: string, signal?: AbortSignal): Promise<ResolvedRecord | null>;
}

/**
 * Cheap confidence guard against a wrong match: require that a meaningful
 * fraction of the query's significant words appear in the candidate
 * title. Crossref/OpenAlex will always return *something* for a query;
 * this stops us attaching an unrelated record to a citation (which would
 * be a provenance lie). Returns a 0..1 overlap score.
 */
export function titleOverlap(query: string, title: string): number {
  const sig = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const q = sig(query);
  const t = sig(title);
  if (q.size === 0 || t.size === 0) return 0;
  let hits = 0;
  for (const w of q) if (t.has(w)) hits++;
  return hits / q.size;
}
