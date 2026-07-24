import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_PREFERENCES, normalizeWorkspacePreferences } from "./workspacePreferences";

assert.deepEqual(normalizeWorkspacePreferences(null), DEFAULT_WORKSPACE_PREFERENCES);
assert.deepEqual(normalizeWorkspacePreferences({ soundEnabled: false, motionEnabled: false }), {
  ...DEFAULT_WORKSPACE_PREFERENCES,
  soundEnabled: false,
  motionEnabled: false,
});
assert.deepEqual(normalizeWorkspacePreferences({ soundEnabled: "yes", motionEnabled: 1, theme: "not-a-theme" }), DEFAULT_WORKSPACE_PREFERENCES);
console.log("workspacePreferences.test.ts: all assertions passed");
