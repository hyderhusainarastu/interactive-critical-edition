import { describe, expect, it } from "vitest";
import {
  assertValidScope,
  isExtractClaimsWorkScope,
  isLegacyWorkIdsArrayScope,
  parseClusterDebatesScope,
  parseDetectRelationshipsScope,
  parseExtractClaimsScope,
  parseGenerateHypothesesScope,
  parseImportCorpusScope,
  parseRunMonitorScope,
  parseSynthesizeChamberScope,
} from "./scope";

/**
 * The seam-bug regression this module exists to prevent (D-25-14): every
 * `parse*Scope` function must accept the EXACT literal shape a real
 * dispatcher builds, round-tripped through `JSON.parse(JSON.stringify(...))`
 * to mimic the one real transformation a `jsonb` column actually applies
 * (undefined optional fields vanish; everything else is preserved
 * byte-for-byte) — the same class of drift a live Postgres round trip would
 * exercise, without needing a database for this fast unit-level check.
 */
function roundTrip<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("parseExtractClaimsScope", () => {
  it("accepts the canonical work-scoped shape", () => {
    const built = { workId: "11111111-1111-1111-1111-111111111111" };
    const parsed = parseExtractClaimsScope(roundTrip(built));
    expect(parsed).toEqual(built);
    expect(parsed && isExtractClaimsWorkScope(parsed)).toBe(true);
  });

  it("accepts the canonical corpus-item-scoped shape", () => {
    const built = { corpusItemId: "22222222-2222-2222-2222-222222222222" };
    const parsed = parseExtractClaimsScope(roundTrip(built));
    expect(parsed).toEqual(built);
    expect(parsed && isExtractClaimsWorkScope(parsed)).toBe(false);
  });

  it("rejects null, arrays, and empty ids", () => {
    expect(parseExtractClaimsScope(null)).toBeNull();
    expect(parseExtractClaimsScope([])).toBeNull();
    expect(parseExtractClaimsScope({ workId: "" })).toBeNull();
    expect(parseExtractClaimsScope({})).toBeNull();
  });

  it("rejects the pre-fix D-25-14 shape ({ workIds: [...] }) as unparseable — never silently coerced", () => {
    const legacyShape = { workIds: ["11111111-1111-1111-1111-111111111111"] };
    expect(parseExtractClaimsScope(roundTrip(legacyShape))).toBeNull();
  });
});

describe("isLegacyWorkIdsArrayScope", () => {
  it("recognizes the exact pre-fix dispatch shape", () => {
    expect(isLegacyWorkIdsArrayScope({ workIds: ["a"] })).toBe(true);
  });

  it("does not flag the canonical shapes, or unrelated malformed scopes", () => {
    expect(isLegacyWorkIdsArrayScope({ workId: "a" })).toBe(false);
    expect(isLegacyWorkIdsArrayScope({ corpusItemId: "a" })).toBe(false);
    expect(isLegacyWorkIdsArrayScope(null)).toBe(false);
    expect(isLegacyWorkIdsArrayScope({})).toBe(false);
    expect(isLegacyWorkIdsArrayScope("not-an-object")).toBe(false);
  });
});

describe("parseDetectRelationshipsScope / parseClusterDebatesScope", () => {
  it("accept {projectId} and reject everything else", () => {
    const built = { projectId: "proj-1" };
    expect(parseDetectRelationshipsScope(roundTrip(built))).toEqual(built);
    expect(parseClusterDebatesScope(roundTrip(built))).toEqual(built);
    expect(parseDetectRelationshipsScope({})).toBeNull();
    expect(parseClusterDebatesScope({ projectId: "" })).toBeNull();
  });
});

describe("parseSynthesizeChamberScope", () => {
  it("accepts the real dispatch shape ({projectId, clusterId}), reading only clusterId", () => {
    const built = { projectId: "proj-1", clusterId: "cluster-1" };
    expect(parseSynthesizeChamberScope(roundTrip(built))).toEqual({ clusterId: "cluster-1" });
  });

  it("rejects a scope with no clusterId", () => {
    expect(parseSynthesizeChamberScope({ projectId: "proj-1" })).toBeNull();
  });
});

describe("parseGenerateHypothesesScope", () => {
  it("accepts the real dispatch shape, normalizing question/maxHypotheses", () => {
    const built = { projectId: "proj-1", question: "  What is virtue?  ", maxHypotheses: 3 };
    expect(parseGenerateHypothesesScope(roundTrip(built))).toEqual({ projectId: "proj-1", question: "What is virtue?", maxHypotheses: 3 });
  });

  it("defaults question to null and maxHypotheses to undefined when absent", () => {
    const built = { projectId: "proj-1" };
    expect(parseGenerateHypothesesScope(roundTrip(built))).toEqual({ projectId: "proj-1", question: null, maxHypotheses: undefined });
  });

  it("rejects a missing projectId", () => {
    expect(parseGenerateHypothesesScope({ question: "x" })).toBeNull();
  });
});

describe("parseImportCorpusScope", () => {
  it("accepts the real dispatch shape with and without projectId", () => {
    const withProject = { projectId: "proj-1", items: [{ provider: "openalex", externalId: "W1" }] };
    expect(parseImportCorpusScope(roundTrip(withProject))).toEqual(withProject);
    const withoutProject = { items: [{ provider: "arxiv", externalId: "1234.5678" }] };
    expect(parseImportCorpusScope(roundTrip(withoutProject))).toEqual({ projectId: undefined, items: withoutProject.items });
  });

  it("rejects an empty items array or a malformed item", () => {
    expect(parseImportCorpusScope({ items: [] })).toBeNull();
    expect(parseImportCorpusScope({ items: [{ provider: "openalex" }] })).toBeNull();
  });
});

describe("parseRunMonitorScope", () => {
  it("accepts the real dispatch shape ({monitorId}) and the cron fan-out's empty scope", () => {
    expect(parseRunMonitorScope(roundTrip({ monitorId: "mon-1" }))).toEqual({ monitorId: "mon-1" });
    expect(parseRunMonitorScope({})).toEqual({});
  });

  it("rejects a non-string monitorId", () => {
    expect(parseRunMonitorScope({ monitorId: 5 })).toBeNull();
  });
});

describe("assertValidScope", () => {
  it("returns the value unchanged when non-null", () => {
    expect(assertValidScope({ workId: "a" }, "extract_claims")).toEqual({ workId: "a" });
  });

  it("throws when null — a dispatcher-side canary against ever inserting an unparseable scope", () => {
    expect(() => assertValidScope(null, "extract_claims")).toThrow(/invalid extract_claims scope/);
  });
});
