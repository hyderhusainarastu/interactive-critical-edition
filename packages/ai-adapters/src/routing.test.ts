import { describe, expect, it } from "vitest";
import { TASK_ROUTES } from "./routing";
import type { TaskType } from "./types";

// Phase 25 (ScholarLens integration) task types — each must resolve to a
// route, cheap-first, matching the existing tasks' provider order exactly
// (openai preferred, anthropic alternate) rather than a bespoke tier.
//
// `claim_relationship_judgment` is a deliberate exception (Phase 25.5c,
// 2026-07-26, docs/eval/research-claims/spike-25-5c-output-mode.md):
// anthropic/claude-haiku-4-5 is the only model that has ever cleared the
// judge quality gates (src/eval/gates.ts) across three judge spikes, so it
// was promoted to `preferred` on that eval-harness evidence — see the
// load-bearing comment on `TASK_ROUTES.claim_relationship_judgment` in
// routing.ts for the full caveat (the passing evidence is raw-text-mode,
// not the structured mode that actually ships). It is tested separately
// below rather than folded into the cheap-first-for-everything sweep.
const NEW_TASKS: TaskType[] = [
  "claim_extraction",
  "debate_cluster_naming",
  "evidence_chamber_synthesis",
  "hypothesis_generation",
];

describe("TASK_ROUTES — Phase 25 task types", () => {
  it.each(NEW_TASKS)("has a route for %s", (task) => {
    expect(TASK_ROUTES[task]).toBeDefined();
  });

  it.each(NEW_TASKS)("routes %s cheap-first: openai preferred, anthropic alternate", (task) => {
    const route = TASK_ROUTES[task];
    expect(route.preferred.provider).toBe("openai");
    expect(route.alternate.provider).toBe("anthropic");
  });

  it.each(NEW_TASKS)("matches the existing tasks' cheap-tier model IDs for %s", (task) => {
    const route = TASK_ROUTES[task];
    expect(route.preferred.model).toBe(TASK_ROUTES.relationship_classification.preferred.model);
    expect(route.alternate.model).toBe(TASK_ROUTES.relationship_classification.alternate.model);
  });
});

describe("TASK_ROUTES — claim_relationship_judgment (Phase 25.5c evidence-based promotion)", () => {
  it("has a route", () => {
    expect(TASK_ROUTES.claim_relationship_judgment).toBeDefined();
  });

  it("prefers anthropic/claude-haiku-4-5 — the only model to clear the judge gates across three spikes", () => {
    const route = TASK_ROUTES.claim_relationship_judgment;
    expect(route.preferred.provider).toBe("anthropic");
    expect(route.preferred.model).toBe(TASK_ROUTES.relationship_classification.alternate.model);
    expect(route.alternate.provider).toBe("openai");
    expect(route.alternate.model).toBe(TASK_ROUTES.relationship_classification.preferred.model);
  });
});
