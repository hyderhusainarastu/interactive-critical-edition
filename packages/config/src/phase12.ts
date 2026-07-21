/**
 * Phase 12 is intentionally released behind independently addressable
 * flags. Flags are release controls, not authorization controls: every
 * protected route still performs its own authentication and ownership check.
 */
export const PHASE_12_FEATURE_FLAGS = {
  foundation: { env: "PHASE_12_FOUNDATION_ENABLED", defaultValue: true },
  libraryIdentity: { env: "PHASE_12_LIBRARY_IDENTITY_ENABLED", defaultValue: false },
  pipelineV4: { env: "PHASE_12_PIPELINE_V4_ENABLED", defaultValue: false },
  interactiveReader: { env: "PHASE_12_INTERACTIVE_READER_ENABLED", defaultValue: false },
  crossLibraryGraph: { env: "PHASE_12_CROSS_LIBRARY_GRAPH_ENABLED", defaultValue: false },
  writer: { env: "PHASE_12_WRITER_ENABLED", defaultValue: false },
} as const;

export type Phase12Feature = keyof typeof PHASE_12_FEATURE_FLAGS;

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

/** Resolve one Phase 12 release flag with a stable safe default. */
export function phase12FeatureEnabled(
  feature: Phase12Feature,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const definition = PHASE_12_FEATURE_FLAGS[feature];
  return parseBoolean(env[definition.env]) ?? definition.defaultValue;
}
