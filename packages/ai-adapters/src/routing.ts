import type { TaskType } from "./types";

/**
 * Cost-first routing (plan §3/§11): every task defaults to the cheapest
 * viable model tier. A stronger/pricier model is only ever promoted for
 * a task on eval-harness evidence (Phase 7), as a deliberate, documented
 * config change here — not silently at call time. Model IDs are
 * env-overridable so a catalog change doesn't require a code edit
 * (docs/PROJECT-LOG.md notes exact IDs get pinned at implementation time).
 */

export type ProviderName = "openai" | "anthropic";

export interface RouteConfig {
  provider: ProviderName;
  model: string;
}

// Cheap-tier defaults per provider. Overridable via env. Real OpenAI model IDs
// (confirmed against developers.openai.com pricing, 2026-07): nano handles the
// mechanical work (extraction/query-gen/classification/validation), mini only
// the note synthesis (RESEARCH_ROUTE).
const OPENAI_CHEAP = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
const OPENAI_RESEARCH = process.env.OPENAI_MODEL_RESEARCH ?? "gpt-5.4-mini";
const ANTHROPIC_CHEAP = process.env.ANTHROPIC_MODEL_CHEAP ?? "claude-haiku-4-5-20251001";

/**
 * Default per-task routing. Preference order within a task is expressed
 * by the factory (getClassifier): it uses `preferred` when that
 * provider's key is present, else the other provider, else the
 * heuristic fallback. This keeps "which provider is available" out of
 * business logic.
 */
export const TASK_ROUTES: Record<TaskType, { preferred: RouteConfig; alternate: RouteConfig }> = {
  relationship_classification: {
    preferred: { provider: "openai", model: OPENAI_CHEAP },
    alternate: { provider: "anthropic", model: ANTHROPIC_CHEAP },
  },
  metadata_extraction: {
    preferred: { provider: "openai", model: OPENAI_CHEAP },
    alternate: { provider: "anthropic", model: ANTHROPIC_CHEAP },
  },
  citation_parse: {
    preferred: { provider: "openai", model: OPENAI_CHEAP },
    alternate: { provider: "anthropic", model: ANTHROPIC_CHEAP },
  },
  // Phase 25 (ScholarLens integration) tasks — same cheap-first posture as
  // every task above, no bespoke tier.
  claim_extraction: {
    preferred: { provider: "openai", model: OPENAI_CHEAP },
    alternate: { provider: "anthropic", model: ANTHROPIC_CHEAP },
  },
  claim_relationship_judgment: {
    preferred: { provider: "openai", model: OPENAI_CHEAP },
    alternate: { provider: "anthropic", model: ANTHROPIC_CHEAP },
  },
  debate_cluster_naming: {
    preferred: { provider: "openai", model: OPENAI_CHEAP },
    alternate: { provider: "anthropic", model: ANTHROPIC_CHEAP },
  },
  evidence_chamber_synthesis: {
    preferred: { provider: "openai", model: OPENAI_CHEAP },
    alternate: { provider: "anthropic", model: ANTHROPIC_CHEAP },
  },
  hypothesis_generation: {
    preferred: { provider: "openai", model: OPENAI_CHEAP },
    alternate: { provider: "anthropic", model: ANTHROPIC_CHEAP },
  },
};

// The research/synthesis tier is opt-in for the v2 orchestrator. It is not
// silently used by mechanical work, and callers must enforce the run budget.
export const RESEARCH_ROUTE: RouteConfig = { provider: "openai", model: OPENAI_RESEARCH };

/**
 * Rough per-1M-token USD prices for cost logging (plan §11/§22). These
 * are approximations for the admin cost dashboard, not billing-grade —
 * the point is a live signal of spend, not an invoice. Falls back to a
 * conservative default for an unrecognized model.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  // USD per 1M tokens — OpenAI official pricing (developers.openai.com, 2026-07).
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  // Escalation-only rung (Phase 25.5b judge eval, used only if no cheaper
  // rung passes the judge-quality gates) — not a TASK_ROUTES default.
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
};

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICE_PER_MTOK[model] ?? { input: 1.0, output: 3.0 };
  return (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;
}
