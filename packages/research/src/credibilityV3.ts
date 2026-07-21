import type { CreatorIdentity, CreatorVerification } from "./creator";
import { identifyCreator } from "./creator";
import { canonicalizeUrl } from "./normalize";
import { classifyAuthority } from "./credibility";
import type { RawResource, SourceAuthority } from "./types";

/**
 * Credibility as separated dimensions (plan §34.2, Phase 9.2).
 *
 * Phase 8's A–E authority band answered one question well: may this source
 * support a factual claim? A learning workspace asks several more, and they
 * genuinely come apart. A recorded lecture by the field's leading scholar has
 * high creator expertise and high pedagogical value with NO publication rigor
 * whatsoever; a weak peer-reviewed paper is the reverse. Collapsing those into
 * one number tells the reader neither thing, and quietly makes "not
 * peer-reviewed" mean "not credible", which is false.
 *
 * So each dimension is scored, stored and displayed on its own — and
 * POPULARITY IS NOT ONE OF THEM. It is carried alongside as a reported fact,
 * never summed, never weighted, never allowed to move a score. There is a test
 * asserting exactly that, because it is the rule most likely to be eroded by a
 * later "just a small ranking tweak".
 */

export interface PopularitySignal {
  /** As reported by the provider (citations, views, likes). Never scored. */
  value: number | null;
  /** What the number counts — a citation count and a view count are not alike. */
  kind: "citations" | "views" | "likes" | "unknown";
  provider: string;
}

export interface CredibilityDimensions {
  /** Editorial/peer-review process behind the artifact. */
  publicationRigor: number;
  /** What we can establish about who made it (see `creator`). */
  creatorExpertise: number;
  /** Where it lives — institutional host, scholarly index, open platform. */
  hostProvenance: number;
  /** How well the specific claims drawn from it are grounded in quoted evidence. */
  evidenceStrength: number;
  /** Subject relevance, decided by the relevance gate BEFORE any of this. */
  relevance: number;
  /** Usefulness for learning: does it teach, or does it presuppose? */
  pedagogicalValue: number;
}

export interface CredibilityAssessmentV3 {
  dimensions: CredibilityDimensions;
  /** Retained from Phase 8: the factual-claim gate still speaks in A–E. */
  authority: SourceAuthority;
  creator: CreatorIdentity;
  /** Reported, displayed, and excluded from every score above. */
  popularity: PopularitySignal;
  rationale: string;
}

const SCHOLARLY_INDEXES = new Set(["crossref", "openalex", "semanticscholar"]);
const BOOK_CATALOGUES = new Set(["openlibrary", "googlebooks"]);

export interface StructuralEvidenceSignal {
  score: number;
  why: string;
}

// Structurally checkable cues in a scholarly abstract — none of this
// requires a model call to detect, only requires the abstract to exist.
const STUDY_DESIGN_RE = /\b(randomi[sz]ed controlled trial|rct|meta-analysis|systematic review|cohort study|case-control|longitudinal study|case study)\b/i;
const SAMPLE_SIZE_RE = /\bn\s*=\s*\d+\b|\bsample of \d+\b|\b\d+\s+participants\b/i;
const STATISTICS_RE = /\bp\s*[<>=]\s*0?\.\d+|\b95%\s*ci\b|\bconfidence interval\b|\beffect size\b|\bcohen'?s d\b/i;
const HEDGING_RE = /\b(preliminary|may suggest|further research is needed|limited evidence|small sample|inconclusive|tentative(ly)?)\b/i;

/**
 * Deterministic structural signal for evidence strength (Phase 10, plan §35.3
 * — a general two-stage-scoring technique, not copied from any specific
 * project): scans the abstract/snippet text scholarly providers actually
 * return (Crossref/OpenAlex/Semantic Scholar) for a named study design, a
 * reported sample size, inferential statistics, or hedging language, rather
 * than the prior heuristic's binary "does any snippet exist at all" check —
 * which credited a one-line marketing blurb exactly as much as a real
 * methods-bearing abstract.
 *
 * Deliberately scoped to scholarly-article resources: these regex classes
 * (RCT, p-value, Cohen's d) don't meaningfully apply to a web page or video,
 * so every other resource type/provider keeps the plain existence-based
 * fallback the caller already had — this narrows what changes, it doesn't
 * replace the whole heuristic.
 */
