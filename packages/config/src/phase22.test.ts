import { describe, expect, it } from "vitest";
import { phase22CompetencyEnabled, phase22CompetencyFeatureEnabled, phase22CompetencyProviderEnabled } from "./phase22";

describe("phase22CompetencyFeatureEnabled", () => {
  it("keeps both flags off until explicitly enabled", () => {
    expect(phase22CompetencyFeatureEnabled("enabled", {})).toBe(false);
    expect(phase22CompetencyFeatureEnabled("providerEnabled", {})).toBe(false);
    expect(phase22CompetencyEnabled({})).toBe(false);
    expect(phase22CompetencyProviderEnabled({})).toBe(false);
  });

  it("accepts conventional boolean environment values", () => {
    expect(phase22CompetencyEnabled({ PHASE_22_COMPETENCY_ENABLED: "true" })).toBe(true);
    expect(phase22CompetencyEnabled({ PHASE_22_COMPETENCY_ENABLED: "0" })).toBe(false);
    expect(phase22CompetencyProviderEnabled({ PHASE_22_COMPETENCY_PROVIDER_ENABLED: "on" })).toBe(true);
  });

  it("keeps the two flags independently addressable", () => {
    const env = { PHASE_22_COMPETENCY_ENABLED: "true", PHASE_22_COMPETENCY_PROVIDER_ENABLED: "false" };
    expect(phase22CompetencyEnabled(env)).toBe(true);
    expect(phase22CompetencyProviderEnabled(env)).toBe(false);
  });
});
