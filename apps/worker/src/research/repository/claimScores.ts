import { claimScores, db } from "@ice/db";
import { inArray } from "drizzle-orm";

export interface ClaimScoreRow {
  dimension: string;
  score: number;
}

/** Every `claim_score` row for a set of claims, grouped by claim id — the
 *  judge stage's `evidence_gap` input. A claim with zero rows here is
 *  honestly unscored on every dimension (see `claim_score`'s own doc
 *  comment); the judge stage's `evidence_gap` computation treats that as
 *  "no gap to report", never a fabricated 0. */
export async function loadClaimScoresForClaims(claimIds: string[]): Promise<Map<string, ClaimScoreRow[]>> {
  const out = new Map<string, ClaimScoreRow[]>();
  if (claimIds.length === 0) return out;
  const rows = await db
    .select({ claimId: claimScores.claimId, dimension: claimScores.dimension, score: claimScores.score })
    .from(claimScores)
    .where(inArray(claimScores.claimId, claimIds));
  for (const row of rows) {
    const existing = out.get(row.claimId) ?? [];
    existing.push({ dimension: row.dimension, score: row.score });
    out.set(row.claimId, existing);
  }
  return out;
}