export function structuralEvidenceStrength(r: RawResource): StructuralEvidenceSignal {
  if (!r.snippet) return { score: 0.3, why: "no abstract/snippet available" };
  if (!SCHOLARLY_INDEXES.has(r.provider) || r.resourceType !== "article") {
    return { score: 0.6, why: "snippet available (non-scholarly source, no structural cues checked)" };
  }

  const text = r.snippet;
  const found: string[] = [];
  let score = 0.5; // baseline: a real scholarly abstract exists at all

  if (STUDY_DESIGN_RE.test(text)) {
    score += 0.15;
    found.push("named study design");
  }
  if (SAMPLE_SIZE_RE.test(text)) {
    score += 0.1;
    found.push("reported sample size");
  }
  if (STATISTICS_RE.test(text)) {
    score += 0.1;
    found.push("inferential statistics");
  }
  if (HEDGING_RE.test(text)) {
    // Hedging is itself a legitimate signal (the source is honest about its
    // own limits), not a penalty for bad writing — it still nudges the score
    // down because it's evidence the claims are weaker, not because of tone.
    score -= 0.1;
    found.push("hedging language");
  }

  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const why = found.length > 0 ? `abstract signals: ${found.join(", ")}` : "abstract present, no structural signals found";
  return { score: clamp(score), why };
}

const INSTITUTIONAL_TLD = /\.(edu|gov|mil|ac\.[a-z]{2}|edu\.[a-z]{2}|gov\.[a-z]{2})$/i;
const SCHOLARLY_HOST =
  /(^|\.)(jstor|plato\.stanford|nature|science|springer|wiley|cambridge|oup|tandfonline|sciencedirect|arxiv|philpapers|projectmuse|degruyter|brill)\./i;

/** Titles/venues that advertise a teaching intent rather than a research result. */
const PEDAGOGICAL_FORM =
  /\b(introduction|introducing|introductory|guide|companion|handbook|overview|survey|primer|lecture|lectures|course|seminar|tutorial|explained|for beginners|textbook|encyclopedia|encyclopaedia)\b/i;
/** Signals of a specialist research artifact — useful, but not a starting point. */
const SPECIALIST_FORM = /\b(a note on|towards a|reconsidered|revisited|reply to|rejoinder|erratum|festschrift)\b/i;

function hostOf(url: string | null): string | null {
  const canonical = canonicalizeUrl(url);
  if (!canonical) return null;
  return canonical.split("/")[0] || null;
}

/**
 * Peer review is a property of the venue, not of the content, and we only
 * claim it where a provider's own record implies it. `null` means unknown —
 * never "no".
 */
export function publicationRigor(r: RawResource): { score: number; peerReviewed: boolean | null; why: string } {
  if (SCHOLARLY_INDEXES.has(r.provider) && r.doi && r.resourceType === "article") {
    return { score: 0.95, peerReviewed: true, why: "article with a DOI in a scholarly index" };
  }
  if (SCHOLARLY_INDEXES.has(r.provider) && r.resourceType === "book" && (r.doi || r.isbn)) {
    return { score: 0.8, peerReviewed: true, why: "catalogued academic book" };
  }
  if (SCHOLARLY_INDEXES.has(r.provider)) {
    // Indexed but without an identifier: preprints and records of record.
    return { score: 0.55, peerReviewed: null, why: "indexed scholarly record without a DOI/ISBN" };
  }
  if (BOOK_CATALOGUES.has(r.provider)) {
    return r.isbn
      ? { score: 0.6, peerReviewed: null, why: "book with an ISBN from a catalogue (editorial, not peer, review)" }
      : { score: 0.35, peerReviewed: null, why: "catalogue record without an ISBN" };
  }
  if (r.resourceType === "video" || r.resourceType === "webpage") {
    return { score: 0.1, peerReviewed: false, why: "self-published: no editorial or peer review process" };
  }
  return { score: 0.05, peerReviewed: false, why: "no publication process behind this source" };
}

