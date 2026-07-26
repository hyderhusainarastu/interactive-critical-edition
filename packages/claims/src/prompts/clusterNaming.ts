/** Bumped whenever the prompt text below changes — stored on every
 *  `debate_cluster` row as provenance (null on the deterministic-fallback
 *  path, the `CLAIM_EXTRACTION_PROMPT_VERSION` precedent). */
export const CLUSTER_NAMING_PROMPT_VERSION = "cluster-naming-v1";

export interface ClusterNamingInput {
  claimTexts: string[];
}

export interface ClusterNamingResult {
  name: string;
  researchQuestion: string | null;
  description: string | null;
}

/**
 * Ports the cluster-naming prompt from ScholarLens's `_name_cluster`
 * (licensed, MIT + explicit owner permission). Sampled to the first 6
 * claims — naming a cluster doesn't need every member, just enough signal.
 */
export function buildClusterNamingPrompt(input: ClusterNamingInput): string {
  const sample = input.claimTexts.slice(0, 6);
  const formatted = sample.map((t) => `- ${t}`).join("\n");
  return (
    "These claims are connected through support/contradiction/nuance " +
    "relationships and form a cluster around a shared question.\n\n" +
    `Claims:\n${formatted}\n\n` +
    "Return ONLY valid JSON with:\n" +
    '- "name": 4-7 word topic label (noun phrase, title case)\n' +
    '- "researchQuestion": the specific question these claims address\n' +
    '- "description": one sentence summarizing this debate\n\n' +
    "No preamble, no markdown fences."
  );
}

/**
 * Deterministic fallback when the LLM call fails or returns nothing usable
 * — never leaves a cluster unnamed. Mirrors `_name_cluster`'s own `except`
 * branch, generalized per the Phase 25 brief to "first six words of the
 * first claim" rather than a fixed 50-character slice.
 */
export function deterministicFallbackName(claimTexts: string[]): string {
  const first = claimTexts[0];
  if (!first || !first.trim()) return "Debate";
  const words = first.trim().split(/\s+/).slice(0, 6).join(" ");
  return `Debate: ${words}`;
}

/**
 * Structured-output JSON schema for the cluster-naming call — OpenAI strict
 * `json_schema` mode (`OpenAIResponsesClient`), the "structured, cheap" rung
 * `debate_cluster_naming` routes to by default (`@ice/ai-adapters`'s
 * `routing.ts`). Every property must appear in `required` under OpenAI's
 * strict mode, so the two optional fields are nullable strings rather than
 * omittable.
 */
export const CLUSTER_NAMING_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    researchQuestion: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
  },
  required: ["name", "researchQuestion", "description"],
  additionalProperties: false,
} as const;

export interface ParsedClusterNamingResponse {
  name?: unknown;
  researchQuestion?: unknown;
  description?: unknown;
}

/**
 * Validates a parsed cluster-naming response. `name` is load-bearing (a
 * cluster is never left with an empty label) — THROWS on a missing/empty
 * name so the caller retries and, on retry exhaustion, falls back to
 * `deterministicFallbackName` rather than persisting a blank one.
 * `researchQuestion`/`description` are optional framing text; a non-string
 * (including the schema's own `null`) normalizes to `null` rather than
 * throwing — losing that framing doesn't invalidate the name itself.
 */
export function validateClusterNamingResponse(parsed: unknown): ClusterNamingResult {
  const p = (parsed ?? {}) as ParsedClusterNamingResponse;
  if (typeof p.name !== "string" || p.name.trim().length === 0) {
    throw new Error(`Cluster naming response "name" (${String(p.name)}) is missing or empty.`);
  }
  return {
    name: p.name.trim(),
    researchQuestion: typeof p.researchQuestion === "string" && p.researchQuestion.trim() ? p.researchQuestion.trim() : null,
    description: typeof p.description === "string" && p.description.trim() ? p.description.trim() : null,
  };
}
