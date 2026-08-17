import { describe, expect, it } from "vitest";
import { CANONICAL_NODE_STATES } from "./kinds";
import { DEFAULT_STATE_UNAVAILABLE_REASON, isKnownCanonicalNodeState, unavailableReasonForState } from "./state";

describe("state", () => {
  it("has a mapping for every current canonical NodeState value", () => {
    for (const state of CANONICAL_NODE_STATES) {
      expect(Object.prototype.hasOwnProperty.call(DEFAULT_STATE_UNAVAILABLE_REASON, state)).toBe(true);
    }
  });

  it("only 'missing' carries a non-null unavailableReason", () => {
    for (const state of CANONICAL_NODE_STATES) {
      const reason = unavailableReasonForState(state);
      if (state === "missing") expect(reason).toEqual(expect.stringContaining("not acquired"));
      else expect(reason).toBeNull();
    }
  });

  it("degrades an unrecognized state to null (available) rather than inventing unavailability", () => {
    expect(unavailableReasonForState("some_future_state")).toBeNull();
  });

  it("isKnownCanonicalNodeState is true for all 6 known states and false otherwise", () => {
    for (const state of CANONICAL_NODE_STATES) expect(isKnownCanonicalNodeState(state)).toBe(true);
    expect(isKnownCanonicalNodeState("nonexistent")).toBe(false);
  });

  it("a caller-supplied reasons map overrides the default", () => {
    expect(unavailableReasonForState("read", { read: "custom reason" })).toBe("custom reason");
  });
});
