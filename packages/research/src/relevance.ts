import { canonicalizeDoi, canonicalizeUrl, normalizedKey, titleKey } from "./normalize";
import type { RawResource } from "./types";

/**
 * Relevance gate (Phase 8 closeout). Runs BEFORE authority scoring, because
 * authority answers "how trustworthy is this source?" and that question is
 * meaningless until "is this source about the right thing?" is settled. A DOI
 * proves a record exists; it never proves relevance. Popularity proves even
 * less.
 *
 * Every discovered candidate gets exactly one verdict:
 *   accepted    — projects into annotations, Library, roadmap, and graph
 *   quarantined — kept for research review only; never displayed to the reader
 *   rejected    — recorded with a reason, never projected anywhere
 *
 * The gate is deterministic and unit-testable with no network and no LLM. That
 * matters: a relevance decision that can't be replayed can't be audited, and
 * the whole point of this layer is that a wrong inclusion is explainable.
 *
 * Design notes worth keeping:
 *  - An off-discipline venue is NEVER sufficient to reject on its own. Real
 *    catalogues mis-index records (an Irwin festschrift indexed under "Medical
 *    Entomology and Zoology" is a case observed in production data). The gate
 *    degrades the *field* it cannot trust, not the whole record.
 *  - A shared surname is not identity. "Irwin Olsen" in Cell is not Terence
 *    Irwin, and the given-name collision is called out explicitly.
 *  - Uncertainty quarantines. It never silently accepts.
 */

// ---- Query lanes: discovery is run per-lane so a candidate is always judged
// against the question that produced it. ----
export type QueryLane =
  | "explicit_citation"
  | "primary_prerequisite"
  | "historical_background"
  | "concept_doctrine"
  | "scholarly_debate"
  | "author_corpus"
  | "reception_citation"
  | "parallel_literature"
  | "lecture_course"
  | "video_podcast"
  | "blog_newsletter"
  | "public_discussion";

export const QUERY_LANES: readonly QueryLane[] = [
  "explicit_citation",
  "primary_prerequisite",
  "historical_background",
  "concept_doctrine",
  "scholarly_debate",
  "author_corpus",
  "reception_citation",
  "parallel_literature",
  "lecture_course",
  "video_podcast",
  "blog_newsletter",
  "public_discussion",
];

export type CandidateVerdict = "accepted" | "quarantined" | "rejected";

/** Machine-readable reasons. Stored, displayed in research review, and asserted
 *  on in tests — so a verdict is never a bare number. */
export type RelevanceReason =
  | "explicit_citation_match"
  | "author_corpus_match"
  | "core_concept_match"
  | "citation_graph_link"
  | "cited_author_match"
  | "high_topic_overlap"
  | "no_core_concept_match"
  | "low_topic_overlap"
  | "author_collision"
  | "author_collision_given_name"
  | "no_grounding_signal"
  | "unusable_identity"
  | "no_shared_entity"
  | "off_discipline_venue_flagged"
  | "below_accept_threshold";

/** Independent grounding: a reason to believe the candidate belongs that does
 *  not reduce to "the search engine returned it". Required for acceptance of
 *  anything that is not an explicit citation. */
export type GroundingSignal =
  | "explicit_citation"
  | "citation_graph"
  | "author_in_corpus"
  | "cited_author"
  | "core_concept_terms"
  /** Shares a named entity the work centrally discusses (e.g. "Aristotle").
   *  Weak on its own — it is never sufficient for acceptance. */
  | "topic_entity";