const EXPERTISE_BY_VERIFICATION: Record<CreatorVerification, number> = {
  scholarly_record: 0.95,
  institutional: 0.7,
  named: 0.4,
  pseudonymous: 0.15,
  // Not zero-as-in-bad: zero as in "we established nothing". The rationale
  // says which, so a reader is never shown an absence dressed up as a verdict.
  anonymous: 0,
};

export function creatorExpertise(creator: CreatorIdentity): { score: number; why: string } {
  const score = EXPERTISE_BY_VERIFICATION[creator.verification];
  const who = creator.displayName ?? creator.handle ?? "an unidentified creator";
  return {
    score,
    why:
      creator.verification === "anonymous"
        ? "creator could not be identified (not a judgement about them — an absence of evidence)"
        : `${who}: ${creator.verification.replace("_", " ")}`,
  };
}

export function hostProvenance(r: RawResource): { score: number; why: string } {
  const host = hostOf(r.url);
  if (SCHOLARLY_INDEXES.has(r.provider)) return { score: 0.9, why: `resolved through the ${r.provider} index` };
  if (host && SCHOLARLY_HOST.test(host)) return { score: 0.9, why: `hosted by the scholarly publisher ${host}` };
  if (host && INSTITUTIONAL_TLD.test(host)) return { score: 0.75, why: `hosted on the institutional domain ${host}` };
  if (BOOK_CATALOGUES.has(r.provider)) return { score: 0.6, why: `listed in the ${r.provider} catalogue` };
  if (r.provider === "youtube") return { score: 0.3, why: "hosted on an open video platform" };
  if (host) return { score: 0.35, why: `hosted on the general-web domain ${host}` };
  return { score: 0.2, why: "no host could be determined" };
}

/**
 * Pedagogical value: would this help someone LEARN the subject, as opposed to
 * advance it? Deliberately independent of rigor — this is the dimension that
 * lets a good lecture outrank a narrow research note for a beginner without
 * anyone having to pretend the lecture was peer-reviewed.
 */
export function pedagogicalValue(r: RawResource): { score: number; why: string } {
  const haystack = `${r.title} ${r.venue ?? ""}`;
  if (PEDAGOGICAL_FORM.test(haystack)) {
    return { score: 0.9, why: "presents itself as teaching material (introduction/guide/lecture/companion)" };
  }
  if (SPECIALIST_FORM.test(haystack)) {
    return { score: 0.25, why: "a specialist intervention addressed to people already in the debate" };
  }
  if (r.resourceType === "video") return { score: 0.6, why: "recorded talk: often expository even when untitled as such" };
  if (r.resourceType === "book") return { score: 0.6, why: "book-length treatment: usually builds its own context" };
  if (r.resourceType === "article") return { score: 0.4, why: "research article: assumes familiarity with the debate" };
  return { score: 0.3, why: "no pedagogical signal in the metadata" };
}

function popularityOf(r: RawResource): PopularitySignal {
  const kind: PopularitySignal["kind"] = SCHOLARLY_INDEXES.has(r.provider)
    ? "citations"
    : r.provider === "youtube"
      ? "views"
      : r.provider === "mastodon" || r.provider === "bluesky"
        ? "likes"
        : "unknown";
  return { value: r.popularity, kind, provider: r.provider };
}

/**
 * Assemble every dimension for one resource.
 *
 * `relevance` and `evidenceStrength` are passed IN rather than computed here:
 * relevance is settled by the relevance gate before authority is ever
 * considered (the Phase 8 ordering that fixed precision), and evidence
 * strength is a property of the quotes actually extracted, which this module
 * never sees.
 */
