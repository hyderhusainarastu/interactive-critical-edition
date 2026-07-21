import { describe, expect, it } from "vitest";
import { phase12FeatureEnabled } from "./phase12";

describe("phase12FeatureEnabled", () => {
  it("keeps future features off until explicitly enabled", () => {
    expect(phase12FeatureEnabled("writer", {})).toBe(false);
    expect(phase12FeatureEnabled("pipelineV4", {})).toBe(false);
  });

  it("accepts conventional boolean environment values", () => {
    expect(phase12FeatureEnabled("writer", { PHASE_12_WRITER_ENABLED: "true" })).toBe(true);
    expect(phase12FeatureEnabled("writer", { PHASE_12_WRITER_ENABLED: "0" })).toBe(false);
  });
});