/** Canonical identity of the uploaded work, resolved BEFORE any discovery. */
export interface WorkIdentity {
  title: string;
  /** Full author names as resolved from a real catalogue lookup. */
  authors: string[];
  year: number | null;
  doi: string | null;
  /** Broad topical vocabulary of the document (title, abstract, headings,
   *  frequent distinctive terms). Lowercase, single words. */
  topicTerms: string[];
  /** Named entities the document actually discusses (people, works, schools). */
  entityTerms: string[];
  /** The work's OWN distinctive concepts and their morphological variants.
   *  A non-citation candidate that shares none of these is, at best,
   *  same-field-but-different-subject — the gate quarantines it. */
  coreConceptTerms: string[];
  /** Normalized keys of citations actually parsed out of the document. */
  explicitCitationKeys: Set<string>;
  /** Raw reference-list entries extracted from the document. Used to recognise
   *  a discovered resource as something the work actually cites even when the
   *  citation was never resolved to a DOI — most reference entries never are. */
  explicitCitationTexts?: string[];
  /** Surnames appearing in the document's own reference list. */
  citedAuthorSurnames: Set<string>;
  /** Works the citation graph links to this one (normalized keys). */
  citationGraphKeys?: Set<string>;
}

export interface RelevanceSignals {
  lane: QueryLane;
  /** Fraction of the candidate's significant title terms found in the work's
   *  topical/entity vocabulary. */
  topicOverlap: number;
  /** How many of the work's OWN core concepts the candidate shares. */
  coreConceptMatches: string[];
  matchedTerms: string[];
  groundingSignals: GroundingSignal[];
  isExplicitCitation: boolean;
  authorCollision: boolean;
  givenNameCollision: boolean;
  /** True when the indexed venue looks off-discipline. Advisory ONLY — it
   *  flags the field as unreliable and never rejects the record by itself. */
  venueLooksOffDiscipline: boolean;
}

export interface CandidateAssessment {
  verdict: CandidateVerdict;
  confidence: number;
  reasons: RelevanceReason[];
  signals: RelevanceSignals;
  normalizedKey: string | null;
  /** False when the venue field should not be trusted or displayed as-is. */
  venueReliable: boolean;
}

/** Acceptance needs BOTH a high confidence and an independent grounding
 *  signal. Neither alone is enough. */
export const ACCEPT_CONFIDENCE = 0.8;
/** Below this, the candidate is not merely uncertain — it is off-subject. */
export const REJECT_CONFIDENCE = 0.35;
/** Extra topical floor for public/media lanes, where a title is often the only
 *  thing we may lawfully inspect. */
export const PUBLIC_LANE_MIN_OVERLAP = 0.5;
/** A token must be capitalized this many times, and this many times more often
 *  than it appears lowercase, to count as a named entity of the work. */
const ENTITY_MIN_MENTIONS = 3;
const ENTITY_CAP_RATIO = 3;

/**
 * Words the capitalization test flags but which name nothing: sentence-initial
 * connectives, publisher/structural furniture from the extracted PDF, and
 * calendar tokens. Left in, they make the shared-entity requirement toothless —
 * "…in Islamic ethics" would match on "Ethics", and half the catalogue would
 * match on "Oxford" or "Journal".
 */
const ENTITY_BLOCKLIST = new Set([
  // sentence-initial connectives
  "moreover", "similarly", "however", "therefore", "furthermore", "nevertheless", "thus",
  "hence", "finally", "indeed", "also", "first", "second", "third", "since", "although",
  "perhaps", "instead", "rather", "again", "here", "there", "then", "now", "one", "two",
  // publishing / structural furniture
  "journal", "university", "press", "book", "books", "section", "chapter", "volume", "page",
  "pages", "review", "reviews", "article", "philosophy", "ethics", "studies", "quarterly",
  "oxford", "cambridge", "london", "new", "york", "princeton", "harvard", "routledge",
  "content", "downloaded", "terms", "https", "org", "jstor", "doi",
  // calendar
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
]);

const STOP = new Set([
  "the", "and", "for", "with", "from", "into", "a", "an", "of", "on", "in", "to", "at", "by",
  "as", "is", "are", "was", "were", "be", "does", "do", "did", "have", "has", "its", "it",
  "this", "that", "some", "what", "why", "how", "not", "but", "or", "his", "her", "their",
]);