export function assessCredibilityV3(
  r: RawResource,
  opts: {
    relevance: number;
    evidenceStrength: number;
    /** Optional rationale for evidenceStrength, e.g. from `structuralEvidenceStrength()` — included in the rationale string when present, matching every other dimension's `.why`. */
    evidenceStrengthWhy?: string;
    creator?: CreatorIdentity;
  },
): CredibilityAssessmentV3 {
  const creator = opts.creator ?? identifyCreator(r);
  const rigor = publicationRigor(r);
  const expertise = creatorExpertise(creator);
  const host = hostProvenance(r);
  const pedagogy = pedagogicalValue(r);
  const clamp = (n: number) => Math.max(0, Math.min(1, n));

  const dimensions: CredibilityDimensions = {
    publicationRigor: rigor.score,
    creatorExpertise: expertise.score,
    hostProvenance: host.score,
    evidenceStrength: clamp(opts.evidenceStrength),
    relevance: clamp(opts.relevance),
    pedagogicalValue: pedagogy.score,
  };

  const popularity = popularityOf(r);
  const rationale = [
    `publication rigor ${rigor.score.toFixed(2)} — ${rigor.why}`,
    `creator expertise ${expertise.score.toFixed(2)} — ${expertise.why}`,
    `host provenance ${host.score.toFixed(2)} — ${host.why}`,
    `evidence strength ${dimensions.evidenceStrength.toFixed(2)}${opts.evidenceStrengthWhy ? ` — ${opts.evidenceStrengthWhy}` : ""}`,
    `relevance ${dimensions.relevance.toFixed(2)}`,
    `pedagogical value ${pedagogy.score.toFixed(2)} — ${pedagogy.why}`,
    popularity.value == null
      ? "popularity not reported; it is displayed only and never scored"
      : `popularity ${popularity.value} ${popularity.kind}, displayed only and never scored`,
  ].join("; ");

  return { dimensions, authority: classifyAuthority(r), creator, popularity, rationale };
}

/**
 * A single 0–1 roll-up, for ORDERING ONLY. The reader is always shown the
 * dimensions; this exists so a list has a defensible default order.
 *
 * Popularity is absent by construction — it is not a parameter of this
 * function, so it cannot leak into the ordering by accident.
 */
export function orderingScore(d: CredibilityDimensions): number {
  const weighted =
    d.relevance * 0.3 +
    d.publicationRigor * 0.2 +
    d.creatorExpertise * 0.2 +
    d.hostProvenance * 0.1 +
    d.evidenceStrength * 0.2;
  return Math.max(0, Math.min(1, weighted));
}

/**
 * Ordering for a reader who is learning rather than researching: the same
 * dimensions, with teaching value carrying real weight. Still no popularity.
 *
 * Host provenance is deliberately ABSENT here, and pedagogical value is the
 * largest term after relevance. The first attempt kept both and weighted
 * teaching at 0.25 — which put a specialist research note ("A Note on…,
 * Reconsidered") above an expert introductory lecture, because rigor and host
 * provenance both measure roughly "is this an academic artifact" and together
 * outvoted the one dimension this ordering exists to express. Two correlated
 * terms silently double-counting is exactly how a "learning" ordering ends up
 * being the research ordering wearing a different name.
 *
 * Rigor still counts, so a rigorous introduction ranks above a lecture, and
 * an anonymous post with nothing behind it ranks below both.
 */
export function learningOrderingScore(d: CredibilityDimensions): number {
  const weighted =
    d.relevance * 0.3 +
    d.pedagogicalValue * 0.35 +
    d.creatorExpertise * 0.2 +
    d.publicationRigor * 0.15;
  return Math.max(0, Math.min(1, weighted));
}

/**
 * The honest label a source carries in the UI. "Not peer-reviewed" is a fact
 * about process, deliberately stated without implying "not credible" — an
 * acceptance gate for Phase 9 is that a relevant expert lecture is accepted
 * AND correctly labelled this way.
 */
export function processLabel(r: RawResource): string {
  const { peerReviewed } = publicationRigor(r);
  if (peerReviewed === true) return "Peer-reviewed or academically published";
  if (peerReviewed === false) return "Not peer-reviewed";
  return "Publication process unknown";
}
