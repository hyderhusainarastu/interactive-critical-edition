/**
 * D-21-9 (the fixable half, per the Phase 21 dossier §5): `GraphLink.category`
 * is only ever populated by the annotation-classification write paths in
 * `apps/worker/src/analyze.ts` (`evidence: { category: classification.category,
 * ... }`), which already set it. Two other real, unambiguous write paths in
 * that same file never set `category` at all, even though their `edge_type`
 * value maps to exactly one of the 10 `relationship_category` values with no
 * guessing required:
 *
 *   - `resolveCitation()` (`analyze.ts:559-570`) always writes `edgeType:
 *     "cites"` for a genuine explicit citation — a citation resolution is
 *     never anything OTHER than an "explicit_reference" relationship, and no
 *     other write site ever produces a `"cites"` edge with a different
 *     intended category (confirmed by grep: `"cites"` is written only here).
 *   - The concept-edge insert (`analyze.ts:~1269-1279`) always writes
 *     `edgeType: "presupposes"` for a work→concept prerequisite relationship
 *     — again the one and only write site for that literal edge_type string.
 *
 * This is deliberately a NARROW, exhaustively-enumerated mapping, not a
 * keyword heuristic: every other edge_type `buildGraph()` reads
 * (`discovered_source`, the `edition_relation` work-form/`${workRole}_of`
 * strings, `source_provenance` relation types, `cross_library` judgments,
 * `outline_section`) genuinely carries no 10-category value today and must
 * NOT be guessed at — they fall through to `null` here on purpose, and the
 * UI (`graphSceneScaling.ts`'s `edgeRelationLabel`) has an honest, undecorated
 * fallback for exactly that `null` case.
 */
export function deriveEdgeCategory(edgeType: string, category: string | null): string | null {
  if (category) return category;
  if (edgeType === "cites") return "explicit_reference";
  if (edgeType === "presupposes") return "prerequisite";
  return null;
}
