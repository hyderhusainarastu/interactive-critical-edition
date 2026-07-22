import { describe, expect, it } from "vitest";
import { phase18RagEnabled } from "./phase18";

describe("phase18RagEnabled", () => {
  it("fails closed until explicitly enabled", () => {
    expect(phase18RagEnabled({})).toBe(false);
    expect(phase18RagEnabled({ PHASE_18_RAG_ENABLED: "false" })).toBe(false);
  });

  it("accepts conventional true values", () => {
    expect(phase18RagEnabled({ PHASE_18_RAG_ENABLED: "true" })).toBe(true);
    expect(phase18RagEnabled({ PHASE_18_RAG_ENABLED: "ON" })).toBe(true);
  });
});