/** Lanes whose candidates are public/non-scholarly by nature. They face the
 *  same relevance bar; only their credibility labelling differs (later). */
const PUBLIC_LANES = new Set<QueryLane>([
  "lecture_course",
  "video_podcast",
  "blog_newsletter",
  "public_discussion",
]);

/**
 * Advisory off-discipline venue hints. Deliberately NOT used to reject:
 * catalogue metadata is often wrong, and a wrong venue on a right record must
 * degrade the venue, not the record.
 */
const OFF_DISCIPLINE_VENUE =
  /\b(marketing|management science|entomology|zoology|clinical|oncolog|cardiolog|surgery|nursing|petroleum|semiconductor|agronom|veterinar|dentistr|dermatolog)\b/i;

function terms(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    // Bare numbers are never topical. Real extractions carry publisher/access
    // furniture (IP addresses, download timestamps) into the body text, and
    // those digits would otherwise become part of the work's vocabulary.
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

function surname(fullName: string): string {
  const parts = fullName.trim().split(/[\s,]+/).filter(Boolean);
  // "Irwin, Terence" → Irwin ; "Terence Irwin" → Irwin
  return (fullName.includes(",") ? parts[0] : parts[parts.length - 1] ?? "").toLowerCase();
}

function givenNames(fullName: string): string[] {
  const parts = fullName.trim().split(/[\s,]+/).filter(Boolean);
  return (fullName.includes(",") ? parts.slice(1) : parts.slice(0, -1)).map((p) => p.toLowerCase());
}

/**
 * Core-concept matching. Variants ("vice"/"vicious") are supplied explicitly by
 * the identity rather than stemmed heuristically — a wrong stem is a silent
 * relevance bug, and these decisions have to be auditable.
 *
 * Multi-word and hyphenated concepts ("self-love") are matched as PHRASES
 * against the raw title. Tokenizing them was a real observed bug: "self-love"
 * split into "self", which then matched "Stem Cell Function, Self-Renewal…" and
 * lent a molecular-biology paper a core-concept signal it had no business
 * having.
 */
export function collectCoreMatches(candidateTerms: string[], core: string[], rawTitle = ""): string[] {
  const tokens = new Set(candidateTerms);
  const haystack = rawTitle.toLowerCase();
  const found = new Set<string>();
  for (const raw of core) {
    const c = raw.toLowerCase().trim();
    if (!c) continue;
    if (/[\s-]/.test(c)) {
      if (haystack.includes(c)) found.add(c);
    } else if (tokens.has(c)) {
      found.add(c);
    }
  }
  return [...found];
}

/**
 * Surnames appearing in the document's own reference list. A reference entry
 * conventionally leads with the author, so the leading capitalized token is a
 * cheap and reliable signal — good enough to say "this work engages that
 * person", which is all the gate asks of it.
 */
export function citedSurnamesFrom(citationTexts: string[]): Set<string> {
  const out = new Set<string>();
  for (const entry of citationTexts) {
    const m = entry.trim().match(/^([A-Z][A-Za-zÀ-ÿ'’-]{2,})/);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

/** Minimum distinctive title tokens before a citation-text match is trusted on
 *  the title alone. Short titles ("Regret", "Mens rea") match too easily. */
const CITATION_MATCH_MIN_TOKENS = 3;
/** A shorter title is still trusted when the entry independently corroborates
 *  it by naming the same author — two weak signals agreeing, not one guess. */
const CITATION_MATCH_MIN_TOKENS_WITH_AUTHOR = 2;
/** Fraction of the candidate's title tokens that must appear in the reference
 *  entry. Deliberately high: a false positive here bypasses the whole gate. */
const CITATION_MATCH_MIN_CONTAINMENT = 0.8;

/**
 * Does a discovered resource correspond to an entry in the document's own
 * reference list? Most reference entries never resolve to a DOI, so key
 * matching alone would miss the majority of genuine explicit citations — and
 * explicit citations are the one category that should sail through the gate.
 *
 * Containment is checked in one direction only (title ⊆ reference entry),
 * because a reference entry legitimately carries extra tokens the title does
 * not (journal, volume, pages, publisher).
 */
export function matchesCitationText(
  titleTokens: string[],
  citationTexts: string[] | undefined,
  authorSurnames: string[] = [],
): boolean {
  if (!citationTexts?.length || titleTokens.length < CITATION_MATCH_MIN_TOKENS_WITH_AUTHOR) return false;
  for (const entry of citationTexts) {
    const entryTokens = new Set(terms(entry));
    if (!entryTokens.size) continue;
    const contained = titleTokens.filter((t) => entryTokens.has(t)).length;
    if (contained / titleTokens.length < CITATION_MATCH_MIN_CONTAINMENT) continue;
    if (titleTokens.length >= CITATION_MATCH_MIN_TOKENS) return true;
    // Short title: require the entry to name the same author too.
    if (authorSurnames.some((s) => entryTokens.has(s))) return true;
  }
  return false;
}

/**
 * Assess one discovered candidate against the resolved work identity.
 * Deterministic: same inputs always produce the same verdict and reasons.
 */
export function assessCandidate(
  candidate: RawResource,
  identity: WorkIdentity,
  lane: QueryLane,
): CandidateAssessment {
  const reasons: RelevanceReason[] = [];
  const grounding: GroundingSignal[] = [];

  const key = normalizedKey({
    doi: candidate.doi,
    isbn: candidate.isbn,
    url: candidate.url,
    title: candidate.title,
    authors: candidate.authors,
    year: candidate.year,
  });

  const candidateTerms = [...new Set(terms(candidate.title))];
  const vocab = new Set([...identity.topicTerms, ...identity.entityTerms].map((t) => t.toLowerCase()));
  const matchedTerms = candidateTerms.filter((t) => vocab.has(t));
  const topicOverlap = candidateTerms.length ? matchedTerms.length / candidateTerms.length : 0;
  const coreConceptMatches = collectCoreMatches(candidateTerms, identity.coreConceptTerms, candidate.title);
  const entityHit = candidateTerms.some((t) => identity.entityTerms.includes(t));

  // ---- Identity signals ----
  const targetSurnames = new Set(identity.authors.map(surname).filter(Boolean));
  const candidateSurnames = candidate.authors.map(surname).filter(Boolean);
  const candidateGivens = candidate.authors.flatMap(givenNames);

  // A collision is only meaningful when the lane actually targeted this author.
  const laneTargetsAuthor = lane === "author_corpus";
  const surnameHit = candidateSurnames.some((s) => targetSurnames.has(s));
  const givenNameCollision =
    !surnameHit && candidateGivens.some((g) => targetSurnames.has(g)) && candidate.authors.length > 0;
  const authorCollision = laneTargetsAuthor && !surnameHit && candidate.authors.length > 0;

  const isExplicitCitation =
    Boolean(key && identity.explicitCitationKeys.has(key)) ||
    matchesCitationText(candidateTerms, identity.explicitCitationTexts, candidateSurnames);
  const inCitationGraph = Boolean(key && identity.citationGraphKeys?.has(key));
  const citedAuthorHit = candidateSurnames.some((s) => identity.citedAuthorSurnames.has(s));

  if (isExplicitCitation) grounding.push("explicit_citation");
  if (inCitationGraph) grounding.push("citation_graph");
  if (laneTargetsAuthor && surnameHit && !givenNameCollision) grounding.push("author_in_corpus");
  if (citedAuthorHit) grounding.push("cited_author");
  if (coreConceptMatches.length > 0) grounding.push("core_concept_terms");
  if (entityHit) grounding.push("topic_entity");

  const venueLooksOffDiscipline = OFF_DISCIPLINE_VENUE.test(candidate.venue ?? "");

  const signals: RelevanceSignals = {
    lane,
    topicOverlap,
    coreConceptMatches,
    matchedTerms,
    groundingSignals: grounding,
    isExplicitCitation,
    authorCollision,
    givenNameCollision,
    venueLooksOffDiscipline,
  };

  const finish = (verdict: CandidateVerdict, confidence: number): CandidateAssessment => {
    if (venueLooksOffDiscipline) reasons.push("off_discipline_venue_flagged");
    return {
      verdict,
      confidence: Math.max(0, Math.min(1, round3(confidence))),
      reasons,
      signals,
      normalizedKey: key,
      venueReliable: !venueLooksOffDiscipline,
    };
  };

  // ---- Hard gates, in order ----

  // No usable identity at all: nothing downstream could cite it honestly.
  if (!key) {
    reasons.push("unusable_identity");
    return finish("rejected", 0);
  }

  // A shared surname is not identity. This fires before anything else can
  // rescue the candidate, because a name collision means we are looking at a
  // different person, however good the other signals look.
  if (givenNameCollision && !surnameHit) {
    reasons.push("author_collision_given_name");
    if (laneTargetsAuthor) reasons.push("author_collision");
    return finish("rejected", 0.05);
  }
  if (authorCollision) {
    reasons.push("author_collision");
    return finish("rejected", 0.1);
  }

  // Rule 3: explicit citations are accepted unless contradictory identity
  // evidence exists — which, at this point, it does not.
  if (isExplicitCitation) {
    reasons.push("explicit_citation_match");
    return finish("accepted", 1);
  }

  // Rule: a confirmed author-corpus hit is strong grounding on its own. This is
  // what keeps a badly-indexed but genuinely authored work (see the venue note
  // above) from being thrown away.
  if (laneTargetsAuthor && surnameHit) {
    reasons.push("author_corpus_match");
    return finish("accepted", Math.max(0.85, 0.6 * topicOverlap + 0.4));
  }

  // ---- Graded assessment ----
  // Core-concept sharing is the load-bearing signal, and deliberately so. A
  // candidate can be in the right field, by an author this work cites, in a
  // first-rank venue — and still be about a different question. Topic overlap
  // alone cannot see that: calibration against real data showed generic but
  // frequent words ("account", "right", "makes") pushing an unrelated Ross
  // paper to 0.75 overlap. Core concepts are what separate subject from field.
  // Sharing ANY core concept is the qualifying step, not a matter of degree —
  // a paper about vice is about vice whether its title says so once or twice.
  // Topic overlap then separates a close reading from a passing mention.
  const hasCore = coreConceptMatches.length > 0;
  let confidence = round3((hasCore ? 0.7 : 0) + 0.3 * topicOverlap);
  if (inCitationGraph) confidence = Math.max(confidence, 0.85);

  reasons.push(hasCore ? "core_concept_match" : "no_core_concept_match");
  if (topicOverlap < 0.2) reasons.push("low_topic_overlap");
  else if (topicOverlap >= 0.6) reasons.push("high_topic_overlap");
  if (citedAuthorHit) reasons.push("cited_author_match");
  if (inCitationGraph) reasons.push("citation_graph_link");

  // Hard floor: no shared concept AND barely any shared vocabulary means the
  // candidate is off-subject, whatever else it has going for it. This is what
  // stops a right-author/right-venue wrong-work match (observed: Hampton's
  // "Mens rea" in the same journal as the work Irwin actually cites).
  if (!hasCore && topicOverlap < 0.2) {
    return finish("rejected", confidence);
  }

  // An off-discipline venue may only push an ALREADY-uncertain candidate from
  // quarantine down to rejected. It can never reject a candidate carrying a
  // core concept, an explicit citation, or author-corpus grounding — those
  // returned above. This is what keeps a mis-indexed record recoverable while
  // still discarding a marketing paper that matched on "Aristotle".
  if (!hasCore && venueLooksOffDiscipline) {
    return finish("rejected", Math.min(confidence, REJECT_CONFIDENCE - 0.01));
  }

  // Without a shared concept the candidate can never be auto-accepted; the best
  // it can do is quarantine for research review, and only when something
  // independent still ties it to this work.
  if (!hasCore) {
    const tie = grounding.length > 0;
    if (!tie) {
      reasons.push("no_grounding_signal");
      return finish("rejected", confidence);
    }
    return finish("quarantined", Math.min(Math.max(confidence, 0.5), ACCEPT_CONFIDENCE - 0.01));
  }

  // Public-source lanes clear the SAME relevance bar as scholarly ones, plus a
  // topical-overlap floor. The extra floor is not snobbery about the medium: a
  // video's title is usually ALL we may lawfully inspect, so a single
  // name-dropped concept is much weaker evidence there than in an article
  // whose abstract we can read. A general "Aristotle & Virtue Theory" explainer
  // fails here; a lecture actually on vice and reason passes.
  if (PUBLIC_LANES.has(lane) && (confidence < ACCEPT_CONFIDENCE || topicOverlap < PUBLIC_LANE_MIN_OVERLAP)) {
    reasons.push("below_accept_threshold");
    return finish("rejected", confidence);
  }

  if (confidence < REJECT_CONFIDENCE) return finish("rejected", confidence);

  if (confidence >= ACCEPT_CONFIDENCE) {
    if (grounding.length === 0) {
      reasons.push("no_grounding_signal");
      return finish("quarantined", confidence);
    }
    // A shared concept word is not a shared subject. Measured on a real
    // production run whose core concepts were "vice" and "reason": matching on
    // those alone admitted consumer-research papers on "vice goods",
    // epistemology's "epistemic vice", and political theory's "public reason"
    // — 74 accepted at roughly 16% precision. Requiring the candidate to ALSO
    // name an entity the work actually discusses (Aristotle, Plato, Aquinas…)
    // is what distinguishes the subject from the vocabulary.
    if (!entityHit) {
      reasons.push("no_shared_entity");
      return finish("quarantined", Math.min(confidence, ACCEPT_CONFIDENCE - 0.01));
    }
    return finish("accepted", confidence);
  }

  reasons.push("below_accept_threshold");
  return finish("quarantined", confidence);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Build the identity's topical/entity/core vocabularies from the document's own
 * text. Kept deterministic and cheap — this runs before any paid call, and a
 * relevance gate that itself costs money defeats the purpose.
 */
export function buildTopicSignature(input: {
  title: string;
  abstract?: string | null;
  headings?: string[];
  bodyText?: string | null;
  /** Concepts the pipeline extracted for this work, plus their variants. */
  concepts?: string[];
  /** The work's own authors. Their names are EXCLUDED from the core-concept
   *  set: a surname is an identity, not a subject. Observed in production —
   *  a provisional title of "Irwin ViceReason 2001" made "irwin" a core
   *  concept, and the gate then accepted "Gage, Irwin", "Bazelon, Irwin" and
   *  "Irwin, John" as though they were on-topic. */
  authors?: string[];
}): Pick<WorkIdentity, "topicTerms" | "entityTerms" | "coreConceptTerms"> {
  const strong = [input.title, input.abstract ?? "", ...(input.headings ?? [])].join(" ");
  const strongTerms = new Set(terms(strong));

  // Frequent distinctive body terms broaden the topical vocabulary without
  // letting one stray mention count as topicality.
  const freq = new Map<string, number>();
  for (const t of terms(input.bodyText ?? "")) freq.set(t, (freq.get(t) ?? 0) + 1);
  const frequent = [...freq.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200)
    .map(([t]) => t);

  // Named entities, approximated without an NER dependency: a token that the
  // document capitalizes far more often than not, and does so repeatedly.
  // "Aristotle" is essentially always capitalized; "reason" essentially never
  // is except at the start of a sentence. The ratio test is what separates
  // them, and it is why entities are read from the BODY, not just the title —
  // a title of "Vice and Reason" names no entity at all.
  const capCount = new Map<string, number>();
  const lowerCount = new Map<string, number>();
  const scan = `${strong} ${input.bodyText ?? ""}`;
  for (const m of scan.matchAll(/\b([A-Za-z][a-z]{2,})\b/g)) {
    const raw = m[1];
    const key = raw.toLowerCase();
    if (STOP.has(key)) continue;
    const bucket = raw[0] === raw[0].toUpperCase() ? capCount : lowerCount;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  const entityTerms = new Set<string>();
  for (const [term, caps] of capCount) {
    const lows = lowerCount.get(term) ?? 0;
    if (ENTITY_BLOCKLIST.has(term)) continue;
    if (caps >= ENTITY_MIN_MENTIONS && caps >= lows * ENTITY_CAP_RATIO) entityTerms.add(term);
  }

  // Multi-word and hyphenated concepts are kept WHOLE so they match as phrases.
  // Tokenizing them leaks generic fragments into the core set ("self-love" →
  // "self"), which is how an unrelated stem-cell paper once acquired a
  // core-concept signal.
  const coreConceptTerms = new Set<string>();
  for (const c of input.concepts ?? []) {
    const norm = c.toLowerCase().trim();
    if (!norm) continue;
    if (/[\s-]/.test(norm)) coreConceptTerms.add(norm);
    else for (const t of terms(norm)) coreConceptTerms.add(t);
  }
  // The title's own distinctive words are core by construction — except the
  // author's own name. Provisional titles are often filename-derived and carry
  // the author ("Irwin-ViceReason-2001.pdf"), and a surname admitted as a core
  // concept matches every unrelated paper by anyone of that name.
  const authorTokens = new Set((input.authors ?? []).flatMap((a) => terms(a)));
  for (const t of terms(input.title)) if (!authorTokens.has(t)) coreConceptTerms.add(t);
  for (const t of authorTokens) coreConceptTerms.delete(t);

  return {
    topicTerms: [...new Set([...strongTerms, ...frequent])],
    entityTerms: [...entityTerms],
    coreConceptTerms: [...coreConceptTerms],
  };
}

/**
 * Assign the lane a discovered resource belongs to.
 *
 * NOTE ON SCOPE: the plan's end state is lane-*specific* query generation, so a
 * candidate's lane is known because of the query that found it. Until that
 * lands, the lane is inferred from what the resource is. That is weaker but
 * honest — and it is sufficient for the gate, which uses the lane only to pick
 * the right bar (author-corpus grounding, public-source overlap floor), not to
 * decide relevance by itself.
 */
export function laneForResource(
  r: Pick<RawResource, "provider" | "resourceType" | "venue" | "url">,
  isExplicitCitation: boolean,
): QueryLane {
  if (isExplicitCitation) return "explicit_citation";
  switch (r.provider) {
    case "mastodon":
    case "bluesky":
      return "public_discussion";
    case "youtube": {
      const host = `${r.venue ?? ""}`;
      // An institutional or scholarly-society channel is a teaching resource;
      // everything else on the platform is treated as general media.
      return /\b(university|universit|college|institute|society|school|lecture|course|faculty|academy)\b/i.test(host)
        ? "lecture_course"
        : "video_podcast";
    }
    case "tavily": {
      const host = canonicalizeUrl(r.url)?.split("/")[0] ?? "";
      if (/\.(edu|ac\.[a-z]{2})(\/|$)/i.test(host)) return "lecture_course";
      return "blog_newsletter";
    }
    default:
      return r.resourceType === "book" ? "primary_prerequisite" : "scholarly_debate";
  }
}

/** Only accepted candidates may be projected downstream. Kept as a named
 *  helper so the rule is enforced in one place rather than re-derived at each
 *  call site. */
export function projectable<T extends { verdict: CandidateVerdict }>(rows: T[]): T[] {
  return rows.filter((r) => r.verdict === "accepted");
}

export { canonicalizeDoi, canonicalizeUrl, titleKey };
