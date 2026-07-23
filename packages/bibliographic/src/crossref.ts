import { bestTitleMatch, type BibliographicSource, type ResolvedRecord } from "./types";

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string }[];
  issued?: { "date-parts"?: number[][] };
  URL?: string;
}

// D-20-81 (D-20-68's "single-hit fragility" finding): a query built from a
// noisy, sometimes OCR-garbled full citation can rank its true match a row
// or two below Crossref's own #1 pick. Inspecting a small top-N window and
// keeping the BEST-overlap candidate (still gated by the same threshold —
// see `bestTitleMatch`) recovers that runner-up without weakening the guard.
const CANDIDATE_ROWS = 5;

/**
 * Crossref (plan §6): DOI-backed scholarly metadata. Uses the polite
 * pool (mailto) when CROSSREF_POLITE_POOL_EMAIL is set — better rate
 * limits, no key required.
 */
export class CrossrefSource implements BibliographicSource {
  readonly name = "crossref" as const;

  async search(query: string, signal?: AbortSignal): Promise<ResolvedRecord | null> {
    const email = process.env.CROSSREF_POLITE_POOL_EMAIL;
    const params = new URLSearchParams({ "query.bibliographic": query, rows: String(CANDIDATE_ROWS) });
    if (email) params.set("mailto", email);

    const res = await fetch(`https://api.crossref.org/works?${params}`, {
      headers: { "User-Agent": userAgent(email) },
      signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { message?: { items?: CrossrefItem[] } };
    const items = data.message?.items ?? [];
    const item = bestTitleMatch(query, items, (it) => it.title?.[0]);
    if (!item) return null;

    const title = item.title![0];

    const authors =
      item.author
        ?.map((a) => [a.given, a.family].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(", ") || null;

    return {
      source: this.name,
      externalId: item.DOI ?? null,
      title,
      authors,
      year: item.issued?.["date-parts"]?.[0]?.[0] ?? null,
      doi: item.DOI ?? null,
      url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : null),
      // Crossref indexes mostly paywalled journal content; treat as
      // subscription unless a later open-access check says otherwise.
      accessStatus: "subscription",
      raw: item,
    };
  }
}

function userAgent(email?: string): string {
  return `InteractiveCriticalEdition/0.1 (${email ?? "https://github.com/hyderhusainarastu/interactive-critical-edition"})`;
}
