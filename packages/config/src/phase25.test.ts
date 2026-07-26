import { describe, expect, it } from "vitest";
import { PHASE_25_FEATURE_FLAGS, phase25FeatureEnabled, type Phase25Feature } from "./phase25";

describe("phase25FeatureEnabled", () => {
  it("keeps every research surface off until explicitly enabled", () => {
    for (const feature of Object.keys(PHASE_25_FEATURE_FLAGS) as Phase25Feature[]) {
      expect(phase25FeatureEnabled(feature, {})).toBe(false);
    }
  });

  it("accepts conventional boolean environment values", () => {
    expect(phase25FeatureEnabled("research", { PHASE_25_RESEARCH_ENABLED: "true" })).toBe(true);
    expect(phase25FeatureEnabled("research", { PHASE_25_RESEARCH_ENABLED: "0" })).toBe(false);
    expect(phase25FeatureEnabled("research", { PHASE_25_RESEARCH_ENABLED: "nonsense" })).toBe(false);
  });

  it("resolves each flag from its own env name only", () => {
    // A single flag must never turn on a sibling surface: the humanities judge
    // and the scheduled monitors are gated for reasons the workspace flag does
    // not cover (an unmet eval floor, and jobs that act with no user present).
    const env = { PHASE_25_RESEARCH_ENABLED: "true" };
    expect(phase25FeatureEnabled("research", env)).toBe(true);
    expect(phase25FeatureEnabled("humanitiesJudge", env)).toBe(false);
    expect(phase25FeatureEnabled("monitoring", env)).toBe(false);
  });
});
