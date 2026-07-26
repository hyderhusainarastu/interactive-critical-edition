import { describe, expect, it } from "vitest";
import { TASK_ROUTES } from "./routing";
import type { TaskType } from "./types";

// Phase 25 (ScholarLens integration) task types — each must resolve to a
// route, cheap-first, matching the existing tasks' provider order exactly
// (openai preferred, anthropic alternate) rather than a bespoke tier.
const NEW_TASKS: TaskType[] = [
  "claim_extraction",
  "claim_relationship_judgment",
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
