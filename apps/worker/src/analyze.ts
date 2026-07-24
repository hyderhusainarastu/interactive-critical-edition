import {
  aiUsageLogs,
  annotations,
  bibliographicRecords,
  citations,
  citationLibraryLinks,
  claimEvidence,
  concepts as conceptsTable,
  db,
  documents,
  documentApparatus,
  docMetadata,
  editionRelations,
  evidenceSpans,
  generatedClaims,
  generatedNotes,
  graphEdges,
  passageAnnotations,
  processingRuns,
  providerAttempts,
  researchCache,
  researchResources,
  researchResourceContents,
  researchCandidates,
  credibilityAssessments,
  resourceProvenance,
  works,
  workClaims,
  workIdentities,
  learningResources,
  resourceRoles,
  enqueueCitationMetadataResolution,
} from "@ice/db";
import {
  classifyRelationship,
  CLASSIFY_PROMPT_VERSION,
  estimateCostUsd,
  OpenAIResponsesClient,
  RELATIONSHIP_CATEGORIES,
  safetyIdentifierFor,
  type CitationFrequencySignal,
  type RelationshipCategory,
} from "@ice/ai-adapters";
import { resolveCitation, titleOverlap, type ResolvedRecord } from "@ice/bibliographic";
import { extractCitationMentions, extractCitations, type CitationSourceInput, type ExtractedAuthorApparatus, type RawCitation } from "@ice/ingestion";
import { reportError, reportEvent } from "@ice/observability";
import { createHash } from "node:crypto";
import {
  allAdapters,
  buildCredibility,
  assessCredibilityV3,
  publicationRigor,
  structuralEvidenceStrength,
  canAfford,
  canonicalizeDoi,
  canonicalizeIsbn,
  canonicalizeUrl,
  charge,
  classifyAuthority,
  computeAgreement,
  generateLaneQueries,
  heuristicNote,
  makeBudget,
  meetsFactualBar,
  normalizedKey,
  overSoftCap,
  RESEARCH_LIMITS,
  runDiscovery,
  assessCandidate,
  buildTopicSignature,
  laneForResource,
  citedSurnamesFrom,
  deriveWorkIdentity,
  type WorkIdentity,
  type WorkIdentityKey,
  synthesizeConcepts,
  synthesizeNote,
  synthesizePassageAnnotations,
  annotationScope,
  chunkSectionAwareBlocks,
  dedupePassageAnnotations,
  type SectionAwareBlock,
  withCache,
  type CacheStore,
  type RawResource,
  type SourceAuthority,
  findOpenAccessEvidence,
  retrieveOpenAccessText,
  selectForFullInspection,
  buildCitationBridgeResource,
  shouldBridgeCitationToResearchResource,
} from "@ice/research";
import { and, eq, gt, isNotNull, ne, sql } from "drizzle-orm";
import { buildStructuralCitationSources } from "./citationSources";
import { conservativeInfluenceClassification, verifyCreatorFromProviderMetadata } from "./v3";
import { compactWorkSignal, persistV4WorkSignals } from "./v4";

/**
 * Scholarly-analysis pipeline (plan §10–§12), the two-stage design:
 *   Stage 1 (cheap, deterministic, no AI): extract candidate citations
 *     from the text and resolve each against real bibliographic sources.
 *   Stage 2 (expensive): classify each candidate's relationship to the
 *     primary work into one of the 10 categories, with a real model when
 *     a key is configured, else the deterministic heuristic fallback.
 *
 * Every annotation is written with full provenance (model, prompt
 * version, extracted source text, confidence) and starts `unreviewed` so
 * the user can approve/reject/edit/hide it (plan §12). Re-running is
 * idempotent: prior *system* annotations/citations/edges for the
 * document are cleared first, but user-created annotations are preserved.
 */

// relationship_category → graph edge_type (plan §9 vocabulary). Only
// resolved candidates (with a real target record) get a graph edge, so
// Phase 5's roadmap traversal never points at a phantom node.
const CATEGORY_TO_EDGE: Record<RelationshipCategory, Parameters<typeof edgeValue>[0]> = {
  explicit_reference: "cites",
  secondary_scholarly_recommendation: "is_recommended_by",
  historical_context: "provides_context_for",
  prerequisite: "is_prerequisite_for",
  conceptual_influence: "influences",
  disagreement_polemical_target: "disagrees_with",
  interpretive_aid: "interprets",
  parallel_comparison: "is_comparable_to",
  optional_extension: "is_recommended_by",
  ai_inferred: "provides_context_for",
};

function edgeValue(
  t:
    | "cites"
    | "quotes"
    | "influences"
    | "criticizes"
    | "responds_to"
    | "presupposes"
    | "provides_context_for"
    | "interprets"
    | "disagrees_with"
    | "translates"
    | "is_edition_of"
    | "is_prerequisite_for"
    | "is_comparable_to"
    | "is_recommended_by",
) {
  return t;
}

interface TextAnchor {
  kind: "text";
  paragraphIndex: number;
  quote: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 40;

/**
 * How many citations to process at once. Each citation is one live
 * bibliographic lookup (I/O-bound, up to an 8s timeout) plus one
 * classification call plus a few inserts — so processing them
 * concurrently cuts wall-clock time dramatically for a large reference
 * list. Kept modest (6) to stay polite with the free bibliographic APIs'
 * rate limits and comfortably under the postgres.js connection pool
 * (default 10), which the inserts share.
 */
const ANALYSIS_CONCURRENCY = 6;

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, using a
 * fixed pool of workers pulling from a shared cursor. Preserves the
 * simple "process each candidate" shape while bounding concurrency — no
 * external dependency needed.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/**
 * Locate a needle (typically the candidate's author surname) in the
 * body and build a highlight-shaped anchor so the reader can render an
 * inline marker. Paragraph splitting mirrors TextReader exactly
 * (split on blank lines) so paragraphIndex aligns. Text/Markdown only —
 * PDF page anchoring needs positional data the merged-text extraction
 * doesn't carry, so PDF annotations are created work-level (anchor null)
 * and shown in the sidebar, not as inline markers (documented limitation).
 */
function buildTextAnchor(
  paragraphs: string[],
  needle: string,
): { anchor: TextAnchor; sourceText: string } | null {
  if (!needle) return null;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const idx = p.indexOf(needle);
    if (idx === -1) continue;
    const quote = p.slice(idx, idx + needle.length);
    const prefix = p.slice(Math.max(0, idx - CONTEXT), idx);
    const suffix = p.slice(idx + needle.length, idx + needle.length + CONTEXT);
    return {
      anchor: { kind: "text", paragraphIndex: i, quote, prefix, suffix },
      sourceText: p.trim().slice(0, 600),
    };
  }
  return null;
}

/** First capitalized word of a citation — a usable anchoring needle
 *  (author surname) and target label seed. */
function leadingSurname(query: string): string {
  const m = query.match(/^([A-Z][A-Za-zÀ-ÿ'’-]{2,})/);
  return m ? m[1] : "";
}

function normalizeFrequencyText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueFrequencyTerms(title: string, authors: string[] | string | null): string[] {
  const terms = new Set<string>();
  const normalizedTitle = normalizeFrequencyText(title);
  if (normalizedTitle.length >= 5) terms.add(normalizedTitle);

  // "Aristotle, Nicomachean Ethics" should count both the full label and the
  // title-bearing part; the author surname is added below.
  for (const part of title.split(/[:,.;]/)) {
    const normalized = normalizeFrequencyText(part);
    if (normalized.length >= 5 && normalized !== normalizedTitle) terms.add(normalized);
  }

  const authorList = Array.isArray(authors) ? authors : authors ? authors.split(/[,;]/) : [];
  for (const author of authorList) {
    const words = normalizeFrequencyText(author).split(/\s+/).filter(Boolean);
    const surname = words.at(-1);
    if (surname && surname.length >= 4) terms.add(surname);
  }

  return [...terms];
}

function countTermMentions(haystack: string, term: string): number {
  if (!haystack || !term) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const found = haystack.indexOf(term, from);
    if (found === -1) break;
    const before = found === 0 ? " " : haystack[found - 1];
    const after = found + term.length >= haystack.length ? " " : haystack[found + term.length];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) count++;
    from = found + Math.max(1, term.length);
  }
  return count;
}

function citationFrequencyFor(
  candidate: { title: string; authors: string[] | string | null },
  documentText: string,
  citationTexts: string[],
): CitationFrequencySignal {
  const terms = uniqueFrequencyTerms(candidate.title, candidate.authors);
  const normalizedDocument = normalizeFrequencyText(documentText);
  const normalizedCitations = citationTexts.map(normalizeFrequencyText).join(" ");
  const matchedTerms: string[] = [];
  let documentMentions = 0;
  let citationMentions = 0;

  for (const term of terms) {
    const docCount = countTermMentions(normalizedDocument, term);
    const citationCount = countTermMentions(normalizedCitations, term);
    if (docCount > 0 || citationCount > 0) matchedTerms.push(term);
    documentMentions += docCount;
    citationMentions += citationCount;
  }

  return { documentMentions, citationMentions, total: documentMentions + citationMentions, matchedTerms };
}

/** A concise human-readable target label for the annotation, even when
 *  unresolved (plan §12: never drop the citation). */
function targetLabel(candidate: RawCitation, record: ResolvedRecord | null): string {
  if (record) {
    return record.authors ? `${record.title} — ${record.authors}` : record.title;
  }
  return candidate.text.slice(0, 200);
}

async function findOrCreateBibRecord(record: ResolvedRecord): Promise<string> {
  // Canonical identity has a deliberate, conservative precedence order. Do
  // not merge Aristotle/Plato works merely because their author matches: the
  // final fallback requires normalized title + author + year together.
  const doi = canonicalizeDoi(record.doi);
  const isbn = canonicalizeIsbn(record.externalId);
  const canonicalUrl = canonicalizeUrl(record.url);
  if (doi) {
    const [existing] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.doi, doi))
      .limit(1);
    if (existing) return existing.id;
  }
  if (isbn ?? record.externalId) {
    const [existing] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.externalId, isbn ?? record.externalId!))
      .limit(1);
    if (existing) return existing.id;
  }
  if (canonicalUrl || record.url) {
    const [existing] = await db.execute(sql`
      SELECT id FROM bibliographic_record
      WHERE url = ${canonicalUrl ?? record.url} OR url = ${record.url ?? canonicalUrl}
      LIMIT 1
    `) as unknown as { id: string }[];
    if (existing) return existing.id;
  }
  if (record.title.trim() && record.authors?.trim() && record.year != null) {
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
    const [existing] = await db.execute(sql`
      SELECT id FROM bibliographic_record
      WHERE regexp_replace(lower(title), '[^a-z0-9]', '', 'g') = ${normalize(record.title)}
        AND regexp_replace(lower(COALESCE(authors, '')), '[^a-z0-9]', '', 'g') = ${normalize(record.authors)}
        AND year = ${record.year}
      LIMIT 1
    `) as unknown as { id: string }[];
    if (existing) return existing.id;
  }

  const [created] = await db
    .insert(bibliographicRecords)
    .values({
      source: record.source,
      externalId: isbn ?? record.externalId,
      title: record.title,
      authors: record.authors,
      year: record.year,
      doi,
      url: canonicalUrl ?? record.url,
      accessStatus: record.accessStatus,
      raw: record.raw,
    })
    .returning({ id: bibliographicRecords.id });
  return created.id;
}

function citationIdentityKey(query: string): string {
  return `citation:${createHash("sha256").update(query.trim().toLocaleLowerCase()).digest("hex")}`;
}

function citationSourceLabel(sourceType: "bibliography" | "footnote" | "endnote" | "inline"): string {
  return sourceType === "bibliography" ? "Bibliography" : sourceType === "footnote" ? "Footnote" : sourceType === "endnote" ? "Endnote" : "Direct citation";
}

function citationRoleRationale(citation: RawCitation): string {
  const anchor = citation.anchor;
  const page = anchor?.pageIndex != null ? ` page ${anchor.pageIndex + 1}` : "";
  const marker = anchor?.marker ? ` note ${anchor.marker}` : "";
  return `${citationSourceLabel(citation.sourceType ?? "inline")}${page}${marker}: ${citation.text}`.slice(0, 2_000);
}

