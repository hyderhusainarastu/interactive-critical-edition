import { describe, expect, it } from "vitest";
import {
  STAGE_LABEL,
  V2_STAGE_SEQUENCE,
  V3_STAGE_SEQUENCE,
  stageSequenceForPipeline,
} from "./stages";

describe("stage sequences", () => {
  it("keeps v2's real, worker-emitted stage order", () => {
    expect(V2_STAGE_SEQUENCE).toEqual([
      "extracting",
      "research-discovery",
      "relevance-gate",
      "classification",
      "validation",
    ]);
  });

  it("keeps v3's approved evidence-producing stage order", () => {
    expect(V3_STAGE_SEQUENCE).toEqual([
      "canonical-identity", "structural-outline", "section-passage-anchors",
      "explicit-citations", "concepts-people-debates", "lane-discovery",
      "relevance-gate", "creator-verification", "citation-graph-expansion",
      "credibility", "claims", "conservative-influence-classification",
    ]);
  });

  it("every stage in both sequences has a human-readable label", () => {
    for (const stage of [...V2_STAGE_SEQUENCE, ...V3_STAGE_SEQUENCE]) {
      expect(STAGE_LABEL[stage]).toBeTruthy();
    }
  });

  it("selects the sequence matching the pipeline version, defaulting to v2", () => {
    expect(stageSequenceForPipeline("v3")).toBe(V3_STAGE_SEQUENCE);
    expect(stageSequenceForPipeline("v2")).toBe(V2_STAGE_SEQUENCE);
    expect(stageSequenceForPipeline("v1")).toBe(V2_STAGE_SEQUENCE);
  });
});
