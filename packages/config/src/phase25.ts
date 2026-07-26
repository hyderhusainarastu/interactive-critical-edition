/**
 * Phase 25 (Palimnote × ScholarLens research workspace) is released behind
 * independently addressable flags, one per user-visible surface, all defaulting
 * OFF. Flags are release controls, not authorization controls: every protected
 * route still performs its own authentication and ownership check regardless of
 * what any flag says.
 *
 * Each surface gets its own flag because they ship in different phases and can
 * regress independently — the reader claim layer can be pulled without taking
 * the Research workspace with it, and the humanities judge is gated on an eval
 * floor that the rest of the engine does not depend on.
 *
 *  - `research`          — the `/research` workspace routes and their API.
 *  - `readerClaimLayer`  — the reader's Claims tab and in-text claim markers.
 *  - `graphDebateLayer`  — `claim`/`debate` nodes and expansions in the graph.
 *  - `writerEvidence`    — the Writer evidence panel and claim-backed citations.
 *  - `askResearchModes`  — Ask Library's per-message research modes.
 *  - `monitoring`        — scheduled corpus/citation/author monitors. Off AND
 *    cadence-paused by default: a scheduled job is the one surface here that
 *    can act without a user present.
 *  - `humanitiesJudge`   — the interpretive judge branch. Stays off until the
 *    humanities gold set clears its floors; until then humanities pairs run
 *    through the base 4-way judge and the extra mechanism values do not exist
 *    in the Postgres type at all, so misclassification into them cannot persist.
 */
export const PHASE_25_FEATURE_FLAGS = {
  research: { env: "PHASE_25_RESEARCH_ENABLED", defaultValue: false },
  readerClaimLayer: { env: "PHASE_25_READER_CLAIM_LAYER_ENABLED", defaultValue: false },
  graphDebateLayer: { env: "PHASE_25_GRAPH_DEBATE_LAYER_ENABLED", defaultValue: false },
  writerEvidence: { env: "PHASE_25_WRITER_EVIDENCE_ENABLED", defaultValue: false },
  askResearchModes: { env: "PHASE_25_ASK_RESEARCH_MODES_ENABLED", defaultValue: false },
  monitoring: { env: "PHASE_25_MONITORING_ENABLED", defaultValue: false },
  humanitiesJudge: { env: "PHASE_25_HUMANITIES_JUDGE_ENABLED", defaultValue: false },
} as const;

export type Phase25Feature = keyof typeof PHASE_25_FEATURE_FLAGS;

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

/** Resolve one Phase 25 release flag with a stable, safe (off) default. */
export function phase25FeatureEnabled(
  feature: Phase25Feature,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const definition = PHASE_25_FEATURE_FLAGS[feature];
  return parseBoolean(env[definition.env]) ?? definition.defaultValue;
}
