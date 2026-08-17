import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_PREFERENCES, normalizeWorkspacePreferences } from "@/lib/auth/workspacePreferences";

describe("normalizeWorkspacePreferences", () => {
  it("returns the defaults for null", () => {
    expect(normalizeWorkspacePreferences(null)).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
  });

  it("keeps valid explicit values over the defaults", () => {
    expect(normalizeWorkspacePreferences({ soundEnabled: false, motionEnabled: false })).toEqual({
      ...DEFAULT_WORKSPACE_PREFERENCES,
      soundEnabled: false,
      motionEnabled: false,
    });
  });

  it("falls back to the defaults for wrongly-typed / unknown values", () => {
    expect(normalizeWorkspacePreferences({ soundEnabled: "yes", motionEnabled: 1, theme: "not-a-theme" })).toEqual(
      DEFAULT_WORKSPACE_PREFERENCES,
    );
  });
});
