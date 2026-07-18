import { titleOverlap, type BibliographicSource, type ResolvedRecord } from "./types";

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string }[];
  issued?: { "date-parts"?: number[][] };
  URL?: string;
}

/**
 * Crossref (plan §6): DOI-backed scholarly metadata. Uses the polite
 * pool (mailto) when CROSSREF_POLITE_POOL_EMAIL is set — better rate
 * limits, no key required.
 */
export class CrossrefSource implements BibliographicSource {
  readonly name = "crossref" as const;

  async search(query: string, signal?: AbortSignal): Promise<ResolvedRecord | null> {
    const email = process.env.CROSSREF_POLITE_POOL_EMAIL;
    const params = new URLSearchParams({ "query.bibliographic": query, rows: "1" });
    if (email) params.set("mailto", email);

    const res = await fetch(`https://api.crossref.org/works?${params}`, {
      headers: { "User-Agent": userAgent(email) },
      signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { message?: { items?: CrossrefItem[] } };
    const item = data.message?.items?.[0];
    if (!item?.title?.[0]) return null;

    const title = item.title[0];
    if (titleOverlap(query, title) < 0.34) return null;

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
