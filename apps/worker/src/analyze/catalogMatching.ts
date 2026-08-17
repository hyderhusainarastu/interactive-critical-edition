import { db } from "@ice/db";
import { titleOverlap, type ResolvedRecord } from "@ice/bibliographic";
import { isReviewTitle } from "@ice/research";
import { sql } from "drizzle-orm";
import { type CitationMatch } from "./citationRole";

/**
 * The SAME confidence guard @ice/bibliographic's own live sources apply to
 * their single top-ranked hit (title overlap >= 0.34), reused here so a
 * catalogue/same-run reuse can never be MORE permissive than a fresh network
 * match would have been — only more available.
 */
const CATALOG_MATCH_THRESHOLD = 0.34;

/**
 * D-23-7 (Annas 1977 -> A. W. Price 1990 wrong-work link, floors
 * attempt 4): `titleOverlap` counts what fraction of the QUERY's own
 * significant words appear in a candidate's title — it says nothing about
 * whether the candidate is a MORE COMPLETE, unrelated title that happens to
 * absorb more of a garbled query's words. Reproduced deterministically: for
 * the query "Plato and Aristotle on Love and Friendship J Annas Mind 86
 * 1977", the true Annas record ("Plato and Aristotle on Friendship and
 * Altruism") scores 3/7 = 0.4286, while A. W. Price's unrelated 1990 book
 * ("Love and Friendship in Plato and Aristotle") scores 4/7 = 0.5714 — BOTH
 * clear `CATALOG_MATCH_THRESHOLD`, and `bestOverlapMatch` picked the higher
 * score, i.e. the wrong work, even in a run where the true record was also a
 * candidate. A wrong-work link is worse than unresolved (this project's
 * anti-hallucination rule): a candidate carrying a KNOWN year that
 * CONTRADICTS the citation query's own year is vetoed outright, regardless
 * of title score — an active mis-match is strictly worse than staying
 * unresolved, so it is worth rejecting a same-title-family candidate even at
 * the cost of a rarer false negative. This never makes a match MORE
 * permissive (an unknown year on either side is not evidence either way, so
 * it never disqualifies), only strictly harder to accept a wrong one. (An
 * earlier version of this guard also vetoed on author-surname disagreement;
 * that branch was removed — it false-positived on the common case of a
 * citation query carrying no author name at all, e.g. "A Catalogue-Reused
 * Work Mind 86 1988", incorrectly rejecting a same-year, correct-title
 * catalogue reuse. Year alone, which is what actually disambiguated the
 * Annas/Price case, carries the fix without that regression.)
 */
const QUERY_YEAR = /\b(1[5-9]\d{2}|20[0-2]\d)\b/g;

/** The LAST year-shaped token in a citation query — citation text is
 *  conventionally "Author, Title, Venue Year[, pages]", so the trailing year
 *  is the citation's own publication year rather than an incidental figure
 *  (a page number, a volume number) earlier in the string. */
function queryYear(query: string): number | null {
  const matches = [...query.matchAll(QUERY_YEAR)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

interface OverlapCandidate {
  title: string;
  year?: number | null;
}

/** True only on a CONCRETE year conflict — never on missing data either
 *  side, and never on anything but year (see the doc comment above). */
function yearConflictsWithQuery(query: string, candidate: OverlapCandidate): boolean {
  const qYear = queryYear(query);
  return qYear != null && candidate.year != null && qYear !== candidate.year;
}

/**
 * A candidate is disqualified — regardless of how well its title scores —
 * when its KNOWN year contradicts the citation's own year, or when it is a
 * review/notice OF a work rather than the work itself. Applied on EVERY
 * resolution path (D-23-19): the live @ice/bibliographic lookup in
 * `resolveCitationMetadata` (which previously had NO such guard at all — the
 * exact hole that linked "…J Annas … 1977" to A. W. Price's 1990 book), the
 * catalogue fallback, and the same-run discovery linker (both via
 * `bestOverlapMatch`). Precision over recall: a disqualified candidate leaves
 * the citation unresolved, never mis-linked. */
export function disqualifiesCitationMatch(query: string, candidate: OverlapCandidate): boolean {
  return yearConflictsWithQuery(query, candidate) || isReviewTitle(candidate.title);
}

export function bestOverlapMatch<T extends OverlapCandidate>(query: string, candidates: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (disqualifiesCitationMatch(query, candidate)) continue;
    const score = titleOverlap(query, candidate.title);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= CATALOG_MATCH_THRESHOLD ? best : null;
}

/** Query terms worth pre-filtering the catalogue by — short/common words
 *  would match almost every row and defeat the point of a coarse filter. */
function significantWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .sort((a, b) => b.length - a.length);
}

/**
 * D-20-68 (the Annas 1977 canary regression): a live lookup returning nothing
 * does not mean the work is unknown — the shared, append-only
 * `bibliographic_record` catalogue may already hold a confident match from an
 * earlier resolution (this citation's own prior run, or a different
 * document's), and the code previously never consulted it before giving up.
 * That is what made identical citation text resolve on one run and not the
 * next: the outcome depended entirely on one live network call's luck
 * (Crossref's `rows=1` top-hit ranking is not a stable function of the query
 * alone), with no fallback to a match already sitting in the database. This
 * coarsely pre-filters by the query's own significant words (no trigram
 * extension assumed, so bounded rather than a full-table fuzzy scan) before
 * scoring candidates with the same title-overlap guard a live match uses.
 */
export async function findCatalogMatchForQuery(query: string): Promise<{ id: string; record: CitationMatch } | null> {
  const words = significantWords(query).slice(0, 3);
  if (words.length < 2) return null;
  const conditions = words.map((word) => sql`title ilike ${`%${word}%`}`);
  const rows = (await db.execute(sql`
    SELECT id, source, external_id, title, authors, year, doi, url, access_status
    FROM bibliographic_record
    WHERE ${sql.join(conditions, sql` AND `)}
    LIMIT 20
  `)) as unknown as {
    id: string;
    source: string;
    external_id: string | null;
    title: string;
    authors: string | null;
    year: number | null;
    doi: string | null;
    url: string | null;
    access_status: ResolvedRecord["accessStatus"];
  }[];
  const match = bestOverlapMatch(query, rows);
  if (!match) return null;
  return {
    id: match.id,
    record: {
      source: `catalog:${match.source}`,
      externalId: match.external_id,
      title: match.title,
      authors: match.authors,
      year: match.year,
      doi: match.doi,
      url: match.url,
      accessStatus: match.access_status,
    },
  };
}