export async function ensureCitationRole(input: {
  learningResourceId: string;
  workIdentityId: string;
  citation: RawCitation;
  /**
   * The citation this role belongs to. Set on the concurrency-prone
   * resolution paths (`applyResolvedCitation`, `createCitationLibraryProjection`)
   * so a role whose target learning_resource was concurrently MERGED AWAY
   * can be re-pointed to the citation's CURRENT surviving row instead of
   * crashing the whole edition run on a phantom FK. See the 23503 handling
   * below for the full rationale. Omit only when the caller provably holds a
   * freshly-created, non-mergeable target.
   */
  citationId?: string;
}): Promise<void> {
  const insertRole = (learningResourceId: string) =>
    db
      .insert(resourceRoles)
      .values({
        learningResourceId,
        workIdentityId: input.workIdentityId,
        relationship: "explicit_reference",
        readerLevel: null,
        rationale: citationRoleRationale(input.citation),
        confidence: input.citation.parserConfidence ?? 0,
        createdBy: "system",
      })
      .onConflictDoUpdate({
        target: [resourceRoles.learningResourceId, resourceRoles.workIdentityId, resourceRoles.readerLevel],
        set: {
          relationship: "explicit_reference",
          rationale: citationRoleRationale(input.citation),
          confidence: input.citation.parserConfidence ?? 0,
        },
      });

  try {
    await insertRole(input.learningResourceId);
  } catch (error) {
    // Phantom-FK guard (2026-07-23 resource_role FK-violation incident,
    // run b2750c63): `applyResolvedCitation` and `resolveCitationMetadata`
    // run CONCURRENTLY on separate pg-boss queues within one document's
    // pipeline, and both call this via a read-modify-write that is not atomic
    // across the two paths. One path can read a citation's target
    // learning_resource id, and — before this insert fires — a parallel path's
    // `applyResolvedCitation` merge (its stub delete, analyze.ts ~L631) can
    // delete exactly that row, having first repointed every citationLibraryLink
    // off it onto the surviving canonical row. The insert then violates the
    // learning_resource FK (Postgres 23503) with a genuinely-gone id. e48cb1a
    // unmasked this: before it, the research_resource duplicate-key crash
    // killed the run long before `linkCitationsToRunDiscoveries` ever ran, so
    // this pre-existing race was unreachable. This is a benign race, not
    // corruption, so recover rather than crash the whole edition. Drizzle
    // nests the driver error under `.cause` (documented pg/Drizzle gotcha).
    const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
    const isLearningResourceFk =
      cause?.code === "23503" && (!cause.constraint_name || cause.constraint_name.includes("learning_resource"));
    if (!isLearningResourceFk || !input.citationId) throw error;

    // Re-resolve to the citation's CURRENT link: the concurrent merge repoints
    // every citationLibraryLink off the deleted stub onto the surviving
    // canonical row BEFORE deleting the stub, so this is the live, non-phantom
    // target — exactly "re-resolve the existing row's id, not the phantom id".
    const [link] = await db
      .select({ id: citationLibraryLinks.learningResourceId })
      .from(citationLibraryLinks)
      .where(eq(citationLibraryLinks.citationId, input.citationId))
      .limit(1);
    if (link && link.id !== input.learningResourceId) {
      try {
        await insertRole(link.id);
        return;
      } catch (retryError) {
        const rc = (retryError as { cause?: { code?: string } }).cause;
        if (rc?.code !== "23503") throw retryError;
      }
    }
    // Even the re-resolved target is gone (or unchanged): the surviving row the
    // merge kept already carries this (resource, work) role — it is keyed on
    // exactly (learning_resource, work_identity, reader_level) — so dropping
    // this now-redundant one is correct. Stay visible without crashing,
    // mirroring e48cb1a's research_resource duplicate-skip pattern.
    reportEvent("citation_role_target_merged_away", {
      scope: "worker.ensureCitationRole",
      citationId: input.citationId,
      workIdentityId: input.workIdentityId,
      deletedLearningResourceId: input.learningResourceId,
    });
  }
}

/**
 * Citation projection deliberately happens before any catalogue lookup or AI
 * stage. The exact source citation becomes a visible Library item immediately;
 * a later resolver may enrich it, but a provider failure can never erase it.
 */
export async function createCitationLibraryProjection(input: {
  citationId: string;
  citation: RawCitation;
  workIdentityId: string;
}): Promise<string> {
  const normalizedKey = citationIdentityKey(input.citation.query);
  const [resource] = await db
    .insert(learningResources)
    .values({
      normalizedKey,
      title: `Needs bibliographic resolution — ${input.citation.text}`.slice(0, 2_000),
      resourceType: "unresolved-citation",
      provider: "citation-extraction",
      authors: [],
    })
    .onConflictDoUpdate({
      target: learningResources.normalizedKey,
      set: {
        title: `Needs bibliographic resolution — ${input.citation.text}`.slice(0, 2_000),
        resourceType: "unresolved-citation",
        provider: "citation-extraction",
        updatedAt: new Date(),
      },
    })
    .returning({ id: learningResources.id });

  await ensureCitationRole({ learningResourceId: resource.id, workIdentityId: input.workIdentityId, citation: input.citation, citationId: input.citationId });
  await db
    .insert(citationLibraryLinks)
    .values({ citationId: input.citationId, learningResourceId: resource.id })
    .onConflictDoUpdate({
      target: citationLibraryLinks.citationId,
      set: { learningResourceId: resource.id },
    });
  return resource.id;
}

/**
 * A citation match's minimal shape, satisfied by a live @ice/bibliographic
 * `ResolvedRecord`, a shared-catalogue row, or a same-run `research_resource`
 * row — the three sources `resolveCitationMetadata` and
 * `linkCitationsToRunDiscoveries` can now resolve a citation from. Widened
 * from `ResolvedRecord.source` (which is only the three live-lookup provider
 * names) to a plain `string` so a catalogue/same-run reuse can honestly
 * record ITS OWN provenance (`catalog:<original source>` /
 * `research:<provider>`) instead of masquerading as a fresh live lookup.
 */
type CitationMatch = Omit<ResolvedRecord, "source" | "raw"> & { source: string };

function resolvedCitationLibraryFields(record: CitationMatch) {
  const authors = record.authors
    ? record.authors.split(/\s*;\s*|\s+and\s+|\s*,\s*/).map((author) => author.trim()).filter(Boolean)
    : [];
  return {
    title: record.title,
    url: record.url,
    canonicalUrl: canonicalizeUrl(record.url),
    doi: canonicalizeDoi(record.doi),
    isbn: null,
    resourceType: "bibliographic",
    provider: record.source,
    year: record.year,
    authors,
    venue: null,
    peerReviewed: null,
  };
}

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
 * D-23-19 (floors attempt 4/5 — the wrong-work-link CLASS): a bibliographic
 * provider indexes a book's published REVIEW/notice as its own record whose
 * title substantially overlaps — often literally repeats — the reviewed
 * work's title. `titleOverlap` happily accepts these, so a citation to the
 * WORK mis-links to a review OF the work. Observed in the actual floors-run
 * corpus: "Love and Friendship in Plato and Aristotle (review)"; a review
 * header carried verbatim as a Crossref title, "Book Reviews … Pp. xxiii +
 * 441, $50.00 (cloth)"; "Richmond Lattimore: The Odyssey of Homer. … Pp. 374.
 * … Cloth, $8.95."; "Sarah Broadie and Christopher Rowe (eds) … Pp. x+468.
 * £15.00 (Pbk)." These guards read ONLY the candidate's own title for signals
 * that never appear in a genuine work's title — an appended "(review)"/
 * "[review]" document-type tag, a pagination notice ("Pp. 374"/"Pp. x+468"),
 * or a binding notice ("(cloth)"/"(Pbk)") — so a review notice is rejected
 * while a same-titled monograph is untouched. Deliberately grounded in the
 * real corpus, not speculative; deliberately omits a bare currency signal,
 * which a legitimate title can carry ("$2.00 a Day").
 *
 * Adversarial verification (post-merge) found the original marker also
 * matched titles STARTING with "Review"/"Reviews of"/"Review:" — a prefix
 * shape that never actually appears in any of the four corpus examples above
 * (all four are caught by the suffix tag alone or by pagination/binding), but
 * DOES match real, legitimately-citable titles: journal names used as a
 * title field ("Review of Economic Studies", "Reviews of Modern Physics") and
 * genuine review-articles that this exact scholarly domain cites directly as
 * primary sources ("Review of Aristotle's Ethics, by W. D. Ross"). Vetoing
 * those would silently turn a correct resolution into a false "unresolved"
 * with no recovery path. The prefix branch was removed as unneeded weight —
 * the suffix tag is what the real bypass needed, and it carries much lower
 * false-positive risk, since "(review)"/"[review]" is a document-type tag an
 * index appends rather than an organic part of an authored title. */
const REVIEW_TITLE_MARKER = /\(\s*review\s*\)\s*$|\[\s*review\s*\]\s*$/i;
const PAGINATION_NOTICE = /\bpp\.\s*[ivxlcdm\d]/i;
const BINDING_NOTICE = /\((?:cloth|paper|pbk|hbk|hardback|paperback|hardcover)\)/i;

