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
