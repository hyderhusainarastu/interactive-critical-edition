import { canonicalizeDoi, canonicalizeIsbn, titleKey } from "./normalize";
import { stripEditionMarkers, stripReviewFraming } from "./workIdentity";

/**
 * Canonical identity service (plan §20.6) — the precedence chain that decides
 * whether two ALREADY-DERIVED work identities are in fact the same work, and
 * how an individual record relates to a work.
 *
 * This sits one level above `workIdentity.ts`: that module derives a
 * title+author `workKey` for one record; this module compares *identities*
 * (usually `work_identity` rows) using stronger evidence when it exists.
 * Precedence, strongest first:
 *
 *   1. verified DOI;
 *   2. verified ISBN (same ISBN = same edition of the same work);
 *   3. canonical external provider ID;
 *   4. normalized title + primary author + year;
 *   5. verified content hash of uploaded bytes;
 *   6. bounded fuzzy matching — SUGGESTION ONLY, never a silent merge.
 *
 * Everything here is pure: callers fetch rows, this module plans. The DB-side
 * executor (`apps/worker/src/identity/merge.ts`) records every applied merge
 * reversibly and never deletes an identity row.
 */

export type CanonicalIdentityMethod =
  | "doi"
  | "isbn"
  | "provider-id"
  | "title-author-year"
  | "content-hash";

const METHOD_PRECEDENCE: Record<CanonicalIdentityMethod, number> = {
  doi: 1,
  isbn: 2,
  "provider-id": 3,
  "title-author-year": 4,
  "content-hash": 5,
};

export interface IdentityCandidate {
  /** Stable row id (`work_identity.id`) — opaque to this module. */
  id: string;
  canonicalTitle: string;
  authorSurname: string | null;
  year?: number | null;
  doi?: string | null;
  isbn?: string | null;
  /** Canonical external provider id, e.g. "openalex:W2031754690". */
  externalId?: string | null;
  /** Verified content hashes of uploaded documents linked to this identity. */
  contentHashes?: readonly string[];
  /** Linkage counts — used only to pick a merge winner, never to match. */
  linkedWorks?: number;
  linkedResources?: number;
  createdAt?: Date | null;
}

export interface PlannedMerge {
  winnerId: string;
  loserIds: string[];
  /** The strongest method that actually connected this group. */
  method: CanonicalIdentityMethod;
  evidence: string;
}

export interface MergeSuggestion {
  leftId: string;
  rightId: string;
  /** Token-level title similarity in [0, 1]. */
  similarity: number;
  reason: string;
}

export interface IdentityCollapsePlan {
  merges: PlannedMerge[];
  suggestions: MergeSuggestion[];
  /** True when the bounded fuzzy pass hit its comparison budget — some fuzzy
   *  pairs may exist beyond what `suggestions` lists. Confident merges are
   *  never truncated. */
  fuzzyTruncated: boolean;
}

