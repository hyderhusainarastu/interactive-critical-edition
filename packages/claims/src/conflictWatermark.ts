import { createHash } from "node:crypto";

/**
 * Upstream-state watermark over a project's UNDISPUTED contradiction/nuance
 * `claim_relationship` set — the exact population
 * `loadUndisputedConflictRelationshipsForProject` grounds `generate_hypotheses`
 * on (D-25-15). Restores ScholarLens's original design, where the job-level
 * cache key for this stage included a `MAX(relationships.created_at)`
 * watermark over the same set; the port to this codebase dropped it at the
 * job layer, so `generate_hypotheses`'s handler-level "repeat run costs $0"
 * short-circuit (`apps/worker/src/research/generateHypotheses.ts`) compared
 * scope+versions ONLY — a completed zero-conflict run permanently blocked
 * every future run under the identical scope, even after real conflicts
 * were later judged into existence, because nothing about the idempotency
 * key ever changed.
 *
 * Ported here as a sha256 over the SORTED set of qualifying relationship ids
 * rather than a timestamp: sensitive to any membership change (a new
 * conflict judged, an existing one disputed/hidden/verified) regardless of
 * whether that change happens to bump a max-timestamp in a detectable way,
 * and computable from an id list alone with no extra column reads. Both the
 * web dispatcher (`apps/web/src/lib/research/hypotheses.ts`) and the worker
 * handler compute this from the SAME query predicate
 * (`status = 'active' AND hidden = false AND verification_status <>
 * 'disputed' AND valence IN ('contradiction', 'nuance')`) and fold it into
 * the job-level idempotency key, so a completed run whose conflict set has
 * since changed can never again be silently reused as if nothing had.
 */
export function computeConflictWatermark(relationshipIds: string[]): string {
  const sorted = [...relationshipIds].sort();
  return createHash("sha256").update(sorted.join(",")).digest("hex");
}