function isReviewTitle(title: string): boolean {
  return REVIEW_TITLE_MARKER.test(title) || PAGINATION_NOTICE.test(title) || BINDING_NOTICE.test(title);
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
function disqualifiesCitationMatch(query: string, candidate: OverlapCandidate): boolean {
  return yearConflictsWithQuery(query, candidate) || isReviewTitle(candidate.title);
}

function bestOverlapMatch<T extends OverlapCandidate>(query: string, candidates: readonly T[]): T | null {
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
async function findCatalogMatchForQuery(query: string): Promise<{ id: string; record: CitationMatch } | null> {
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

/**
 * Everything a resolved match — live, catalogue-reused, or same-run-linked —
 * needs applied to a citation: the Library projection merge, the citation row
 * itself, and the `cites` graph edge. Factored out of `resolveCitationMetadata`
 * so `linkCitationsToRunDiscoveries` (a different caller, a different source
 * of the match) shares the exact same downstream behavior rather than a
 * second hand-copied version of it.
 */
async function applyResolvedCitation(input: {
  citationId: string;
  workId: string;
  workIdentityId: string | null;
  userId: string;
  rawText: string;
  normalizedQuery: string;
  sourceType: "bibliography" | "footnote" | "endnote" | "inline";
  parserConfidence: number;
  sourceAnchor: RawCitation["anchor"];
  record: CitationMatch;
  bibId: string;
  /**
   * Floors-capability-proposal §2.3 bridge: set ONLY when this resolution
   * came from the independent citation-resolution pathway (a live lookup or
   * catalogue-match reuse) and is genuinely not yet reflected in this run's
   * own `research_resource` rows — i.e. `resolveCitationMetadata`'s call,
   * never `linkCitationsToRunDiscoveries`'s (whose match is, by
   * construction, already a `research_resource` row in this exact run).
   * Left undefined/null, no bridge row is written — the pre-existing
   * behavior for every other caller.
   */
  bridgeRunId?: string | null;
}): Promise<void> {
  const { citationId, workId, workIdentityId, userId, record, bibId } = input;
  const [link] = await db
    .select({ learningResourceId: citationLibraryLinks.learningResourceId })
    .from(citationLibraryLinks)
    .where(eq(citationLibraryLinks.citationId, citationId))
    .limit(1);
  const citationMention: RawCitation = {
    text: input.rawText,
    query: input.normalizedQuery,
    kind: input.sourceType === "inline" ? "inline" : "reference",
    sourceType: input.sourceType,
    parserConfidence: input.parserConfidence,
    anchor: input.sourceAnchor,
  };
  const fields = resolvedCitationLibraryFields(record);
  const canonicalKey = normalizedKey({
    doi: fields.doi,
    isbn: fields.isbn,
    url: fields.url,
    title: fields.title,
    authors: fields.authors,
    year: fields.year,
  });

  if (link && canonicalKey) {
    const [existing] = await db
      .select({ id: learningResources.id })
      .from(learningResources)
      .where(eq(learningResources.normalizedKey, canonicalKey))
      .limit(1);
    const targetId = existing?.id ?? link.learningResourceId;
    if (workIdentityId) await ensureCitationRole({ learningResourceId: targetId, workIdentityId, citation: citationMention, citationId });
    if (existing && existing.id !== link.learningResourceId) {
      // Merge every provenance link before removing the temporary stub. This
      // makes DOI/ISBN/URL/title identity canonical without duplicate rows.
      await db.update(citationLibraryLinks).set({ learningResourceId: existing.id }).where(eq(citationLibraryLinks.learningResourceId, link.learningResourceId));
      await db.delete(resourceRoles).where(eq(resourceRoles.learningResourceId, link.learningResourceId));
      await db.delete(learningResources).where(eq(learningResources.id, link.learningResourceId));
    } else {
      await db.update(learningResources).set({ ...fields, normalizedKey: canonicalKey, bibRecordId: bibId, updatedAt: new Date() }).where(eq(learningResources.id, link.learningResourceId));
    }
  }

  await db.update(citations).set({ resolvedBibId: bibId, resolutionSource: record.source, resolutionState: "resolved" }).where(eq(citations.id, citationId));
  const [existingEdge] = await db
    .select({ id: graphEdges.id })
    .from(graphEdges)
    .where(and(
      eq(graphEdges.userId, userId),
      eq(graphEdges.sourceType, "work"),
      eq(graphEdges.sourceId, workId),
      eq(graphEdges.targetType, "bibliographic_record"),
      eq(graphEdges.targetId, bibId),
      eq(graphEdges.edgeType, "cites"),
    ))
    .limit(1);
  if (!existingEdge) {
    await db.insert(graphEdges).values({
      userId,
      sourceType: "work",
      sourceId: workId,
      targetType: "bibliographic_record",
      targetId: bibId,
      edgeType: "cites",
      weight: 1,
      confidence: input.parserConfidence,
      evidence: { citationId, sourceType: input.sourceType, anchor: input.sourceAnchor },
      createdBy: "system",
    });
  }

  // Floors-capability-proposal §2.3: this citation resolved through the
  // independent citation-resolution pathway, not this run's own
  // discovery/acceptance loop — bridge it into `research_resource`, the ONLY
  // table the direct-source-floor gate counts, using ONLY data already
  // verified above (no new lookup, no new AI cost). `onConflictDoNothing`
  // covers the (unlikely but real) race against that same run's own
  // discovery loop independently finding and inserting the identical
  // resource: whichever writer commits first wins, the other is a safe no-op
  // rather than a unique-constraint crash, and either way a
  // `research_resource` row ends up present, which is the only thing this
  // bridge exists to guarantee.
  if (input.bridgeRunId && shouldBridgeCitationToResearchResource(input.sourceType)) {
    const bridged = buildCitationBridgeResource({
      runId: input.bridgeRunId,
      citationId,
      bibId,
      match: record,
    });
    await db
      .insert(researchResources)
      .values(bridged)
      .onConflictDoNothing({ target: [researchResources.runId, researchResources.normalizedKey] });
  }
}

/**
 * Worker-queue consumer for metadata resolution. It is intentionally
 * serialized by the worker queue; this makes external lookup rate-limited and
 * keeps the immediate citation projection independent from provider health.
 */
export async function resolveCitationMetadata(citationId: string): Promise<void> {
  const [citation] = await db
    .select({
      id: citations.id,
      documentId: citations.documentId,
      processingRunId: citations.processingRunId,
      rawText: citations.rawText,
      normalizedQuery: citations.normalizedQuery,
      sourceType: citations.sourceType,
      parserConfidence: citations.parserConfidence,
      sourceAnchor: citations.sourceAnchor,
      resolutionState: citations.resolutionState,
      workId: documents.workId,
      workIdentityId: works.workIdentityId,
      userId: documents.userId,
    })
    .from(citations)
    .innerJoin(documents, eq(documents.id, citations.documentId))
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(citations.id, citationId))
    .limit(1);
  if (!citation) return;
  // Idempotent no-op (D-20-68): a duplicate/retried job (pg-boss retry, or
  // this same citation already having been linked by
  // `linkCitationsToRunDiscoveries` earlier in the same analysis run) must
  // never re-run a live lookup against an already-resolved citation — a
  // slow/failed SECOND attempt at the same external API can otherwise
  // downgrade a citation that was already correctly resolved back to
  // "unresolved". This is exactly the shape of the Annas 1977 canary
  // regression: identical input, resolved once, unresolved the next time.
  if (citation.resolutionState === "resolved") return;

  let record: CitationMatch | null = null;
  let bibId: string | null = null;
  try {
    // D-20-81: rawText carries book-form signal (publisher/press/edition
    // words) that cleanQuery deliberately strips from normalizedQuery
    // upstream; resolveCitation still only ever looks UP against the
    // cleaned query, rawText is used solely to pick the provider order.
    const live = await resolveCitation(citation.normalizedQuery, { rawText: citation.rawText });
    // D-23-19: a live provider hit is accepted only if it survives the SAME
    // corroboration guards a catalogue/discovery match must (`bestOverlapMatch`
    // applies them; the live path previously did not). A year-conflicting or
    // review-notice hit is vetoed here, before `findOrCreateBibRecord` ever
    // creates a row for it, so the citation falls through to the catalogue
    // fallback below and then to unresolved — a wrong-work link is strictly
    // worse than staying unresolved (anti-hallucination, plan §11/§12).
    if (live && !disqualifiesCitationMatch(citation.normalizedQuery, live)) {
      record = live;
      bibId = await findOrCreateBibRecord(live);
    }
  } catch (error) {
    // Resolution availability is not a prerequisite for Library coverage.
    reportError(error, { scope: "worker.resolveCitationMetadata", citationId });
  }
  if (!record) {
    const catalogMatch = await findCatalogMatchForQuery(citation.normalizedQuery);
    if (catalogMatch) {
      record = catalogMatch.record;
      bibId = catalogMatch.id;
    }
  }
  if (!record || !bibId) {
    await db.update(citations).set({ resolutionState: "unresolved", resolutionSource: "unresolved" }).where(eq(citations.id, citationId));
    return;
  }

  await applyResolvedCitation({
    citationId,
    workId: citation.workId,
    workIdentityId: citation.workIdentityId,
    userId: citation.userId,
    rawText: citation.rawText,
    normalizedQuery: citation.normalizedQuery,
    sourceType: citation.sourceType,
    parserConfidence: citation.parserConfidence,
    sourceAnchor: citation.sourceAnchor as RawCitation["anchor"],
    record,
    bibId,
    // This IS the citation-resolution pathway (§2.3) — a live lookup or
    // catalogue-match reuse, not a same-run research_resource reuse — so it
    // gets bridged. `processingRunId` is null only for a legacy v1 citation
    // (which never enqueues this job in the first place, see
    // `enqueueCitationMetadataResolution`'s only call site), so this is
    // effectively always set for anything that reaches here.
    bridgeRunId: citation.processingRunId,
  });
}

/**
 * D-20-68 (the Irwin canary case): the explicit-citation discovery lane can
 * surface a resource in THIS SAME RUN — via a provider @ice/bibliographic's
 * narrower live lookup never queries at all (e.g. Google Books) — that the
 * matching structural citation never gets linked to. The reason is ordering,
 * not coverage: `resolveCitationMetadata` runs as an independent,
 * asynchronously-queued job enqueued right when the citation is first
 * inserted (near the START of `analyzeEditionRun`), while `research_resource`
 * rows for this run are only written much later in the SAME function call —
 * so the async job frequently has nothing of this run's own to see even in
 * principle, and nothing ever revisits it afterward. This closes that gap
 * synchronously, called only once discovery has actually finished inserting
 * this run's `research_resource` rows, so the link never races the async
 * queue's own timing. Citations already `resolved` (by the async path, or a
 * prior call to this function on reprocess) are left untouched.
 */
export async function linkCitationsToRunDiscoveries(documentId: string, runId: string): Promise<void> {
  const candidates = await db
    .select({
      title: researchResources.title,
      bibRecordId: researchResources.bibRecordId,
      provider: researchResources.provider,
      year: researchResources.year,
    })
    .from(researchResources)
    .where(and(eq(researchResources.runId, runId), isNotNull(researchResources.bibRecordId)));
  if (!candidates.length) return;

  const pending = await db
    .select({
      id: citations.id,
      workId: documents.workId,
      workIdentityId: works.workIdentityId,
      userId: documents.userId,
      rawText: citations.rawText,
      normalizedQuery: citations.normalizedQuery,
      sourceType: citations.sourceType,
      parserConfidence: citations.parserConfidence,
      sourceAnchor: citations.sourceAnchor,
    })
    .from(citations)
    .innerJoin(documents, eq(documents.id, citations.documentId))
    .innerJoin(works, eq(works.id, documents.workId))
    .where(and(eq(citations.documentId, documentId), ne(citations.resolutionState, "resolved")));
  if (!pending.length) return;

  for (const citation of pending) {
    const match = bestOverlapMatch(citation.normalizedQuery, candidates);
    if (!match?.bibRecordId) continue;
    const [bibRow] = await db
      .select()
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.id, match.bibRecordId))
      .limit(1);
    if (!bibRow) continue;
    await applyResolvedCitation({
      citationId: citation.id,
      workId: citation.workId,
      workIdentityId: citation.workIdentityId,
      userId: citation.userId,
      rawText: citation.rawText,
      normalizedQuery: citation.normalizedQuery,
      sourceType: citation.sourceType,
      parserConfidence: citation.parserConfidence,
      sourceAnchor: citation.sourceAnchor as RawCitation["anchor"],
      record: {
        source: `research:${match.provider}`,
        externalId: bibRow.externalId,
        title: bibRow.title,
        authors: bibRow.authors,
        year: bibRow.year,
        doi: bibRow.doi,
        url: bibRow.url,
        accessStatus: bibRow.accessStatus,
      },
      bibId: match.bibRecordId,
      // Deliberately NOT bridged (no `bridgeRunId`): `match` came FROM this
      // exact run's own `researchResources` query above, so a
      // `research_resource` row already exists for it — bridging again would
      // be pure redundancy (§2.3's bridge is only for the OTHER pathway).
    });
  }
}