function normSurname(value: string | null | undefined): string | null {
  const s = (value ?? "").trim().toLowerCase().replace(/[^a-z'’-]/g, "");
  return s.length ? s : null;
}

function firstAuthorSurname(authors: readonly string[] | undefined): string | null {
  const first = authors?.[0];
  if (!first) return null;
  const parts = first.trim().split(/[\s,]+/).filter(Boolean);
  return normSurname(first.includes(",") ? parts[0] : parts[parts.length - 1]);
}

/** Jaccard similarity over significant title tokens. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(titleKey(a).split(" ").filter(Boolean));
  const tb = new Set(titleKey(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

interface UnionState {
  parent: Map<string, string>;
  /** Strongest (lowest-precedence-number) method seen for the group root. */
  method: Map<string, CanonicalIdentityMethod>;
  evidence: Map<string, string[]>;
}

function findRoot(state: UnionState, id: string): string {
  let cur = id;
  while (state.parent.get(cur) !== cur) cur = state.parent.get(cur)!;
  // Path compression.
  let walk = id;
  while (state.parent.get(walk) !== cur) {
    const next = state.parent.get(walk)!;
    state.parent.set(walk, cur);
    walk = next;
  }
  return cur;
}

/** Evidence strings kept per group — bounded so a 500-member debris group
 *  doesn't accumulate (and repeatedly copy) hundreds of identical lines. */
const MAX_GROUP_EVIDENCE = 12;

function union(state: UnionState, a: string, b: string, method: CanonicalIdentityMethod, evidence: string): void {
  const ra = findRoot(state, a);
  const rb = findRoot(state, b);
  const target = state.evidence.get(ra) ?? [];
  if (ra !== rb) {
    for (const line of state.evidence.get(rb) ?? []) {
      if (target.length >= MAX_GROUP_EVIDENCE) break;
      if (!target.includes(line)) target.push(line);
    }
  }
  if (target.length < MAX_GROUP_EVIDENCE && !target.includes(evidence)) target.push(evidence);
  const best = ([state.method.get(ra), state.method.get(rb), method].filter(Boolean) as CanonicalIdentityMethod[])
    .sort((x, y) => METHOD_PRECEDENCE[x] - METHOD_PRECEDENCE[y])[0];
  if (ra !== rb) {
    state.parent.set(rb, ra);
    state.method.delete(rb);
    state.evidence.delete(rb);
  }
  state.method.set(ra, best);
  state.evidence.set(ra, target);
}

/** Deterministic winner: most linked uploads, then resources, then oldest, then smallest id. */
function pickWinner(members: IdentityCandidate[]): IdentityCandidate {
  return [...members].sort((a, b) =>
    (b.linkedWorks ?? 0) - (a.linkedWorks ?? 0) ||
    (b.linkedResources ?? 0) - (a.linkedResources ?? 0) ||
    (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id),
  )[0];
}

/**
 * Plan which identities would merge (confident evidence only) and which pairs
 * are fuzzy suggestions. Nothing here writes anything; the returned plan is
 * what the dry-run report renders and what the executor applies one merge at
 * a time, reversibly.
 */
export function planIdentityCollapse(
  candidates: readonly IdentityCandidate[],
  opts: { fuzzySimilarityFloor?: number; maxSuggestions?: number; fuzzyComparisonBudget?: number } = {},
): IdentityCollapsePlan {
  const fuzzyFloor = opts.fuzzySimilarityFloor ?? 0.5;
  const maxSuggestions = opts.maxSuggestions ?? 50;
  const fuzzyComparisonBudget = opts.fuzzyComparisonBudget ?? 200_000;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const state: UnionState = {
    parent: new Map(candidates.map((c) => [c.id, c.id])),
    method: new Map(),
    evidence: new Map(),
  };

  const groupBy = (keyOf: (c: IdentityCandidate) => string | null, method: CanonicalIdentityMethod, label: string) => {
    const buckets = new Map<string, IdentityCandidate[]>();
    for (const c of candidates) {
      const key = keyOf(c);
      if (!key) continue;
      buckets.set(key, [...(buckets.get(key) ?? []), c]);
    }
    for (const [key, members] of buckets) {
      for (let i = 1; i < members.length; i++) {
        union(state, members[0].id, members[i].id, method, `${label} ${key}`);
      }
    }
  };

  // 1. Verified DOI.
  groupBy((c) => canonicalizeDoi(c.doi), "doi", "shared DOI");
  // 2. Verified ISBN — the same ISBN identifies the same edition of the same work.
  groupBy((c) => canonicalizeIsbn(c.isbn), "isbn", "shared ISBN");
  // 3. Canonical external provider id.
  groupBy((c) => (c.externalId?.trim() ? c.externalId.trim().toLowerCase() : null), "provider-id", "shared provider id");

  // 4. Normalized title + primary author + year. Conservative: both surnames
  // must agree, and years must agree or be unknown — two same-title/author
  // rows with two DIFFERENT years are probably editions, but that is a
  // suggestion, not a silent merge.
  const titleAuthor = new Map<string, IdentityCandidate[]>();
  for (const c of candidates) {
    const tk = titleKey(c.canonicalTitle);
    const surname = normSurname(c.authorSurname);
    if (!tk || !surname) continue;
    const key = `${tk}|${surname}`;
    titleAuthor.set(key, [...(titleAuthor.get(key) ?? []), c]);
  }
  const yearConflicts: MergeSuggestion[] = [];
  for (const [key, members] of titleAuthor) {
    const distinctYears = [...new Set(members.filter((m) => m.year != null).map((m) => m.year as number))].sort((a, b) => a - b);
    if (distinctYears.length <= 1) {
      // Years agree (or are unknown): the whole bucket is one work. Linear
      // chain-to-first, NOT pairwise — a large bucket must stay O(n).
      for (let i = 1; i < members.length; i++) {
        union(state, members[0].id, members[i].id, "title-author-year", `normalized title/author/year match (${key})`);
      }
      continue;
    }
    // Two or more distinct years: merge within each year cohort only, leave
    // year-null members alone (attaching them to either year would silently
    // bridge the cohorts), and surface ONE suggestion per year pair — these
    // are probably editions of one work, which is a human decision.
    const byYear = new Map<number, IdentityCandidate[]>();
    for (const m of members) {
      if (m.year == null) continue;
      byYear.set(m.year, [...(byYear.get(m.year) ?? []), m]);
    }
    for (const cohort of byYear.values()) {
      for (let i = 1; i < cohort.length; i++) {
        union(state, cohort[0].id, cohort[i].id, "title-author-year", `normalized title/author/year match (${key})`);
      }
    }
    for (let i = 0; i < distinctYears.length; i++) {
      for (let j = i + 1; j < distinctYears.length; j++) {
        yearConflicts.push({
          leftId: byYear.get(distinctYears[i])![0].id,
          rightId: byYear.get(distinctYears[j])![0].id,
          similarity: 1,
          reason: `same normalized title and author (${key.split("|")[1]}) but different years (${distinctYears[i]} vs ${distinctYears[j]}) — likely editions of one work; review before merging`,
        });
      }
    }
  }

  // 4b. Title-only fold (mirrors `groupByWork`): an identity with no author —
  // typically derived from a review record — belongs to the ONE authored
  // identity sharing its title. Ambiguity stays a suggestion.
  const authored = new Map<string, IdentityCandidate[]>();
  for (const c of candidates) {
    const tk = titleKey(c.canonicalTitle);
    if (!tk || !normSurname(c.authorSurname)) continue;
    authored.set(tk, [...(authored.get(tk) ?? []), c]);
  }
  const titleOnlySuggestions: MergeSuggestion[] = [];
  for (const c of candidates) {
    if (normSurname(c.authorSurname)) continue;
    const tk = titleKey(c.canonicalTitle);
    if (!tk) continue;
    const matches = authored.get(tk) ?? [];
    const distinctRoots = [...new Set(matches.map((m) => findRoot(state, m.id)))];
    if (distinctRoots.length === 1) {
      union(state, matches[0].id, c.id, "title-author-year", `title-only identity folded into its unique authored match (${tk})`);
    } else if (distinctRoots.length > 1) {
      titleOnlySuggestions.push({
        leftId: c.id,
        rightId: matches[0].id,
        similarity: 1,
        reason: `title-only identity matches ${distinctRoots.length} authored identities — ambiguous, needs manual review`,
      });
    }
  }

  // 5. Verified content hash of uploaded bytes.
  const byHash = new Map<string, IdentityCandidate[]>();
  for (const c of candidates) {
    for (const hash of c.contentHashes ?? []) {
      if (!hash) continue;
      byHash.set(hash, [...(byHash.get(hash) ?? []), c]);
    }
  }
  for (const [hash, members] of byHash) {
    for (let i = 1; i < members.length; i++) {
      union(state, members[0].id, members[i].id, "content-hash", `identical uploaded content hash ${hash.slice(0, 12)}…`);
    }
  }

  // Collect merge groups.
  const groups = new Map<string, IdentityCandidate[]>();
  for (const c of candidates) {
    const root = findRoot(state, c.id);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  }
  const merges: PlannedMerge[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const winner = pickWinner(members);
    merges.push({
      winnerId: winner.id,
      loserIds: members.filter((m) => m.id !== winner.id).map((m) => m.id).sort(),
      method: state.method.get(root) ?? "title-author-year",
      evidence: [...new Set(state.evidence.get(root) ?? [])].join("; "),
    });
  }
  merges.sort((a, b) => METHOD_PRECEDENCE[a.method] - METHOD_PRECEDENCE[b.method] || a.winnerId.localeCompare(b.winnerId));

  // 6. Bounded fuzzy matching — suggestion only, never a merge. Compared at
  // the group-representative level, and BLOCKED (bucketed) so the pass stays
  // usable on large tables: only representatives sharing an author surname or
  // a significant title token are ever compared, each pair once, under a hard
  // comparison budget. Everything is precomputed once per representative —
  // the naive per-pair recomputation measured 11.6s over ~1k identities.
  const suggestions: MergeSuggestion[] = [...yearConflicts, ...titleOnlySuggestions];
  const reps = [...groups.values()].map((members) => pickWinner(members));
  const repTokens = new Map(reps.map((r) => [r.id, new Set(titleKey(r.canonicalTitle).split(" ").filter(Boolean))]));
  const repSurname = new Map(reps.map((r) => [r.id, normSurname(r.authorSurname)]));
  const buckets = new Map<string, IdentityCandidate[]>();
  for (const rep of reps) {
    const surname = repSurname.get(rep.id);
    if (surname) buckets.set(`s:${surname}`, [...(buckets.get(`s:${surname}`) ?? []), rep]);
    for (const token of repTokens.get(rep.id)!) {
      buckets.set(`t:${token}`, [...(buckets.get(`t:${token}`) ?? []), rep]);
    }
  }
  const comparedPairs = new Set<string>();
  let comparisons = 0;
  let fuzzyTruncated = false;
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    return shared / (a.size + b.size - shared);
  };
  outer: for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (suggestions.length >= maxSuggestions) break outer;
        if (comparisons >= fuzzyComparisonBudget) {
          fuzzyTruncated = true;
          break outer;
        }
        const a = bucket[i];
        const b = bucket[j];
        const pairKey = a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`;
        if (comparedPairs.has(pairKey)) continue;
        comparedPairs.add(pairKey);
        comparisons++;
        const sim = jaccard(repTokens.get(a.id)!, repTokens.get(b.id)!);
        const aSurname = repSurname.get(a.id) ?? null;
        const bSurname = repSurname.get(b.id) ?? null;
        const sameAuthor = aSurname !== null && aSurname === bSurname;
        if (sim >= 1 && !sameAuthor && aSurname && bSurname) {
          // Same normalized title, two different named authors: rule 4
          // rightly refused to merge; surface it for human review instead.
          suggestions.push({
            leftId: a.id,
            rightId: b.id,
            similarity: 1,
            reason: `identical normalized titles with different authors (${aSurname} vs ${bSurname}) — never merged automatically`,
          });
          continue;
        }
        if ((sameAuthor && sim >= fuzzyFloor && sim < 1) || (!sameAuthor && sim >= 0.85 && sim < 1)) {
          suggestions.push({
            leftId: a.id,
            rightId: b.id,
            similarity: Number(sim.toFixed(3)),
            reason: sameAuthor
              ? `similar titles by the same author (similarity ${sim.toFixed(2)}) — fuzzy match, suggestion only`
              : `highly similar titles (similarity ${sim.toFixed(2)}) with different/unknown authors — fuzzy match, suggestion only`,
          });
        }
      }
    }
  }

  return { merges, suggestions: suggestions.slice(0, maxSuggestions), fuzzyTruncated };
}

/**
 * How one RECORD relates to a canonical WORK — the vocabulary plan §20.6
 * requires the service to distinguish. `confident: false` results must only
 * ever be presented as suggestions.
 */
export type WorkRelation =
  | "same_work"
  | "different_edition"
  | "review_of_work"
  | "translation_of_work"
  | "commentary_on_work"
  | "article_about_work"
  | "chapter_within_work"
  | "distinct";

export interface RecordRelationInput {
  title: string;
  authors?: readonly string[];
  year?: number | null;
  doi?: string | null;
  isbn?: string | null;
  resourceType?: string | null;
}

export interface WorkForRelation {
  canonicalTitle: string;
  authorSurname?: string | null;
  doi?: string | null;
  isbn?: string | null;
  year?: number | null;
}

export interface RecordRelationResult {
  relation: WorkRelation;
  evidence: string;
  confident: boolean;
}

const TRANSLATION_RE = /\btranslat(?:ed|ion|or)s?\b|\btrans\.\s/i;
const COMMENTARY_RE = /\bcommentar(?:y|ies)\b/i;
const CHAPTER_RE = /\bchapter\s+(?:\d+|[ivxlc]+)\b|\bch\.\s*\d+\b/i;

function tokens(title: string): Set<string> {
  return new Set(titleKey(title).split(" ").filter(Boolean));
}

function containsAll(outer: Set<string>, inner: Set<string>): boolean {
  if (!inner.size) return false;
  for (const t of inner) if (!outer.has(t)) return false;
  return true;
}

export function classifyRecordRelation(record: RecordRelationInput, work: WorkForRelation): RecordRelationResult {
  const recordDoi = canonicalizeDoi(record.doi);
  const workDoi = canonicalizeDoi(work.doi);
  if (recordDoi && workDoi && recordDoi === workDoi) {
    return { relation: "same_work", evidence: `identical DOI ${recordDoi}`, confident: true };
  }
  const recordIsbn = canonicalizeIsbn(record.isbn);
  const workIsbn = canonicalizeIsbn(work.isbn);
  if (recordIsbn && workIsbn && recordIsbn === workIsbn) {
    return { relation: "same_work", evidence: `identical ISBN ${recordIsbn} (same edition)`, confident: true };
  }

  const workTokens = tokens(work.canonicalTitle);
  const workSurname = normSurname(work.authorSurname);
  const recordSurname = firstAuthorSurname(record.authors as string[] | undefined);

  // Review framing wraps the work's own title.
  const review = stripReviewFraming(record.title);
  if (review.markers.length > 0 && containsAll(tokens(review.title), workTokens)) {
    return { relation: "review_of_work", evidence: `review framing (${review.markers.join(", ")}) around the work's title`, confident: true };
  }

  // Translation markers.
  if (TRANSLATION_RE.test(record.title)) {
    const stripped = record.title.replace(TRANSLATION_RE, " ");
    if (containsAll(tokens(stripped), workTokens) || containsAll(workTokens, tokens(stripped))) {
      return { relation: "translation_of_work", evidence: "translation marker in title around the work's title", confident: true };
    }
  }

  // Commentary on the work.
  if (COMMENTARY_RE.test(record.title) && containsAll(tokens(record.title), workTokens)) {
    return { relation: "commentary_on_work", evidence: "commentary marker in title containing the work's title", confident: true };
  }

  // A chapter within the work.
  if (CHAPTER_RE.test(record.title) && containsAll(tokens(record.title), workTokens)) {
    return { relation: "chapter_within_work", evidence: "chapter marker in title containing the work's title", confident: true };
  }

  // Edition markers stripped, remainder identical.
  const edition = stripEditionMarkers(record.title);
  if (edition.markers.length > 0) {
    const strippedTokens = tokens(edition.title);
    const authorAgrees = !workSurname || !recordSurname || workSurname === recordSurname;
    if (strippedTokens.size && containsAll(workTokens, strippedTokens) && containsAll(strippedTokens, workTokens) && authorAgrees) {
      return { relation: "different_edition", evidence: `edition marker (${edition.markers.join(", ")}) on the same title/author`, confident: true };
    }
  }

  // Exact normalized title + author.
  const recordTokens = tokens(record.title);
  if (recordTokens.size && workTokens.size && containsAll(recordTokens, workTokens) && containsAll(workTokens, recordTokens)) {
    const authorAgrees = !workSurname || !recordSurname || workSurname === recordSurname;
    if (authorAgrees) {
      if (record.year != null && work.year != null && record.year !== work.year) {
        return { relation: "different_edition", evidence: `same normalized title/author, different years (${record.year} vs ${work.year})`, confident: true };
      }
      return { relation: "same_work", evidence: "normalized title and author match", confident: true };
    }
    return { relation: "distinct", evidence: "same title but different author — not merged", confident: false };
  }

  // An article ABOUT the work: strictly contains the work's title plus more.
  if (
    (record.resourceType ?? "").toLowerCase().includes("article") &&
    workTokens.size >= 2 &&
    containsAll(recordTokens, workTokens) &&
    recordTokens.size >= workTokens.size + 2
  ) {
    return { relation: "article_about_work", evidence: "article whose title contains the work's full title plus additional topic words", confident: false };
  }

  return { relation: "distinct", evidence: "no identifier, title, or framing evidence connects this record to the work", confident: false };
}
