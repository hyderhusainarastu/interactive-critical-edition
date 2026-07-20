/**
 * Which analysis pipeline a deployment runs.
 *
 * Until Phase 9.1 this was compared by exact string equality in two places
 * (`=== "v2"` in the worker, `!== "v2"` in the reprocess route), which made
 * every unrecognized value silently mean v1. Setting `ANALYSIS_PIPELINE=v3`
 * would therefore have dropped production back to the v1 pipeline *and*
 * disabled edition reprocessing, with nothing anywhere saying so. Both call
 * sites now go through this module instead.
 *
 * Versions are ordered, because the questions the code actually asks are
 * ordered ones ("is this at least the edition pipeline?"), not equality ones.
 */

export const PIPELINE_VERSIONS = ["v1", "v2", "v3"] as const;
export type PipelineVersion = (typeof PIPELINE_VERSIONS)[number];

/** What an unset or unrecognized `ANALYSIS_PIPELINE` means. Unchanged from the
 *  pre-9.1 behaviour: absent config runs the original pipeline. */
export const DEFAULT_PIPELINE_VERSION: PipelineVersion = "v1";

const RANK: Record<PipelineVersion, number> = { v1: 1, v2: 2, v3: 3 };

const warned = new Set<string>();

/**
 * Parse a configured value. Tolerates surrounding whitespace, casing, and a
 * bare number (`2`), since all three are easy to type into a platform env-var
 * form. Anything genuinely unrecognized falls back to the default — but says
 * so once, rather than degrading in silence the way the old checks did.
 */
export function parsePipelineVersion(raw: string | undefined | null): PipelineVersion {
  if (raw == null) return DEFAULT_PIPELINE_VERSION;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return DEFAULT_PIPELINE_VERSION;
  const candidate = (normalized.startsWith("v") ? normalized : `v${normalized}`) as PipelineVersion;
  if (PIPELINE_VERSIONS.includes(candidate)) return candidate;
  if (!warned.has(normalized)) {
    warned.add(normalized);
    console.warn(
      `[config] ANALYSIS_PIPELINE="${raw}" is not one of ${PIPELINE_VERSIONS.join("|")}; using ${DEFAULT_PIPELINE_VERSION}.`,
    );
  }
  return DEFAULT_PIPELINE_VERSION;
}

/** The pipeline version this process is configured to run. */
export function pipelineVersion(
  // A loose record rather than `{ ANALYSIS_PIPELINE?: string }`: Next augments
  // ProcessEnv with its own keys, and a narrow object type has "no properties
  // in common" with it under strict mode.
  env: Record<string, string | undefined> = process.env,
): PipelineVersion {
  return parsePipelineVersion(env.ANALYSIS_PIPELINE);
}

/** True when `version` is `minimum` or newer. */
export function pipelineAtLeast(version: PipelineVersion, minimum: PipelineVersion): boolean {
  return RANK[version] >= RANK[minimum];
}

/**
 * True for every pipeline that produces a versioned, published *edition*
 * (v2 and, from Phase 9.2, v3) rather than the v1 annotate-in-place flow.
 * This is the question both former `=== "v2"` checks were really asking, so
 * v2 deployments behave exactly as before and v3 no longer falls off a cliff.
 */
export function isEditionPipeline(version: PipelineVersion = pipelineVersion()): boolean {
  return pipelineAtLeast(version, "v2");
}

/** Test seam: forget which unrecognized values have already been warned about. */
export function resetPipelineWarnings(): void {
  warned.clear();
}
