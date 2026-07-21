import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PIPELINE_VERSION,
  isEditionPipeline,
  parsePipelineVersion,
  pipelineAtLeast,
  pipelineVersion,
  resetPipelineWarnings,
} from "./pipeline";

describe("parsePipelineVersion", () => {
  beforeEach(() => resetPipelineWarnings());

  it("accepts every known version", () => {
    expect(parsePipelineVersion("v1")).toBe("v1");
    expect(parsePipelineVersion("v2")).toBe("v2");
    expect(parsePipelineVersion("v3")).toBe("v3");
    expect(parsePipelineVersion("v4")).toBe("v4");
  });

  it("tolerates whitespace, casing, and a bare number", () => {
    expect(parsePipelineVersion(" v2 ")).toBe("v2");
    expect(parsePipelineVersion("V3")).toBe("v3");
    expect(parsePipelineVersion("4")).toBe("v4");
    expect(parsePipelineVersion("2")).toBe("v2");
  });

  it("falls back to the default when unset or empty", () => {
    expect(parsePipelineVersion(undefined)).toBe(DEFAULT_PIPELINE_VERSION);
    expect(parsePipelineVersion(null)).toBe(DEFAULT_PIPELINE_VERSION);
    expect(parsePipelineVersion("   ")).toBe(DEFAULT_PIPELINE_VERSION);
  });

  it("warns once about an unrecognized value instead of degrading silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parsePipelineVersion("v9")).toBe(DEFAULT_PIPELINE_VERSION);
    expect(parsePipelineVersion("v9")).toBe(DEFAULT_PIPELINE_VERSION);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("v9");
    warn.mockRestore();
  });
});

describe("pipelineAtLeast", () => {
  it("orders versions rather than comparing them for equality", () => {
    expect(pipelineAtLeast("v3", "v2")).toBe(true);
    expect(pipelineAtLeast("v4", "v3")).toBe(true);
    expect(pipelineAtLeast("v2", "v2")).toBe(true);
    expect(pipelineAtLeast("v1", "v2")).toBe(false);
  });
});

describe("isEditionPipeline", () => {
  it("is true for v2 through v4, false for v1", () => {
    // The behaviour the old `=== "v2"` checks had for v1/v2 is preserved
    // exactly; v3 is the case that used to fall back to v1 in silence.
    expect(isEditionPipeline("v1")).toBe(false);
    expect(isEditionPipeline("v2")).toBe(true);
    expect(isEditionPipeline("v3")).toBe(true);
    expect(isEditionPipeline("v4")).toBe(true);
  });
});

describe("pipelineVersion", () => {
  it("reads ANALYSIS_PIPELINE from the supplied environment", () => {
    expect(pipelineVersion({ ANALYSIS_PIPELINE: "v3" })).toBe("v3");
    expect(pipelineVersion({ ANALYSIS_PIPELINE: "v4" })).toBe("v4");
    expect(pipelineVersion({})).toBe(DEFAULT_PIPELINE_VERSION);
  });
});
