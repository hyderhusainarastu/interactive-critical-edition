/**
 * Item 1 of the Research-workspace fix lane's owner-reported scope
 * addition: "honest zero-result explanations." A `generate_hypotheses` job
 * that legitimately produces zero hypotheses still leaves the page looking
 * broken — the owner's own production example was a job whose
 * `research_job_request.note` read
 * `"0 undisputed conflict(s) in scope | hypotheses: 0 generated
 * (grounding=single_work_gaps)"`, with nothing on the page explaining why.
 *
 * `apps/worker/src/research/generateHypotheses.ts`'s own `note` string is
 * the only place this information exists — `conflictsInScope`/
 * `hypothesesGenerated` aren't persisted as their own columns, only folded
 * into that human-readable summary (see its own `note` construction). This
 * is a best-effort parse of that exact, worker-owned format: unparseable
 * input returns `null` rather than a guess, so the UI falls back to its
 * plain generic empty state instead of showing a wrong number.
 */
export interface ParsedHypothesesNote {
  conflictsInScope: number;
  hypothesesGenerated: number;
}

const CONFLICTS_PATTERN = /(\d+)\s+undisputed conflict\(s\) in scope/;
const HYPOTHESES_PATTERN = /hypotheses:\s*(\d+)\s+generated/;

export function parseHypothesesJobNote(note: string | null | undefined): ParsedHypothesesNote | null {
  if (!note) return null;
  const conflictsMatch = note.match(CONFLICTS_PATTERN);
  const hypothesesMatch = note.match(HYPOTHESES_PATTERN);
  if (!conflictsMatch || !hypothesesMatch) return null;
  return {
    conflictsInScope: Number(conflictsMatch[1]),
    hypothesesGenerated: Number(hypothesesMatch[1]),
  };
}

/** Plain-language explanation for a completed run that produced zero
 *  hypotheses — `null` when the note doesn't say it produced zero (so the
 *  caller should fall back to its own generic empty state instead). */
export function explainZeroHypotheses(note: string | null | undefined): string | null {
  const parsed = parseHypothesesJobNote(note);
  if (!parsed || parsed.hypothesesGenerated > 0) return null;
  if (parsed.conflictsInScope === 0) {
    return "No conflicts found to ground hypotheses on — run relationship detection (and clustering) first.";
  }
  return `No hypotheses were produced from the ${parsed.conflictsInScope} conflict${parsed.conflictsInScope === 1 ? "" : "s"} found in scope.`;
}
