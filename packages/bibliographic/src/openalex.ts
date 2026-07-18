import { titleOverlap, type BibliographicSource, type ResolvedRecord } from "./types";

interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  open_access?: { is_oa?: boolean };
  primary_location?: { landing_page_url?: string };
}

/**
 * OpenAlex (plan §6, primary source): CC0 works/authors/concepts data,
 * no key. Polite pool via OPENALEX_POLITE_POOL_EMAIL. Good coverage of
 * books and older scholarship where Crossref (DOI-centric) is thin.
 */
export class OpenAlexSource implements BibliographicSource {
  readonly name = "openalex" as const;

  async search(query: string, signal?: AbortSignal): Promise<ResolvedRecord | null> {
    const email = process.env.OPENALEX_POLITE_POOL_EMAIL;
    const params = new URLSearchParams({ search: query, per_page: "1" });
    if (email) params.set("mailto", email);

    const res = await fetch(`https://api.openalex.org/works?${params}`, { signal });
    if (!res.ok) return null;

    const data = (await res.json()) as { results?: OpenAlexWork[] };
    const work = data.results?.[0];
    const title = work?.title ?? work?.display_name;
    if (!work || !title) return null;

    if (titleOverlap(query, title) < 0.34) return null;

    const authors =
      work.authorships
        ?.map((a) => a.author?.display_name)
        .filter(Boolean)
        .join(", ") || null;

    const doi = work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//, "") : null;

    return {
      source: this.name,
      externalId: work.id ?? null,
      title,
      authors,
      year: work.publication_year ?? null,
      doi,
      url: work.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : work.id ?? null),
      accessStatus: work.open_access?.is_oa ? "open" : "metadata_only",
      raw: work,
    };
  }
}
