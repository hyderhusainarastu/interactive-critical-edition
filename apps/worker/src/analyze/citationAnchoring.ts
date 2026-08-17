import {
  type CitationFrequencySignal,
  type RelationshipCategory,
} from "@ice/ai-adapters";
import { type ResolvedRecord } from "@ice/bibliographic";
import { type RawCitation } from "@ice/ingestion";

// relationship_category → graph edge_type (plan §9 vocabulary). Only
// resolved candidates (with a real target record) get a graph edge, so
// Phase 5's roadmap traversal never points at a phantom node.
export const CATEGORY_TO_EDGE: Record<RelationshipCategory, Parameters<typeof edgeValue>[0]> = {
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

export function edgeValue(
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
export const ANALYSIS_CONCURRENCY = 6;

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, using a
 * fixed pool of workers pulling from a shared cursor. Preserves the
 * simple "process each candidate" shape while bounding concurrency — no
 * external dependency needed.
 */
export async function mapWithConcurrency<T>(
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
export function buildTextAnchor(
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
export function leadingSurname(query: string): string {
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

export function citationFrequencyFor(
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
export function targetLabel(candidate: RawCitation, record: ResolvedRecord | null): string {
  if (record) {
    return record.authors ? `${record.title} — ${record.authors}` : record.title;
  }
  return candidate.text.slice(0, 200);
}
