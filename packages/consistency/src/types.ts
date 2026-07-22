/**
 * Phase 20.7 — Reference and mismatch repair (plan §20.7).
 *
 * Pure types shared by every check + the repair planner. No DB, no I/O —
 * same split as `@ice/deletion` (pure state machine, effects injected by the
 * worker-side executor) and `@ice/research`'s `canonicalIdentity.ts` (pure
 * precedence-chain planner, DB-side executor in
 * `apps/worker/src/identity/merge.ts`). Every check here takes an
 * already-fetched, flat `ConsistencySnapshot` and returns
 * `ConsistencyMismatch[]` — deterministic, unit-testable with in-memory
 * fixtures, no network or database involved.
 */

export type ConsistencyCheckId =
  | "citation-library-item"
  | "library-item-canonical-work"
  | "graph-node-canonical-entity"
  | "graph-edge-endpoints"
  | "annotation-related-work"
  | "roadmap-item-target"
  | "reader-source-citation"
  | "rag-citation-anchor"
  | "title-author-year-agreement";

export type ConsistencySeverity = "info" | "warning" | "critical";

/**
 * A single, table-scoped repair action. The applier (worker-side, DB-aware)
 * maps `table` to a real Drizzle table and applies exactly this action
 * inside one transaction. `reason` must always name the canonical source of
 * truth the repair is derived from — never "guessed" (plan §20.7's explicit
 * anti-hallucination requirement carried into repair, not just detection).
 */
export type ConsistencyRepair =
  | { kind: "update"; table: string; id: string; patch: Record<string, unknown>; reason: string }
  | { kind: "delete"; table: string; id: string; reason: string }
  | { kind: "insert"; table: string; values: Record<string, unknown>; reason: string };

export interface ConsistencyMismatch {
  checkId: ConsistencyCheckId;
  /** Table/entity the mismatch was found on, e.g. "citation_library_link". */
  entityType: string;
  /** Primary key of the mismatched row (or a synthetic key for pair-checks). */
  entityId: string;
  description: string;
  severity: ConsistencySeverity;
  evidence?: Record<string, unknown>;
  /**
   * Null means "detected but deliberately not auto-repairable" — either the
   * canonical fact needed to fix it doesn't exist yet (would require
   * guessing) or the disagreement is between two equally legitimate surfaces
   * (e.g. a user's own upload title vs. an aggregated canonical title) where
   * overwriting either would destroy real data rather than fix an error.
   */
  repair: ConsistencyRepair | null;
}

export interface ConsistencyReport {
  mismatches: ConsistencyMismatch[];
  /** Convenience projection — every non-null repair, in the same order. */
  repairs: ConsistencyRepair[];
}

export function toReport(mismatches: ConsistencyMismatch[]): ConsistencyReport {
  return { mismatches, repairs: mismatches.map((m) => m.repair).filter((r): r is ConsistencyRepair => r !== null) };
}
