/**
 * Sub-phase 22.9b (plan §3.5): the Conversational Competency Designation
 * release gate. Two independently addressable flags, both defaulting off —
 * mirrors the `phase12FeatureEnabled` convention (a release control, not an
 * authorization control; every route still performs its own auth/ownership
 * check regardless of this flag).
 *
 *  - `enabled`: the whole feature, INCLUDING the zero-cost deterministic
 *    self-report detector. Turned on first, after the production canary
 *    verifies ledger rows, undo, and caps within the standing $1/$5 limits.
 *  - `providerEnabled`: the gated structured-model-call tier on top of the
 *    detector. Enabled only after `enabled`, matching the plan's own
 *    ordering ("enable PHASE_22_COMPETENCY_ENABLED, then
 *    PHASE_22_COMPETENCY_PROVIDER_ENABLED").
 */
export const PHASE_22_COMPETENCY_FLAGS = {
  enabled: { env: "PHASE_22_COMPETENCY_ENABLED", defaultValue: false },
  providerEnabled: { env: "PHASE_22_COMPETENCY_PROVIDER_ENABLED", defaultValue: false },
} as const;

export type Phase22CompetencyFeature = keyof typeof PHASE_22_COMPETENCY_FLAGS;

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

/** Resolve one Phase 22 competency-designation release flag with a stable, safe (off) default. */
export function phase22CompetencyFeatureEnabled(
  feature: Phase22CompetencyFeature,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const definition = PHASE_22_COMPETENCY_FLAGS[feature];
  return parseBoolean(env[definition.env]) ?? definition.defaultValue;
}

/** Convenience: the whole feature (detector + writes) is enabled. */
export function phase22CompetencyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return phase22CompetencyFeatureEnabled("enabled", env);
}

/** Convenience: the gated structured-model-call tier is enabled (implies checking `phase22CompetencyEnabled` too — callers must check both). */
export function phase22CompetencyProviderEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return phase22CompetencyFeatureEnabled("providerEnabled", env);
}
