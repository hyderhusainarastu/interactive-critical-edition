/**
 * Shared "why was this dropped instead of restored" vocabulary (charter §9
 * URL-state reconstruction rules: "Ignore unauthorized, deleted, or
 * no-longer-valid IDs, announce the omission non-disruptively, and
 * preserve the rest of the state"). Used by both `reconstruct.ts` (new
 * `GraphUrlState` reconstruction) and `legacyGraphUrl.ts` (legacy-URL
 * translation) so a caller sees one consistent omission shape regardless
 * of which path produced it.
 */

/**
 * Why one id/param was dropped rather than restored.
 *  - `unauthorized` — the id exists but the current user cannot read it.
 *  - `deleted` — the id used to exist (e.g. a trashed/purged work) but no
 *    longer does.
 *  - `not_found` — the id was never valid (no such record ever existed) —
 *    kept distinct from `deleted` since a caller's validity check can often
 *    tell the two apart and the messaging differs ("no longer available"
 *    vs. "wasn't a real id").
 *  - `invalid` — the raw value is malformed (not a well-formed id) before
 *    any lookup would even be attempted.
 *  - `over_cap` — the id was individually valid but arrived past the
 *    product's expansion-trail cap (`EXPANSION_CAP`, `disclosure.ts`).
 */
export type OmittedReason = "unauthorized" | "deleted" | "not_found" | "invalid" | "over_cap";

export interface OmittedEntry {
  /** The raw id/value that was omitted — a plain string, not a branded id,
   *  since the whole point is this value did NOT make it into the typed
   *  state. */
  value: string;
  reason: OmittedReason;
  /** Which URL param or state field this value came from, e.g.
   *  `"expansionTrail"`, `"selected"`, `"roadmapRoot"`, `"pinnedWork"`. */
  source: string;
}

/**
 * A validity check a caller supplies (this package never reaches a DB or
 * knows what "authorized" means on its own). Returning `null` means valid;
 * any `OmittedReason` means the id should be dropped and reported with that
 * reason. Kept as a reason-returning function rather than a boolean
 * predicate specifically so the omission list can report *why*, not just
 * *that*, something was dropped — the charter's own "announce the
 * omission" requirement needs a reason, not just a filtered-out id.
 */
export type ValidityCheck<T> = (item: T) => OmittedReason | null;
