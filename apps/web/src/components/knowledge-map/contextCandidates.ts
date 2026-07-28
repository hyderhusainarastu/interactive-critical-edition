/**
 * Pure data-shaping for the `/graph` context chooser's candidate list
 * (charter §8 "Valid entry contexts": Work / Passage / Research question /
 * Claim / Debate, plus "Recent"). Spec §1.1's `contextChooser.ts` row and
 * §2.1's per-kind data-source table.
 *
 * Named `contextCandidates.ts`, not the spec's literal `contextChooser.ts`
 * — this repo's filesystem is case-insensitive, and `ContextChooser.tsx`
 * (the component) collides with `contextChooser.ts` (this module) at the
 * OS level even though TypeScript's own module resolution is
 * case-sensitive; `tsc` correctly refuses to build with two files whose
 * names differ only in casing. A documented, forced rename, not a design
 * change.
 *
 * This module does NOT fetch anything — it only maps each entry-context
 * kind's already-fetched raw row shape (see §2.1: `GET /api/works`,
 * `GET /api/passages/recent`, `GET /api/research/projects`,
 * `GET /api/research/claims/recent`, `GET /api/research/debates`) into one
 * common `ContextCandidate` shape the `ContextChooser.tsx` component
 * renders uniformly, plus small pure sort/filter helpers over that common
 * shape. Kept free of React/fetch/DOM so it's directly unit-testable
 * (`contextCandidates.test.ts`).
 */
import type { GraphContextKind, GraphUrlContext } from "@ice/graph-display";

/**
 * One chooser card, regardless of which of the five kinds it represents.
 * `updatedAt` is `null` only for a source row whose own table carries no
 * timestamp at all (none currently do — every mapper below always supplies
 * one) — kept nullable rather than defaulted to "now" so a genuinely
 * missing timestamp can never be silently faked as freshly-updated.
 */
export interface ContextCandidate {
  kind: GraphContextKind;
  id: string;
  title: string;
  /** Secondary line — author/venue/project name/excerpt, whatever the
   *  source kind's own natural secondary field is. Empty string, never
   *  fabricated, when the source row has nothing to say here. */
  subtitle: string;
  updatedAt: string | null;
}

export function toGraphUrlContext(candidate: Pick<ContextCandidate, "kind" | "id">): GraphUrlContext {
  return { kind: candidate.kind, id: candidate.id };
}

// --- Per-kind mappers (§2.1's data-source table, one row each) -----------

export interface WorkContextRow {
  workId: string;
  title: string;
  authorName: string | null;
}

export function workToCandidate(row: WorkContextRow): ContextCandidate {
  return { kind: "work", id: row.workId, title: row.title, subtitle: row.authorName ?? "", updatedAt: null };
}

export interface PassageContextRow {
  id: string;
  workId: string;
  workTitle: string;
  quote: string | null;
  summary: string;
  updatedAt: string | Date;
}

export function passageToCandidate(row: PassageContextRow): ContextCandidate {
  return {
    kind: "passage",
    id: row.id,
    title: row.summary,
    subtitle: row.workTitle,
    updatedAt: toIsoString(row.updatedAt),
  };
}

export interface QuestionContextRow {
  id: string;
  title: string;
  summary: string | null;
  updatedAt: string | Date;
}

export function questionToCandidate(row: QuestionContextRow): ContextCandidate {
  return { kind: "question", id: row.id, title: row.title, subtitle: row.summary ?? "", updatedAt: toIsoString(row.updatedAt) };
}

export interface ClaimContextRow {
  id: string;
  claimText: string;
  workTitle: string | null;
  corpusItemTitle: string | null;
  updatedAt: string | Date;
}

export function claimToCandidate(row: ClaimContextRow): ContextCandidate {
  return {
    kind: "claim",
    id: row.id,
    title: row.claimText,
    subtitle: row.workTitle ?? row.corpusItemTitle ?? "",
    updatedAt: toIsoString(row.updatedAt),
  };
}

export interface DebateContextRow {
  id: string;
  name: string;
  researchQuestion: string | null;
  projectTitle: string;
  updatedAt: string | Date;
}

export function debateToCandidate(row: DebateContextRow): ContextCandidate {
  return {
    kind: "debate",
    id: row.id,
    title: row.name,
    subtitle: row.researchQuestion ?? row.projectTitle,
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

// --- Pure list operations --------------------------------------------------

/** Most-recently-updated first; candidates with no timestamp (`updatedAt:
 *  null`, currently only ever "work") sort after every timestamped one,
 *  in their original relative order (stable) — never treated as "oldest"
 *  (an arbitrary epoch) or "newest" (would misrepresent unknown recency). */
export function sortCandidatesByRecency(candidates: readonly ContextCandidate[]): ContextCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.updatedAt === null && b.updatedAt === null) return 0;
    if (a.updatedAt === null) return 1;
    if (b.updatedAt === null) return -1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** Case-insensitive substring match over title+subtitle. Empty/whitespace
 *  query matches everything (no filtering applied). */
export function filterCandidatesBySearch(candidates: readonly ContextCandidate[], query: string): ContextCandidate[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...candidates];
  return candidates.filter((c) => `${c.title} ${c.subtitle}`.toLocaleLowerCase().includes(normalized));
}

export function groupCandidatesByKind(candidates: readonly ContextCandidate[]): Record<GraphContextKind, ContextCandidate[]> {
  const groups: Record<GraphContextKind, ContextCandidate[]> = { work: [], passage: [], question: [], claim: [], debate: [] };
  for (const candidate of candidates) groups[candidate.kind].push(candidate);
  return groups;
}
