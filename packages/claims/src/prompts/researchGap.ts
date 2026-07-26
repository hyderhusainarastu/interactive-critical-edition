/**
 * `research_gap.description` — a deterministic, template-based sentence over
 * a `debate_cluster`'s OWN `name`/`researchQuestion` (plan §Pipeline: "gap
 * description = template over the cluster's own name/question"). No LLM
 * call, no risk of a fabricated finding — same technique as
 * `packages/curriculum`'s `checkpointFor()` and `@ice/roadmap`'s
 * `reasonFor()`, both cited by that same plan sentence as the precedent to
 * follow. Zero workspace/runtime dependencies, pure string template.
 */

export interface GapClusterInput {
  name: string;
  researchQuestion: string | null;
  /** `debate_cluster.counts.contradiction` — always >= 1 for a cluster this
   *  is called on (the caller only derives a gap from clusters that still
   *  carry an unresolved contradiction), but this function does not itself
   *  enforce that — it just renders whatever count it's given. */
  contradictionCount: number;
}

export function buildGapDescription(input: GapClusterInput): string {
  const name = input.name.trim() || "This debate";
  const topic = input.researchQuestion?.trim();
  const count = Math.max(0, Math.trunc(input.contradictionCount));
  const plural = count === 1 ? "contradiction" : "contradictions";
  const topicClause = topic ? ` — the open question is: ${topic}` : "";
  return `"${name}" contains ${count} unresolved ${plural} with no reconciling account yet recorded${topicClause}.`;
}