export async function analyzeWork(documentId: string): Promise<void> {
  const [doc] = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      workId: documents.workId,
      mimeType: documents.mimeType,
      extractedText: documents.extractedText,
      title: works.title,
      authorName: works.authorName,
    })
    .from(documents)
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) throw new Error(`Document ${documentId} not found for analysis`);
  if (!doc.extractedText?.trim()) throw new Error("No extracted text to analyze");

  // Citation-wipe guard (D-23-3). The block below deletes this document's
  // citations and re-extracts them with the OLD heuristic. That is correct
  // ONLY for legacy (v1) documents, which never create a `processing_run`.
  // Any document processed by the edition pipeline (v2/v3/v4) owns a
  // `processing_run` whose own citation-writing pass produced a richer,
  // run-scoped, provider-resolved citation set (apps/worker/src/analyze.ts's
  // analyzeEditionRun) — running legacy analysis on it silently destroys that
  // set. This guard is DATA-DRIVEN and version-independent: it never reads
  // ANALYSIS_PIPELINE, so it holds even when the web and worker env disagree,
  // and it correctly lets a true v1 document (no run) fall through to legacy
  // analysis. It also neutralises any stale analyze-work job already sitting
  // in the queue from before this fix, and any manual /analyze retrigger on
  // an edition document (whose real recovery path is /reprocess).
  const [editionRun] = await db
    .select({ id: processingRuns.id })
    .from(processingRuns)
    .where(eq(processingRuns.documentId, documentId))
    .limit(1);
  if (editionRun) {
    // The edition pipeline is the authoritative analysis for this document.
    // Record a terminal, honest status and leave its output untouched.
    // Idempotent: safe to run repeatedly on a retried/duplicate job.
    await db
      .update(documents)
      .set({ analysisStatus: "complete", analysisError: null, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    return;
  }

  await db
    .update(documents)
    .set({ analysisStatus: "analyzing", analysisError: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  try {
    // Idempotent re-run: clear prior *system* output, keep user edits.
    await db
      .delete(annotations)
      .where(and(eq(annotations.documentId, documentId), eq(annotations.createdBy, "system")));
    await db.delete(citations).where(eq(citations.documentId, documentId));
    await db
      .delete(graphEdges)
      .where(
        and(
          eq(graphEdges.sourceType, "work"),
          eq(graphEdges.sourceId, doc.workId),
          eq(graphEdges.createdBy, "system"),
        ),
      );

    // Cap on citations classified per document (bounds AI spend and worker
    // time). 300 comfortably covers a full book's reference list; at the
    // cheap-tier model that's ~4-5 cents max per analysis. Candidates are
    // processed with bounded concurrency (see ANALYSIS_CONCURRENCY) so a
    // large reference list finishes in a fraction of the sequential time.
    const candidates = extractCitations(doc.extractedText, 300);
    const citationTexts = candidates.map((candidate) => `${candidate.text} ${candidate.query}`);
    const isText = doc.mimeType === "text/plain" || doc.mimeType === "text/markdown";
    const paragraphs = isText
      ? doc.extractedText.split(/\n{2,}/).filter((p) => p.trim().length > 0)
      : [];

    // Dedup bibliographic records within this run: concurrent candidates
    // resolving to the SAME work (same DOI/external id) would otherwise
    // race on find-or-create and insert duplicates. Caching the *promise*
    // by key means the first request creates the record and the rest await
    // the same result. (findOrCreateBibRecord still reads existing rows
    // first, so cross-run dedup is unaffected.)
    const bibCache = new Map<string, Promise<string>>();
    const getBibId = (record: ResolvedRecord): Promise<string> => {
      const key = record.doi
        ? `doi:${record.doi}`
        : record.externalId
          ? `ext:${record.externalId}`
          : `title:${record.title.toLowerCase()}`;
      let p = bibCache.get(key);
      if (!p) {
        p = findOrCreateBibRecord(record);
        bibCache.set(key, p);
      }
      return p;
    };

    await mapWithConcurrency(candidates, ANALYSIS_CONCURRENCY, async (candidate) => {
      // --- Stage 1: resolve against real bibliographic sources ---
      // D-20-81: see the analogous rawText note in resolveCitationMetadata.
      const record = await resolveCitation(candidate.query, { rawText: candidate.text });
      const bibId = record ? await getBibId(record) : null;

      await db.insert(citations).values({
        documentId,
        rawText: candidate.text,
        normalizedQuery: candidate.query,
        sourceType: candidate.kind === "inline" ? "inline" : "bibliography",
        parserConfidence: candidate.kind === "inline" ? 0.74 : 0.8,
        resolvedBibId: bibId,
        resolutionSource: record?.source ?? "unresolved",
        resolutionState: record ? "resolved" : "unresolved",
      });

      // --- Anchoring (text docs only) ---
      const located = isText ? buildTextAnchor(paragraphs, leadingSurname(candidate.query)) : null;
      const sourceText = located?.sourceText ?? candidate.text;
      const citationFrequency = citationFrequencyFor(
        { title: record?.title ?? candidate.text.slice(0, 160), authors: record?.authors ?? null },
        doc.extractedText ?? "",
        citationTexts,
      );

      // --- Stage 2: classify the relationship ---
      const classification = await classifyRelationship({
        primaryTitle: doc.title,
        primaryAuthor: doc.authorName,
        candidateTitle: record?.title ?? candidate.text.slice(0, 160),
        candidateAuthor: record?.authors ?? null,
        sourceText,
        resolved: Boolean(record),
        citationFrequency,
      });

      await db.insert(aiUsageLogs).values({
        documentId,
        task: "relationship_classification",
        provider: classification.provider,
        model: classification.model,
        promptTokens: classification.promptTokens,
        completionTokens: classification.completionTokens,
        estimatedCostUsd: classification.heuristic
          ? 0
          : estimateCostUsd(classification.model, classification.promptTokens, classification.completionTokens),
      });

      await db.insert(annotations).values({
        userId: doc.userId,
        documentId,
        relationshipCategory: classification.category,
        targetBibId: bibId,
        targetLabel: targetLabel(candidate, record),
        anchor: located?.anchor ?? null,
        extractedSourceText: sourceText,
        explanation: classification.explanation,
        confidence: classification.confidence,
        modelUsed: classification.model,
        promptVersion: classification.heuristic ? "heuristic" : CLASSIFY_PROMPT_VERSION,
        createdBy: "system",
        verificationStatus: "unreviewed",
      });

      // Graph edge only for resolved targets (real node on both ends).
      if (bibId) {
        await db.insert(graphEdges).values({
          userId: doc.userId,
          sourceType: "work",
          sourceId: doc.workId,
          targetType: "bibliographic_record",
          targetId: bibId,
          edgeType: edgeValue(CATEGORY_TO_EDGE[classification.category]),
          weight: 1,
          confidence: classification.confidence,
          evidence: { extractedSourceText: sourceText, category: classification.category, citationFrequency },
          createdBy: "system",
        });
      }
    });

    await db
      .update(documents)
      .set({ analysisStatus: "complete", updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    console.log(`[worker] analysis complete for document ${documentId}: ${candidates.length} annotation(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError(err, { scope: "worker.analyzeWork", documentId });
    await db
      .update(documents)
      .set({ analysisStatus: "failed", analysisError: message, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    throw err;
  }
}

// A-first ordering so the highest-authority resources are inspected within the
// full-inspection budget.
const AUTHORITY_ORDER: Record<SourceAuthority, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

/** Persistent provider-result cache over the `research_cache` table (plan §33
 *  TTLs). A read/write failure never breaks discovery (withCache degrades to a
 *  live call), so the store can throw freely. */
const dbCacheStore: CacheStore = {
  async get(provider, key) {
    const [row] = await db
      .select({ results: researchCache.results, expiresAt: researchCache.expiresAt })
      .from(researchCache)
      .where(and(eq(researchCache.provider, provider), eq(researchCache.cacheKey, key)))
      .limit(1);
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) return null;
    return row.results as RawResource[];
  },
  async set(provider, key, resources, ttlMs) {
    const expiresAt = new Date(Date.now() + ttlMs);
    await db
      .insert(researchCache)
      .values({ provider, cacheKey: key, results: resources, expiresAt })
      .onConflictDoUpdate({
        target: [researchCache.provider, researchCache.cacheKey],
        set: { results: resources, expiresAt, createdAt: new Date() },
      });
  },
};

/** Project a scholarly book/article resource into the shared bibliographic
 *  catalogue, deduped by DOI/ISBN/normalized title (returns the record id). */
async function findOrCreateBibFromResource(r: RawResource): Promise<string | null> {
  const doi = canonicalizeDoi(r.doi);
  const isbn = canonicalizeIsbn(r.isbn);
  if (doi) {
    const [ex] = await db.select({ id: bibliographicRecords.id }).from(bibliographicRecords).where(eq(bibliographicRecords.doi, doi)).limit(1);
    if (ex) return ex.id;
  }
  const [created] = await db
    .insert(bibliographicRecords)
    .values({
      source: r.provider,
      externalId: isbn ?? null,
      title: r.title,
      authors: r.authors.join(", ") || null,
      year: r.year,
      doi,
      url: r.url,
      accessStatus: "metadata_only",
      raw: r.raw,
    })
    .returning({ id: bibliographicRecords.id });
  return created.id;
}

/**
 * Find-or-create the shared `work_identity` row for a computed identity key
 * (plan §34.4 9.5), upgraded in Phase 20.6 to run the canonical-identity
 * precedence chain BEFORE the title/author key: verified DOI, then verified
 * ISBN, then canonical provider id, then the `workKey` (normalized
 * title+author), then a verified upload content hash. Identifiers are only
 * ever accepted from PRIMARY-role records — a review carries its own DOI,
 * and storing it here is exactly how one work becomes five entries — and
 * only backfilled onto an existing identity when the column is still null,
 * never overwritten.
 *
 * Unlike `findOrCreateBibFromResource`'s catalogue, `work_identity.workKey`
 * carries a real unique constraint, so a plain select-then-insert can lose a
 * race between two concurrent runs that resolve to the same work —
 * `onConflictDoNothing` + re-select closes it.
 */
export async function findOrCreateWorkIdentity(
  identity: WorkIdentityKey,
  authors: string[],
  verified: { doi?: string | null; isbn?: string | null; externalId?: string | null; contentHash?: string | null; year?: number | null } = {},
): Promise<string | null> {
  const doi = canonicalizeDoi(verified.doi);
  const isbn = canonicalizeIsbn(verified.isbn);
  const externalId = verified.externalId?.trim().toLowerCase() || null;
  const contentHash = verified.contentHash?.trim() || null;

  const backfill = async (id: string) => {
    if (!doi && !isbn && !externalId && !contentHash) return;
    await db
      .update(workIdentities)
      .set({
        doi: sql`coalesce(${workIdentities.doi}, ${doi})`,
        isbn: sql`coalesce(${workIdentities.isbn}, ${isbn})`,
        externalId: sql`coalesce(${workIdentities.externalId}, ${externalId})`,
        contentHash: sql`coalesce(${workIdentities.contentHash}, ${contentHash})`,
        updatedAt: new Date(),
      })
      .where(eq(workIdentities.id, id));
  };

  // Precedence 1–3: a verified identifier outranks the title/author key.
  for (const clause of [
    doi ? eq(workIdentities.doi, doi) : null,
    isbn ? eq(workIdentities.isbn, isbn) : null,
    externalId ? eq(workIdentities.externalId, externalId) : null,
  ]) {
    if (!clause) continue;
    const [match] = await db.select({ id: workIdentities.id }).from(workIdentities).where(clause).limit(1);
    if (match) {
      await backfill(match.id);
      return match.id;
    }
  }

  // Precedence 4: the normalized title+author key (the unique `workKey`).
  const [byKey] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.workKey, identity.key)).limit(1);
  if (byKey) {
    await backfill(byKey.id);
    return byKey.id;
  }

  // Precedence 5: identical uploaded bytes — the same document re-uploaded
  // under a different filename can extract a slightly different title.
  if (contentHash) {
    const [byHash] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.contentHash, contentHash)).limit(1);
    if (byHash) {
      await backfill(byHash.id);
      return byHash.id;
    }
  }

  const inserted = await db
    .insert(workIdentities)
    .values({
      workKey: identity.key,
      canonicalTitle: identity.canonicalTitle,
      authorSurname: identity.authorSurname,
      authors,
      year: verified.year ?? null,
      doi,
      isbn,
      externalId,
      contentHash,
      evidence: identity.evidence,
    })
    .onConflictDoNothing({ target: workIdentities.workKey })
    .returning({ id: workIdentities.id });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.workKey, identity.key)).limit(1);
  if (existing) await backfill(existing.id);
  return existing?.id ?? null;
}

/**
 * Run-scoped, evidence-first research for the v2 edition (plan §33). Generates
 * search queries (LLM cheap-tier or heuristic), discovers across every enabled
 * source adapter under the cost/saturation/dedup budget, then for each resource
 * records provenance, independent credibility components (authority A–E, never
 * popularity), a source-grounded generated note + claim, and — for scholarly
 * works — a catalogue + graph projection. Never deletes legacy reader records;
 * published atomically by the caller only on success. Every generated note is a
 * grounded floor (no invented facts); LLM prose synthesis is a later add-on
 * gated by the soft cost cap.
 */
export async function analyzeEditionRun(input: {
  runId: string;
  documentId: string;
  text: string;
  pipeline?: "v1" | "v2" | "v3" | "v4";
  /** Real body blocks in document order. v4 adds page/section scope. */
  bodyBlocks?: { id: string; text: string; pageIndex?: number; blockOrder?: number; sectionTitle?: string | null }[];
  /** Deterministic source apparatus extracted from structural blocks. */
  apparatus?: ExtractedAuthorApparatus[];
}): Promise<void> {
  const [doc] = await db
    .select({ userId: documents.userId, workId: documents.workId, title: works.title, authorName: works.authorName, contentHash: documents.contentHash })
    .from(documents)
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!doc) throw new Error(`Document ${input.documentId} not found for edition research`);
  const isV4 = input.pipeline === "v4";
  const isModernPipeline = input.pipeline === "v3" || isV4;
  const setStage = async (
    v2Stage: string,
    v3Stage: string,
    v4Stage = v3Stage,
    sourceProgress?: { sourceIndex: number; sourceTotal: number },
  ) => {
    await db.update(processingRuns).set({
      stage: isV4 ? v4Stage : isModernPipeline ? v3Stage : v2Stage,
      // Null whenever this stage isn't inside the per-source loop, so a
      // stage set before/after the loop never carries over a stale count
      // from a prior source (the write is unconditional, so "omitted" always
      // means "reset to null" here, not "leave whatever was there").
      stageSourceIndex: sourceProgress?.sourceIndex ?? null,
      stageSourceTotal: sourceProgress?.sourceTotal ?? null,
      updatedAt: new Date(),
    }).where(eq(processingRuns.id, input.runId));
  };

  // Prefer the metadata THIS run actually extracted over the work's provisional
  // title. Until the user confirms metadata, `works.title` is derived from the
  // filename ("Irwin-ViceReason-2001.pdf" → "Irwin ViceReason 2001"), which is
  // not the work's identity and makes every downstream query and relevance
  // decision wrong. Observed in a production canary: GROBID had extracted
  // "Vice and Reason" correctly and the research stage ignored it.
  const [extracted] = await db
    .select({ title: docMetadata.title, authors: docMetadata.authors })
    .from(docMetadata)
    .where(eq(docMetadata.runId, input.runId))
    .limit(1);
  const extractedAuthors = Array.isArray(extracted?.authors)
    ? (extracted.authors as unknown[]).filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    : [];
  const resolvedTitle = extracted?.title?.trim() || doc.title;
  const resolvedAuthors = extractedAuthors.length
    ? extractedAuthors
    : doc.authorName
      ? [doc.authorName]
      : [];
  const resolvedAuthorName = resolvedAuthors.join(", ") || null;

  // Give the PRIMARY work its own canonical identity before citation
  // projection. Citation Library coverage must not wait for discovery or AI
  // classification, so this identity is established at the start of every
  // edition pipeline that can persist structural citations.
  // — the same `deriveWorkIdentity` computation already applied to every
  // cited resource (migration 0014) — so the Library can later join "what
  // was recommended for MY works" via `works.workIdentityId` instead of
  // re-deriving/matching workKey strings in application code. Lazy and
  // idempotent: only set once, harmless to repeat on reprocess.
  let primaryWorkIdentityId: string | null = null;
  if (input.pipeline !== "v1") {
    const primaryIdentity = deriveWorkIdentity({
      title: resolvedTitle,
      authors: resolvedAuthors,
      year: null,
      doi: null,
      isbn: null,
      resourceType: "book",
    });
    // The upload's verified content hash participates in the precedence chain
    // (plan §20.6 rule 5): the same bytes re-uploaded under another filename
    // must resolve to the same canonical work identity.
    primaryWorkIdentityId = await findOrCreateWorkIdentity(primaryIdentity, resolvedAuthors, { contentHash: doc.contentHash });
    if (primaryWorkIdentityId) {
      await db
        .update(works)
        .set({ workIdentityId: primaryWorkIdentityId, updatedAt: new Date() })
        .where(and(eq(works.id, doc.workId), sql`${works.workIdentityId} is null`));
    }
  }

  const budget = makeBudget();
  // Crash-loop-proof budget (floors2 crash follow-up, §5 item 2): pg-boss
  // retries `extract-text`/`edition-reprocess` up to 3x on failure, and
  // `handleEditionExtraction` re-runs this ENTIRE pipeline — including every
  // paid stage — from scratch on each attempt, each under a NEW `runId`. If
  // the in-memory budget always started at $0, a document whose pipeline
  // keeps hitting the same crash would silently re-spend up to the hard cap
  // on every single attempt, with the $1 soft-cap / $5 hard-cap enforcement
  // never actually seeing the prior attempts' real spend. Seed it instead
  // from `ai_usage_log` rows already persisted for THIS DOCUMENT's prior
  // FAILED runs only (joined through `processing_run.status = 'failed'` —
  // the honest predicate for "crashed/still-crash-looping", per the actual
  // `processing_run_status` vocabulary: pending/running/complete/failed).
  // A prior COMPLETE run — published or superseded — is a legitimate edition,
  // not a crash; a fresh reprocess after one must start its budget at $0, or
  // every later reprocess of a well-behaved document would degrade for no
  // reason. A retry gets a fresh `runId`, so run-scoping alone would miss
  // exactly the spend this seed exists to catch — hence the document-level
  // join, narrowed to failed runs rather than every run of the document.
  //
  // ROUND-2 (episode scoping): "narrowed to failed runs" alone is still not
  // enough — a document can crash-loop (v1 failed), get manually recovered
  // and published (v2 complete), and only later be reprocessed again (v3).
  // Without a version floor, v1's old crash spend would keep seeding EVERY
  // future reprocess forever, even though a legitimate publish already
  // happened in between. A publish closes out the crash episode it followed,
  // so only failed runs with a version STRICTLY GREATER than the document's
  // most recent COMPLETE run's version — i.e. failed since that last publish
  // — belong to the CURRENT episode. `episodeStartVersion` is 0 (seed
  // everything) when the document has never had a complete run at all.
  // `ai_usage_log.run_id` is a real per-run column (FK added by migration
  // 0010), not merely a document-level or time-window association, so this
  // join attributes spend to exactly the runs it was actually incurred by —
  // no `created_at` window approximation is needed or used here.
  const [lastComplete] = await db
    .select({ version: sql<number>`coalesce(max(${processingRuns.version}), 0)` })
    .from(processingRuns)
    .where(and(eq(processingRuns.documentId, input.documentId), eq(processingRuns.status, "complete")));
  const episodeStartVersion = lastComplete?.version ?? 0;
  const [priorSpend] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
    .from(aiUsageLogs)
    .innerJoin(processingRuns, eq(aiUsageLogs.runId, processingRuns.id))
    .where(and(
      eq(processingRuns.documentId, input.documentId),
      eq(processingRuns.status, "failed"),
      gt(processingRuns.version, episodeStartVersion),
    ));
  // Tracked explicitly, once, as an immutable local — never recomputed from
  // `budget.spentUsd` later (which keeps accumulating this run's own spend)
  // so every place that persists `processing_run.ai_cost_usd` below can
  // subtract it back out and report ONLY this run's own spend, preserving
  // cost.ts's documented per-run invariant, the admin dashboard's global
  // sum, and the reader's per-edition cost display. The in-memory `budget`
  // itself still carries the seed permanently, so `canAfford`/`overSoftCap`
  // keep enforcing the true cumulative spend across a crash-loop retry.
  const seededUsd = priorSpend?.total ?? 0;
  if (seededUsd > 0) charge(budget, seededUsd);
  const responses = new OpenAIResponsesClient();
  const safetyIdentifier = safetyIdentifierFor(doc.userId);
  const cheapModel = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const researchModel = process.env.OPENAI_MODEL_RESEARCH ?? "gpt-5.4-mini";
  // Conservative upper bound on one mini-model note (~700 in + ~400 out) — used
  // only for the hard-cap affordability gate before starting a synthesis call.
  const NOTE_COST_ESTIMATE = 0.01;
  const usageLogs: (typeof aiUsageLogs.$inferInsert)[] = [];
  // How many of `usageLogs`' entries have already been written to the DB.
  // Used as a "flushed marker" so `flushUsageLogs` — called both
  // periodically and unconditionally in the `finally` below — only ever
  // inserts the DELTA since its last call, never the same row twice.
  let flushedUsageCount = 0;
  const flushUsageLogs = async () => {
    const pending = usageLogs.slice(flushedUsageCount);
    if (!pending.length) return;
    await db.insert(aiUsageLogs).values(pending);
    flushedUsageCount = usageLogs.length;
  };
  // How many un-flushed log entries accumulate before an incremental flush,
  // independent of the unconditional flush in `finally` — bounds how much a
  // crash mid-run (one that a plain try/finally in this same process could
  // still miss, e.g. a hard process kill) can leave unpersisted.
  const USAGE_FLUSH_BATCH_SIZE = 5;
  const logUsage = (task: string, stage: string, model: string, pTok: number, cTok: number, costOverride?: number) => {
    const cost = costOverride ?? estimateCostUsd(model, pTok, cTok);
    charge(budget, cost);
    usageLogs.push({
      documentId: input.documentId,
      runId: input.runId,
      stage,
      task,
      provider: "openai",
      model,
      promptTokens: pTok,
      completionTokens: cTok,
      estimatedCostUsd: cost,
    });
  };

  // Crash-safety wrapper (floors2 crash follow-up, §5 item 2): everything
  // from here on is the actual pipeline work, run inside a try/finally so
  // whatever `usageLogs` has accumulated — and the run's cost-so-far — is
  // always persisted on the way out, success OR throw. Before this fix, the
  // single `db.insert(aiUsageLogs)` bulk write only ran after the ENTIRE
  // pipeline finished successfully, so a mid-run crash (e.g. the duplicate-
  // key crash this same fix set repairs above) discarded every real OpenAI
  // call's cost with no ledger row anywhere to catch it — the $1/$5 caps
  // this pipeline depends on were themselves blind to that spend.
  try {
  // v3 only, and only when the extraction stage found real body blocks to
  // anchor to (see index.ts: `bodyBlocks` is only ever the actually-inserted
  // text_block rows). One bulk call regardless of document length keeps cost
  // bounded — a per-block loop would scale with page count, which nothing
  // else in this pipeline does either. No heuristic fallback when unavailable:
  // "zero passage annotations this run" is the honest degraded state, not a
  // guess dressed up as one (see synthesizePassageAnnotations's doc comment).
  const v4Claims: { textBlockId: string | null; claim: string; claimType: string; supportingExcerpt: string; confidence: number }[] = [];
  if (isV4 && input.bodyBlocks?.length) {
    const scopedBlocks: SectionAwareBlock[] = input.bodyBlocks.map((block, index) => ({
      blockId: block.id,
      text: block.text,
      pageIndex: block.pageIndex ?? 0,
      blockOrder: block.blockOrder ?? index,
      sectionTitle: block.sectionTitle ?? null,
    }));
    const chunks = chunkSectionAwareBlocks(scopedBlocks);
    const blocksById = new Map(scopedBlocks.map((block) => [block.blockId, block]));
    const annotations = [];
    const PASSAGE_ANNOTATION_COST_ESTIMATE = 0.01;
    for (const chunk of chunks) {
      if (!canAfford(budget, PASSAGE_ANNOTATION_COST_ESTIMATE) || overSoftCap(budget)) break;
      const synthesized = await synthesizePassageAnnotations(responses, {
        primary: { title: resolvedTitle, author: resolvedAuthorName },
        blocks: chunk.blocks,
        validRelationships: RELATIONSHIP_CATEGORIES,
        model: cheapModel,
        safetyIdentifier,
        maxAnnotations: 5,
        includeHelpfulFor: true,
        maxBlockChars: 12_000,
      });
      if (synthesized.usedModel) {
        logUsage("passage_annotation_synthesis", "section-aware-annotations", cheapModel, synthesized.promptTokens, synthesized.completionTokens);
      }
      annotations.push(...synthesized.annotations);
    }
    const deduped = dedupePassageAnnotations(annotations);
    if (deduped.length) {
      await db.insert(passageAnnotations).values(deduped.map((annotation) => ({
        runId: input.runId,
        textBlockId: annotation.blockId,
        isWholeWork: annotation.isWholeWork,
        quote: annotation.quote,
        summary: annotation.summary,
        explanation: annotation.explanation,
        helpfulFor: annotation.helpfulFor,
        scope: annotationScope(annotation, blocksById),
        annotationType: annotation.annotationType,
        relationship: annotation.relationship as RelationshipCategory,
        readerLevel: annotation.readerLevel,
        confidence: annotation.confidence,
      })));
      v4Claims.push(...deduped
        .filter((annotation) => annotation.annotationType === "argument" || annotation.annotationType === "evidence")
        .map((annotation) => ({
          textBlockId: annotation.blockId,
          claim: annotation.summary,
          claimType: annotation.annotationType,
          supportingExcerpt: annotation.quote ?? annotation.explanation,
          confidence: annotation.confidence,
        })));
      console.log(`[analyze] wrote ${deduped.length} section-aware passage annotation(s) for run ${input.runId}`);
    }
  } else if (input.pipeline === "v3" && input.bodyBlocks?.length) {
    // Cap both block COUNT and total characters sent, independent of NOTE_COST_ESTIMATE
    // below (that constant is scoped to the per-resource note loop).
    const candidateBlocks: { blockId: string; text: string }[] = [];
    let totalChars = 0;
    for (const b of input.bodyBlocks) {
      if (candidateBlocks.length >= 60 || totalChars >= 12_000) break;
      candidateBlocks.push({ blockId: b.id, text: b.text });
      totalChars += b.text.length;
    }
    const PASSAGE_ANNOTATION_COST_ESTIMATE = 0.01;
    if (canAfford(budget, PASSAGE_ANNOTATION_COST_ESTIMATE)) {
      const synthesized = await synthesizePassageAnnotations(responses, {
        primary: { title: resolvedTitle, author: resolvedAuthorName },
        blocks: candidateBlocks,
        validRelationships: RELATIONSHIP_CATEGORIES,
        model: cheapModel,
        safetyIdentifier,
      });
      if (synthesized.usedModel) {
        logUsage("passage_annotation_synthesis", "section-passage-anchors", cheapModel, synthesized.promptTokens, synthesized.completionTokens);
      }
      if (synthesized.annotations.length) {
        await db.insert(passageAnnotations).values(
          synthesized.annotations.map((a) => ({
            runId: input.runId,
            textBlockId: a.blockId,
            isWholeWork: a.isWholeWork,
            quote: a.quote,
            summary: a.summary,
            explanation: a.explanation,
            annotationType: a.annotationType,
            relationship: a.relationship as RelationshipCategory,
            readerLevel: a.readerLevel,
            confidence: a.confidence,
          })),
        );
        console.log(`[analyze] wrote ${synthesized.annotations.length} passage annotation(s) for run ${input.runId}`);
      }
    }
  }

  if (isModernPipeline && input.apparatus?.length) {
    await setStage("research-discovery", "explicit-citations", "author-apparatus");
    await db.insert(documentApparatus).values(input.apparatus.map((entry) => ({
      runId: input.runId,
      textBlockId: entry.textBlockId,
      kind: entry.kind,
      marker: entry.marker,
      text: entry.text,
      scope: entry.scope,
      source: entry.source,
    })));
    console.log(`[analyze] wrote ${input.apparatus.length} author apparatus record(s) for run ${input.runId}`);
  }

  await setStage("research-discovery", "explicit-citations", "explicit-citations");

  // Stage 1 (cheap, deterministic): source-aware citation mentions seed the
  // query set. Apparatus stays out of processed body text, but it is a
  // first-class extraction input with its own anchor and provenance.
  // (D-20-91: assembly — including the recovered-endnote exclusion — lives
  // in `citationSources.ts` as a pure, DB-free function.)
  const structuralCitationSources: CitationSourceInput[] = buildStructuralCitationSources({
    bodyBlocks: input.bodyBlocks,
    apparatus: input.apparatus,
  });
  const citationCandidates = structuralCitationSources.length
    ? extractCitationMentions(structuralCitationSources, RESEARCH_LIMITS.maxCitationCandidates)
    : extractCitations(input.text, RESEARCH_LIMITS.maxCitationCandidates);

  if (primaryWorkIdentityId) {
    for (const citation of citationCandidates) {
      const [persisted] = await db
        .insert(citations)
        .values({
          documentId: input.documentId,
          processingRunId: input.runId,
          textBlockId: citation.anchor?.textBlockId ?? null,
          rawText: citation.text,
          normalizedQuery: citation.query,
          sourceType: citation.sourceType ?? (citation.kind === "inline" ? "inline" : "bibliography"),
          parserConfidence: citation.parserConfidence ?? 0,
          sourceAnchor: citation.anchor ?? null,
          resolutionSource: "unresolved",
          resolutionState: "pending",
        })
        .returning({ id: citations.id });
      await createCitationLibraryProjection({ citationId: persisted.id, citation, workIdentityId: primaryWorkIdentityId });
      try {
        await enqueueCitationMetadataResolution(persisted.id);
      } catch (error) {
        // Queue availability cannot turn a durable citation into an omission.
        reportError(error, { scope: "worker.enqueueCitationMetadata", citationId: persisted.id });
      }
    }
  }
  // Two different consumers, two different shapes:
  //  - `citationTexts` keeps the VERBATIM entry, which the relevance gate
  //    matches a discovered title against for containment.
  //  - `citationQueries` is the cleaned lookup string (cue words and
  //    publisher imprints stripped), which is what a catalogue search wants.
  const citationTexts = citationCandidates.map((c) => c.text);
  const citationQueries = citationCandidates.map((c) => c.query);

  // V3 (Phase 9.4, plan §34.4): real extraction for what was, until now, only
  // a label on this stage (the topic signature derived purely from citation
  // metadata — no concepts, people, or debates with an LLM at all). A
  // per-work diagnostic quiz needs something real to ask about, so this
  // extracts the concepts/doctrines/people/traditions/debates the work
  // itself requires or discusses, in one bulk call (bounded cost regardless
  // of document length, same pattern as `synthesizePassageAnnotations`), and
  // shares them in the global `concept` catalog — append-only, like
  // `bibliographic_record`, so two readers studying the same doctrine land
  // on the same node. Falls back to an honest empty result with no model
  // key; extracted labels also feed lane query generation below, replacing
  // the resolvedTitle-only placeholder with the work's actual vocabulary.
  await setStage("research-discovery", "concepts-people-debates");
  let extractedConceptLabels: string[] = [];
  if (isModernPipeline) {
    // Floors-capability-proposal §4: raised from the 10/doc default to 16 —
    // comfortable headroom above the gold-eval baseline's 8 required
    // concepts without inviting low-value padding from its ~40-entry full
    // inventory. Bounded, cheap raise ($0.0005-0.002/run via concepts.ts's
    // proportional `maxOutputTokens`), and the ONLY concept-cap change in
    // scope here — the proposal's paired sampling fix (a distributed text
    // sample instead of the current first-6000-characters slice) is a
    // separate, larger change and is deliberately deferred, not implemented.
    const CONCEPT_EXTRACTION_COST_ESTIMATE = 0.012;
    if (canAfford(budget, CONCEPT_EXTRACTION_COST_ESTIMATE)) {
      const synthesizedConcepts = await synthesizeConcepts(responses, {
        primary: { title: resolvedTitle, author: resolvedAuthorName },
        textSample: input.text,
        model: cheapModel,
        safetyIdentifier,
        maxConcepts: 16,
      });
      if (synthesizedConcepts.usedModel) {
        logUsage(
          "concept_extraction",
          "concepts-people-debates",
          cheapModel,
          synthesizedConcepts.promptTokens,
          synthesizedConcepts.completionTokens,
        );
      }
      if (synthesizedConcepts.concepts.length) {
        extractedConceptLabels = synthesizedConcepts.concepts.map((c) => c.label);
        for (const c of synthesizedConcepts.concepts) {
          const [existingConcept] = await db
            .select({ id: conceptsTable.id })
            .from(conceptsTable)
            .where(eq(conceptsTable.slug, c.slug))
            .limit(1);
          const conceptId =
            existingConcept?.id ??
            (
              await db
                .insert(conceptsTable)
                .values({ slug: c.slug, kind: c.kind, label: c.label, summary: c.summary })
                .returning({ id: conceptsTable.id })
            )[0].id;

          // Idempotent-safe on reprocess: graph_edge has no runId scope of
          // its own (unlike research_resource/passage_annotation), so a
          // repeat run over the same work would otherwise duplicate this
          // edge indefinitely rather than just refreshing it.
          const [existingEdge] = await db
            .select({ id: graphEdges.id })
            .from(graphEdges)
            .where(
              and(
                eq(graphEdges.userId, doc.userId),
                eq(graphEdges.sourceType, "work"),
                eq(graphEdges.sourceId, doc.workId),
                eq(graphEdges.targetType, "concept"),
                eq(graphEdges.targetId, conceptId),
              ),
            )
            .limit(1);
          if (!existingEdge) {
            await db.insert(graphEdges).values({
              userId: doc.userId,
              sourceType: "work",
              sourceId: doc.workId,
              targetType: "concept",
              targetId: conceptId,
              edgeType: "presupposes",
              confidence: c.confidence,
              evidence: { role: c.role, reason: c.evidence },
              createdBy: "system",
            });
          }
        }
        console.log(`[analyze] wrote ${synthesizedConcepts.concepts.length} concept(s) for run ${input.runId}`);
      }
    }
  }

  if (isV4) {
    await setStage("research-discovery", "lane-discovery", "lightweight-work-signals");
    if (v4Claims.length) {
      await db.insert(workClaims).values(v4Claims.map((claim) => ({
        runId: input.runId,
        workId: doc.workId,
        textBlockId: claim.textBlockId,
        claim: claim.claim,
        claimType: claim.claimType,
        supportingExcerpt: claim.supportingExcerpt,
        confidence: claim.confidence,
      })));
    }
    const signal = compactWorkSignal({
      title: resolvedTitle,
      author: resolvedAuthorName,
      concepts: extractedConceptLabels,
      claims: v4Claims.map((claim) => ({ claim: claim.claim, supportingExcerpt: claim.supportingExcerpt })),
    });
    const workSignals = await persistV4WorkSignals({
      runId: input.runId,
      workId: doc.workId,
      userId: doc.userId,
      signal,
      budget,
      logUsage: (model, inputTokens, cost) => logUsage("work_embedding", "lightweight-work-signals", model, inputTokens, 0, cost),
    });
    console.log(`[analyze] v4 work signals for run ${input.runId}: ${workSignals.embedded ? "embedded" : "no embedding"}, ${workSignals.candidates} candidate(s)`);
  }

  // Lane-specific query generation (LLM cheap-tier or heuristic fallback).
  // Running discovery per lane means a candidate is judged against the question
  // that surfaced it, and each lane only queries providers that can serve it.
  const concepts = extractedConceptLabels.length ? extractedConceptLabels : [resolvedTitle];
  await setStage("research-discovery", "lane-discovery", "lane-discovery");
  const qg = await generateLaneQueries(responses, {
    primary: { title: resolvedTitle, author: resolvedAuthorName },
    citationTexts: citationQueries,
    concepts,
    model: cheapModel,
    safetyIdentifier,
  });
  if (qg.usedModel) logUsage("query_generation", "research-discovery", cheapModel, qg.promptTokens, qg.completionTokens);
  const explicitCitationMatchTexts = [
    ...citationTexts,
    ...(qg.lanes.find((lane) => lane.lane === "explicit_citation")?.queries ?? []),
  ];

  // Discovery across every adapter (those never consulted still record an
  // honest attempt), each wrapped with the persistent result cache.
  const adapters = allAdapters().map((a) => withCache(a, dbCacheStore));
  const discovery = await runDiscovery({ adapters, rounds: qg.lanes, timeoutMs: 10_000 });

  if (discovery.attempts.length) {
    await db.insert(providerAttempts).values(
      discovery.attempts.map((a) => ({
        runId: input.runId,
        provider: a.provider,
        status: a.status,
        queries: a.queries,
        resultCount: a.resultCount,
        inspectionDepth: a.inspectionDepth,
        latencyMs: a.latencyMs,
        error: a.error ?? null,
      })),
    );
  }

  // ---- Relevance gate: runs BEFORE any authority scoring -----------------
  // Authority answers "how trustworthy is this source?", which is meaningless
  // until "is this source about the right thing?" is settled. Discovery returns
  // real false positives (a marketing paper has ranked first for a scholarly
  // seed query); scoring their authority first would dress them up rather than
  // filter them out.
  await setStage("relevance-gate", "relevance-gate");

  const identity: WorkIdentity = {
    title: resolvedTitle,
    authors: resolvedAuthors,
    year: null,
    doi: null,
    ...buildTopicSignature({
      title: resolvedTitle,
      bodyText: input.text,
      concepts,
      authors: resolvedAuthors,
    }),
    explicitCitationKeys: new Set(),
    explicitCitationTexts: explicitCitationMatchTexts,
    documentTextForExplicitTitleMatch: input.text,
    citedAuthorSurnames: citedSurnamesFrom(citationTexts),
    citationGraphKeys: new Set(),
  };

  const assessed = discovery.resources.map((r) => {
    // Prefer the lane that actually surfaced the resource. `laneForResource` is
    // the fallback for anything discovery could not attribute (cached hits,
    // resources with no usable identity key).
    const key = normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year });
    const discovered = key ? discovery.laneByKey.get(key) : undefined;
    const provisional = assessCandidate(r, identity, discovered ?? "scholarly_debate");
    // An explicit citation outranks whatever lane found it.
    const lane = provisional.signals.isExplicitCitation
      ? "explicit_citation"
      : discovered ?? laneForResource(r, false);
    return { r, lane, assessment: assessCandidate(r, identity, lane) };
  });

  // Persist EVERY candidate, including rejects. Deleting them would make the
  // pipeline unfalsifiable: the precision/recall gates are measured against
  // exactly these rows.
  if (assessed.length) {
    await db
      .insert(researchCandidates)
      .values(
        assessed.map(({ r, lane, assessment }) => ({
          runId: input.runId,
          lane,
          provider: r.provider,
          title: r.title,
          authors: r.authors,
          year: r.year,
          doi: canonicalizeDoi(r.doi),
          isbn: canonicalizeIsbn(r.isbn),
          canonicalUrl: canonicalizeUrl(r.url),
          venue: r.venue,
          normalizedKey: assessment.normalizedKey,
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          reasons: assessment.reasons,
          signals: assessment.signals,
          venueReliable: assessment.venueReliable,
        })),
      )
      // A lane re-run must update rather than duplicate, or the precision
      // numbers stop meaning anything.
      .onConflictDoNothing();
  }

  const acceptedResources = assessed.filter((a) => a.assessment.verdict === "accepted");
  const frequencyCitationTexts = citationCandidates.map((candidate) => `${candidate.text} ${candidate.query}`);
  const gateSummary = {
    accepted: acceptedResources.length,
    quarantined: assessed.filter((a) => a.assessment.verdict === "quarantined").length,
    rejected: assessed.filter((a) => a.assessment.verdict === "rejected").length,
  };
  console.log(
    `[analyze] relevance gate: ${gateSummary.accepted} accepted, ` +
      `${gateSummary.quarantined} quarantined, ${gateSummary.rejected} rejected ` +
      `(of ${assessed.length} discovered)`,
  );

  await setStage("classification", "creator-verification");

  // Selection for the full-inspection budget (floors-capability-proposal
  // §2.2): candidates whose explicit-citation grounding is the document's OWN
  // reference-list evidence (a resolved key or a matched citation-text entry)
  // are never competed out by authority alone — otherwise a flood of
  // interchangeable, high-authority primary-text editions (all legitimately
  // accepted via the broader title-phrase rule) can crowd out a real,
  // lower-authority secondary source for one of the scarce
  // `maxFullInspections` slots. Everything else is still ranked by authority,
  // exactly as before, and fills whatever budget remains. Only ACCEPTED
  // candidates get here — nothing quarantined or rejected is ever scored,
  // projected, or shown; this changes WHICH accepted candidates are
  // inspected, never what gets accepted (relevance.ts is untouched).
  const ranked = selectForFullInspection(
    acceptedResources.map(({ r, assessment }) => ({ r, assessment, authority: classifyAuthority(r) })),
    AUTHORITY_ORDER,
    RESEARCH_LIMITS.maxFullInspections,
  );
  // Full text is never an input to the paid research stages. It is a bounded
  // post-discovery retrieval only for records whose provider metadata carries
  // an explicit approved license, so this cannot expand the existing $1/$5 AI
  // budget or silently copy a paywalled source.
  let openAccessRetrievals = 0;
  const relationProjection: { id: string; workKey: string | null; workRole: "primary" | "review" | "edition" | "translation" | "excerpt" }[] = [];

  // Creator verification is a separate pass so every accepted resource gets a
  // provider-metadata-only identity before citation expansion or scoring.
  const verifiedCreators = new Map(ranked.map(({ r }) => [
    normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year }) ?? r.title,
    verifyCreatorFromProviderMetadata(r),
  ]));
  await setStage("classification", "citation-graph-expansion");

  for (const [rankedIndex, { r, assessment, authority }] of ranked.entries()) {
    const sourceProgress = { sourceIndex: rankedIndex + 1, sourceTotal: ranked.length };
    const citationFrequency = citationFrequencyFor({ title: r.title, authors: r.authors }, input.text, frequencyCitationTexts);
    const classify = () => classifyRelationship({
      primaryTitle: resolvedTitle,
      primaryAuthor: resolvedAuthorName,
      candidateTitle: r.title,
      candidateAuthor: r.authors.join(", ") || null,
      sourceText: r.snippet ?? r.title,
      resolved: Boolean(r.doi || r.isbn),
      citationFrequency,
    });
    // V2 classifies before writing its note as it always has. V3 deliberately
    // delays this until the final conservative-influence stage: a source first
    // earns relevance, creator evidence, citation expansion, credibility and
    // grounded claims; only then may an AI-assisted relationship label be
    // attached. Until then the note carries the honest generic aid label.
    let classification = isModernPipeline ? null : await classify();
    if (classification && !classification.heuristic) {
      logUsage("relationship_classification", "classification", classification.model, classification.promptTokens, classification.completionTokens);
    }
    const relevanceConfidence = isModernPipeline ? assessment.confidence : classification!.confidence;
    const provisionalCategory: RelationshipCategory = classification?.category ?? "interpretive_aid";

    const isScholarly = r.resourceType === "book" || r.resourceType === "article";
    const bibId = isScholarly ? await findOrCreateBibFromResource(r) : null;
    const openAccess = findOpenAccessEvidence(r.raw, r.url);
    const resourceWork = deriveWorkIdentity(r, { citedAuthorSurnames: identity.citedAuthorSurnames });
    const candidateNormalizedKey = normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year });

    const insertedResourceRows = await db
      .insert(researchResources)
      .values({
        runId: input.runId,
        title: r.title,
        url: r.url,
        resourceType: r.resourceType,
        provider: r.provider,
        accessStatus: openAccess ? "open" : "metadata_only",
        inspectionDepth: r.snippet ? 1 : 0,
        doi: canonicalizeDoi(r.doi),
        isbn: canonicalizeIsbn(r.isbn),
        canonicalUrl: canonicalizeUrl(r.url),
        normalizedKey: candidateNormalizedKey,
        // Canonical WORK identity, so the Library can show one entry per work
        // with its reviews and editions attached instead of repeating a book.
        workKey: resourceWork.key,
        workRole: resourceWork.role,
        workCanonicalTitle: resourceWork.canonicalTitle,
        workAuthorSurname: resourceWork.authorSurname,
        workEvidence: resourceWork.evidence,
        year: r.year,
        authors: r.authors,
        bibRecordId: bibId,
        raw: r.raw,
      })
      // D-23-xx (floors2 crash): two independently-accepted candidates in the
      // SAME run can legitimately resolve `deriveWorkIdentity`/`normalizedKey`
      // onto the identical (runId, normalizedKey) pair with DIFFERENT
      // work_role/work_evidence (e.g. one candidate is the primary edition,
      // another is a review of it that also carries the same DOI-derived
      // key) — `research_resource_run_key_unique` then rejects the second
      // insert outright, and an unguarded insert crashed the whole job 6/6
      // times in production. First-in wins: the row an earlier iteration of
      // this same loop already committed is kept exactly as-is. There is no
      // codebase precedent for merging two conflicting NON-NULL values onto
      // one row — `findOrCreateWorkIdentity`'s own "backfill" pattern (this
      // file) only ever fills a column that is still NULL, and explicitly
      // never overwrites one that already has a value — so inventing a
      // merge here for `work_role`/`work_evidence` would be new, unproven
      // policy. Skip the rest of this candidate's writes instead and log a
      // structured warning so the collision stays visible without crashing.
      .onConflictDoNothing({ target: [researchResources.runId, researchResources.normalizedKey] })
      .returning({ id: researchResources.id });

    if (!insertedResourceRows.length) {
      reportEvent("research_resource_duplicate_key_skipped", {
        scope: "worker.analyzeEditionRun",
        runId: input.runId,
        documentId: input.documentId,
        normalizedKey: candidateNormalizedKey,
        skippedTitle: r.title,
        skippedProvider: r.provider,
        skippedWorkRole: resourceWork.role,
        skippedWorkEvidence: resourceWork.evidence,
      });
      continue;
    }
    const [resourceRow] = insertedResourceRows;

    // Provider/query provenance was already retained in raw metadata, but a
    // first-class row makes a source node's evidence inspectable without
    // parsing provider-specific JSON. The graph joins this run-scoped record.
    await db.insert(resourceProvenance).values({
      resourceId: resourceRow.id,
      provider: r.provider,
      query: qg.lanes.flatMap((lane) => lane.queries).join(" | ").slice(0, 2_000),
      inspectedAt: new Date(),
      inspectionDepth: r.snippet ? 1 : 0,
    });

    if (openAccess) {
      const retrieved = openAccessRetrievals < RESEARCH_LIMITS.maxOpenAccessRetrievals
        ? (openAccessRetrievals++, await retrieveOpenAccessText(openAccess))
        : { status: "open_access_available" as const, error: "Automatic open-access retrieval cap reached for this run." };
      await db.insert(researchResourceContents).values({
        resourceId: resourceRow.id,
        status: retrieved.status,
        sourceUrl: openAccess.sourceUrl,
        license: openAccess.license,
        licenseEvidence: openAccess.evidence,
        ...(retrieved.status === "open_access_indexed"
          ? { text: retrieved.text, contentHash: retrieved.contentHash, retrievedAt: retrieved.retrievedAt }
          : { error: retrieved.error ?? null }),
      });
    }
    relationProjection.push({ id: resourceRow.id, workKey: resourceWork.key, workRole: resourceWork.role });

    await setStage("classification", "credibility", undefined, sourceProgress);
    // Structural cues (study design, sample size, statistics, hedging) beat
    // the old binary "does any snippet exist" check for scholarly articles —
    // deterministic, no model call, scoped to where the regex classes
    // actually mean something (see structuralEvidenceStrength's doc comment).
    const evidenceStrengthSignal = structuralEvidenceStrength(r);
    const cred = buildCredibility(r, {
      relevance: Math.max(0, Math.min(1, relevanceConfidence)),
      inspectionDepth: r.snippet ? 1 : 0,
      evidenceStrength: evidenceStrengthSignal.score,
    });
    // Single independent source at this stage → agreement is honestly insufficient.
    const agreement = computeAgreement(1, 0);
    const creatorKey = normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year }) ?? r.title;
    const v3Credibility = isModernPipeline
      ? assessCredibilityV3(r, {
          relevance: Math.max(0, Math.min(1, relevanceConfidence)),
          evidenceStrength: evidenceStrengthSignal.score,
          evidenceStrengthWhy: evidenceStrengthSignal.why,
          creator: verifiedCreators.get(creatorKey),
        })
      : null;
    await db.insert(credibilityAssessments).values({
      resourceId: resourceRow.id,
      score: cred.score,
      authority: cred.authority,
      relevance: cred.relevance,
      inspectionDepth: cred.inspectionDepth,
      evidenceStrength: cred.evidenceStrength,
      agreement,
      components: cred,
      rationale: cred.rationale,
      ...(v3Credibility ? {
        publicationRigor: v3Credibility.dimensions.publicationRigor,
        creatorExpertise: v3Credibility.dimensions.creatorExpertise,
        hostProvenance: v3Credibility.dimensions.hostProvenance,
        pedagogicalValue: v3Credibility.dimensions.pedagogicalValue,
        creator: v3Credibility.creator,
        peerReviewed: publicationRigor(r).peerReviewed,
        popularity: v3Credibility.popularity,
        rationale: v3Credibility.rationale,
      } : {}),
    });

    const evidenceText = (r.snippet ?? r.title).slice(0, 1000);
    const [evidence] = await db
      .insert(evidenceSpans)
      .values({ runId: input.runId, resourceId: resourceRow.id, quote: evidenceText })
      .returning({ id: evidenceSpans.id });

    await db.insert(editionRelations).values({
      runId: input.runId,
      resourceId: resourceRow.id,
      relationType: provisionalCategory,
      depth: r.resourceType === "unresolved-citation" ? 0 : 1,
      importance: cred.score,
      evidence: { category: provisionalCategory, sourceText: evidenceText.slice(0, 300), citationFrequency },
      confidence: relevanceConfidence,
    });

    // Critical note: LLM prose synthesis while under the soft cap and within the
    // hard cap, else the deterministic grounded floor. Claims are graded so a
    // factual claim survives only if its quote is grounded in evidence AND the
    // authority bar is met (plan §33) — the model can neither invent a quotation
    // nor over-assert.
    const authorityOk = meetsFactualBar([authority]);
    const evidenceTexts = [evidenceText, r.snippet ?? ""].filter((t) => t.length > 0);
    let noteBody = heuristicNote(r, provisionalCategory);
    let gradedClaims: { text: string; claimType: "factual" | "interpretive" | "inferred"; grounded: boolean }[] = [];
    if (responses.available && !overSoftCap(budget) && canAfford(budget, NOTE_COST_ESTIMATE)) {
      const syn = await synthesizeNote(responses, {
        primary: { title: doc.title, author: doc.authorName },
        resource: r,
        relation: provisionalCategory,
        evidenceTexts,
        authorityOk,
        model: researchModel,
        safetyIdentifier,
      });
      if (syn.usedModel) {
        noteBody = syn.body;
        gradedClaims = syn.claims;
        logUsage("note_synthesis", "note-synthesis", researchModel, syn.promptTokens, syn.completionTokens);
      }
    }
    await setStage("classification", "claims", undefined, sourceProgress);
    const [note] = await db
      .insert(generatedNotes)
      .values({ runId: input.runId, evidenceSpanId: evidence.id, noteType: provisionalCategory, body: noteBody, confidence: relevanceConfidence })
      .returning({ id: generatedNotes.id });
    const claimsToInsert = gradedClaims.length > 0 ? gradedClaims : [{ text: noteBody, claimType: "interpretive" as const, grounded: false }];
    for (const gc of claimsToInsert) {
      const [claim] = await db
        .insert(generatedClaims)
        .values({ runId: input.runId, noteId: note.id, text: gc.text, claimType: gc.claimType, agreement, confidence: relevanceConfidence })
        .returning({ id: generatedClaims.id });
      await db.insert(claimEvidence).values({ claimId: claim.id, evidenceSpanId: evidence.id, stance: "supports" });
    }

    // Catalogue/graph projection for scholarly targets (roadmap + graph reuse).
    await setStage("classification", "conservative-influence-classification", undefined, sourceProgress);
    if (isModernPipeline) classification = await classify();
    if (!classification!.heuristic && isModernPipeline) {
      logUsage("relationship_classification", "conservative-influence-classification", classification!.model, classification!.promptTokens, classification!.completionTokens);
    }
    const conservativeCategory = isModernPipeline
      ? conservativeInfluenceClassification(classification!.category, evidenceText)
      : classification!.category;
    if (isModernPipeline) {
      await db.update(editionRelations).set({
        relationType: conservativeCategory,
        evidence: { category: conservativeCategory, sourceText: evidenceText.slice(0, 300), citationFrequency },
        confidence: classification!.confidence,
      }).where(and(eq(editionRelations.runId, input.runId), eq(editionRelations.resourceId, resourceRow.id)));
      await db.update(generatedNotes).set({ noteType: conservativeCategory, confidence: classification!.confidence }).where(eq(generatedNotes.id, note.id));
    }
    if (bibId) {
      // D-21-6: idempotent-safe on reprocess, same concern as the concept
      // edge above — graph_edge carries no runId of its own. Unlike the
      // concept edge, though, a reclassification can change the edgeType
      // itself (e.g. Phase 11.7's prerequisite fix), so a plain
      // existence-check-and-skip keyed on (source, target, edgeType) would
      // leave a stale category's edge sitting alongside the new one instead
      // of being superseded. Clear any prior SYSTEM classification edge for
      // this exact (work, target) pair — regardless of its edgeType —
      // immediately before writing the fresh one, so only the latest run's
      // classification survives for that pair, matching the legacy
      // `analyzeWork` path's "clear prior system output, then reinsert"
      // semantics (see its full-work clear above `resolveCitationMetadata`).
      await db
        .delete(graphEdges)
        .where(
          and(
            eq(graphEdges.userId, doc.userId),
            eq(graphEdges.sourceType, "work"),
            eq(graphEdges.sourceId, doc.workId),
            eq(graphEdges.targetType, "bibliographic_record"),
            eq(graphEdges.targetId, bibId),
            eq(graphEdges.createdBy, "system"),
          ),
        );
      await db.insert(graphEdges).values({
        userId: doc.userId,
        sourceType: "work",
        sourceId: doc.workId,
        targetType: "bibliographic_record",
        targetId: bibId,
        edgeType: edgeValue(CATEGORY_TO_EDGE[conservativeCategory]),
        weight: 1,
        confidence: classification!.confidence,
        evidence: { category: conservativeCategory, provider: r.provider, citationFrequency },
        createdBy: "system",
      });
    }

    // Promote into the standing Library (plan §34.4 9.5), v3 only: a durable,
    // cross-run/cross-user projection so a reader's next visit shows what was
    // already discovered, not just this run's own "Sources consulted" panel.
    // `unresolved-citation` stubs (no real content) and a resource whose title
    // has no normalizable identity (rare — see `normalizedKey`'s doc comment)
    // are skipped rather than promoted as unreadable/unkeyable ghost entries.
    if (isModernPipeline && primaryWorkIdentityId && r.resourceType !== "unresolved-citation") {
      const libraryKey = normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year });
      if (libraryKey) {
        // Verified identifiers feed the precedence chain only from a
        // PRIMARY-role record: a review's own DOI must never become the
        // reviewed work's DOI (plan §20.6).
        const resourceWorkIdentityId = await findOrCreateWorkIdentity(
          resourceWork,
          r.authors,
          resourceWork.role === "primary" ? { doi: r.doi, isbn: r.isbn, year: r.year } : {},
        );
        const libraryFields = {
          workIdentityId: resourceWorkIdentityId,
          workRole: resourceWork.role,
          title: r.title,
          url: r.url,
          canonicalUrl: canonicalizeUrl(r.url),
          doi: canonicalizeDoi(r.doi),
          isbn: canonicalizeIsbn(r.isbn),
          resourceType: r.resourceType,
          provider: r.provider,
          year: r.year,
          authors: r.authors,
          venue: r.venue,
          creator: v3Credibility?.creator ?? null,
          peerReviewed: publicationRigor(r).peerReviewed,
          popularity: v3Credibility?.popularity ?? null,
          bibRecordId: bibId,
        };
        const [learningResource] = await db
          .insert(learningResources)
          .values({ ...libraryFields, normalizedKey: libraryKey })
          .onConflictDoUpdate({ target: learningResources.normalizedKey, set: { ...libraryFields, updatedAt: new Date() } })
          .returning({ id: learningResources.id });

        await db
          .insert(resourceRoles)
          .values({
            learningResourceId: learningResource.id,
            workIdentityId: primaryWorkIdentityId,
            relationship: conservativeCategory,
            // The classifier's own conservative, opt-in suggestion (null =
            // universal, its default) — see `@ice/ai-adapters`'s
            // `ClassificationResult.readerLevel` doc comment. Citation-only
            // roles (`ensureCitationRole`, above) intentionally stay null:
            // citations are genuinely universal, not just unclassified.
            readerLevel: classification!.readerLevel,
            rationale: noteBody,
            confidence: classification!.confidence,
            createdBy: "system",
          })
          .onConflictDoUpdate({
            target: [resourceRoles.learningResourceId, resourceRoles.workIdentityId, resourceRoles.readerLevel],
            set: { relationship: conservativeCategory, rationale: noteBody, confidence: classification!.confidence },
          });
      }
    }

    // Incremental flush (floors2 crash follow-up, §5 item 2): this loop is
    // where the production crash actually happened, and it can run up to
    // `maxFullInspections * 2` iterations (see selection.ts's defense-in-
    // depth cap) — bound how much a crash inside THIS loop specifically
    // could still leave unpersisted, on top of the unconditional `finally`
    // flush below. Safe to call every iteration: it's a no-op whenever fewer
    // than `USAGE_FLUSH_BATCH_SIZE` new entries have accumulated.
    if (usageLogs.length - flushedUsageCount >= USAGE_FLUSH_BATCH_SIZE) await flushUsageLogs();
  }

  // Persist only deterministic, provenance-backed source-to-source links.
  // A review/edition/translation is connected to the discovered primary record
  // that shares its derived work identity; this is not a vector similarity
  // guess and the exact grouping evidence remains on both resource rows.
  const byWorkKey = new Map<string, typeof relationProjection>();
  for (const row of relationProjection) {
    if (!row.workKey) continue;
    byWorkKey.set(row.workKey, [...(byWorkKey.get(row.workKey) ?? []), row]);
  }
  for (const [workKey, rows] of byWorkKey) {
    const primary = rows.find((row) => row.workRole === "primary");
    if (!primary) continue;
    for (const related of rows) {
      if (related.id === primary.id) continue;
      await db.insert(editionRelations).values({
        runId: input.runId,
        resourceId: related.id,
        relatedResourceId: primary.id,
        relationType: `${related.workRole}_of`,
        depth: 1,
        importance: 1,
        evidence: { provenance: "shared_work_identity", workKey, relatedRole: related.workRole },
        confidence: 1,
      });
    }
  }

  // D-20-68: link any citation this run's own discovery already found a
  // candidate for (see linkCitationsToRunDiscoveries's doc comment) — must run
  // after every research_resource row for this run has been inserted (i.e.
  // after the `ranked` loop above), and before the run is marked validated, so
  // this pass always sees the run's own complete discovery set.
  await linkCitationsToRunDiscoveries(input.documentId, input.runId);

  await flushUsageLogs();

  // `degraded` means the edition is WORSE than it should be — not that
  // discovery finished within its budget. Hitting the pre-dedup resource cap
  // or saturating are healthy outcomes: they mean enough was found and the run
  // stopped on purpose. A 10-document load test had all ten successful,
  // full-structure editions telling the reader they were degraded, which is
  // crying wolf: a warning shown on every run carries no information.
  //
  // The soft cap is different in kind — passing it means synthesis was cut
  // short, so the edition genuinely has less in it than intended.
  const degraded = overSoftCap(budget);
  await db
    .update(processingRuns)
    .set({
      stage: "validation",
      // Direct update, not the `setStage` closure — reset explicitly so the
      // just-finished per-source loop's last count doesn't linger.
      stageSourceIndex: null,
      stageSourceTotal: null,
      aiCostUsd: budget.spentUsd - seededUsd,
      degraded,
      saturationNote: discovery.saturationNote,
      updatedAt: new Date(),
    })
    .where(eq(processingRuns.id, input.runId));
  } catch (error) {
    // Error-cause preservation (floors2 crash follow-up, §5 error-cause
    // item): the caller (`extraction.ts`'s catch block) only ever persists
    // `error.message` onto `processing_run.error`/`document.processingError`.
    // Drizzle wraps the real driver error in `DrizzleQueryError`, whose own
    // `.message` is just "Failed query: ... params: ...", losing the actual
    // Postgres error (`.cause.message`/`.cause.code`, e.g. `23505` unique-
    // violation or `42P01` undefined-table — this project's own already-
    // documented pg/Drizzle gotcha, see PROJECT-LOG Known Problems). Fold the
    // cause into the message here, at the source, so whatever later reads
    // `error.message` — with no change needed on its part — gets the real
    // driver detail instead of having to dig for it after the fact.
    const err = error instanceof Error ? error : new Error(String(error));
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    if (cause && (cause.message || cause.code)) {
      err.message = `${err.message} [cause${cause.code ? `: ${cause.code}` : ""}${cause.message ? ` ${cause.message}` : ""}]`;
    }
    throw err;
  } finally {
    // Unconditional, whether the try block succeeded or threw: persist
    // whatever usage this run actually incurred. `flushUsageLogs` inserts
    // only the delta since its last call (via `flushedUsageCount`), so
    // calling it again here after the success path already flushed is a
    // safe no-op, not a duplicate insert. On a throw, this is what makes the
    // spend from THIS attempt's own `ai_usage_log` rows visible to the next
    // attempt's budget seed above (the seed sums `ai_usage_log`, not this
    // column) instead of vanishing along with the crash. `aiCostUsd` itself
    // is set to `budget.spentUsd - seededUsd` — this run's own spend only,
    // matching the success-path update above and the per-run invariant.
    await flushUsageLogs();
    await db
      .update(processingRuns)
      .set({ aiCostUsd: budget.spentUsd - seededUsd, updatedAt: new Date() })
      .where(eq(processingRuns.id, input.runId));
  }
}
