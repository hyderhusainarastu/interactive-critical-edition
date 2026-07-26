import { describe, expect, it } from "vitest";
import {
  CLAIM_NATURES,
  CLAIM_RELATION_CATEGORIES,
  CLAIM_RELATION_MECHANISMS,
  CLAIM_RELATION_VALENCES,
  MECHANISM_VALENCE,
  STAGE2_MECHANISMS,
  TAXONOMY_VERSION_CLAIMS,
  TAXONOMY_VERSION_RELATIONSHIPS,
  isClaimNature,
  validateMechanismForValence,
  validateRelationCategory,
  validateValence,
} from "./taxonomy";

describe("taxonomy constants", () => {
  it("CLAIM_NATURES has exactly the 8 documented values", () => {
    expect(CLAIM_NATURES).toEqual([
      "empirical",
      "textual",
      "interpretive",
      "historical",
      "conceptual",
      "normative",
      "definitional",
      "methodological",
    ]);
  });

  it("CLAIM_RELATION_VALENCES is frozen at exactly the eval-certified 4 values", () => {
    expect(CLAIM_RELATION_VALENCES).toEqual(["contradiction", "support", "nuance", "unrelated"]);
  });

  it("CLAIM_RELATION_CATEGORIES matches the ported judge schema", () => {
    expect(CLAIM_RELATION_CATEGORIES).toEqual(["methodological", "findings", "theoretical", "scope"]);
  });

  it("CLAIM_RELATION_MECHANISMS is stage-1 only — a single honest placeholder", () => {
    expect(CLAIM_RELATION_MECHANISMS).toEqual(["unspecified"]);
    // Stage-2 values must NOT be in the active list yet.
    for (const stage2 of STAGE2_MECHANISMS) {
      expect((CLAIM_RELATION_MECHANISMS as readonly string[]).includes(stage2)).toBe(false);
    }
  });

  it("every stage-2 mechanism maps only to nuance/contradiction", () => {
    for (const mechanism of STAGE2_MECHANISMS) {
      expect(MECHANISM_VALENCE[mechanism].sort()).toEqual(["contradiction", "nuance"]);
    }
  });

  it("version strings are set", () => {
    expect(TAXONOMY_VERSION_CLAIMS).toBe("c1");
    expect(TAXONOMY_VERSION_RELATIONSHIPS).toBe("r1");
  });
});

describe("isClaimNature", () => {
  it("accepts every documented nature", () => {
    for (const nature of CLAIM_NATURES) expect(isClaimNature(nature)).toBe(true);
  });
  it("rejects unknown strings and non-strings", () => {
    expect(isClaimNature("fabricated")).toBe(false);
    expect(isClaimNature(undefined)).toBe(false);
    expect(isClaimNature(42)).toBe(false);
    expect(isClaimNature(null)).toBe(false);
  });
});

describe("validateValence", () => {
  it("accepts every documented valence", () => {
    for (const v of CLAIM_RELATION_VALENCES) expect(validateValence(v)).toBe(v);
  });
  it("returns null for anything else", () => {
    expect(validateValence("agreement")).toBeNull();
    expect(validateValence(undefined)).toBeNull();
    expect(validateValence(3)).toBeNull();
  });
});

describe("validateRelationCategory", () => {
  it("accepts every documented category", () => {
    for (const c of CLAIM_RELATION_CATEGORIES) expect(validateRelationCategory(c)).toBe(c);
  });
  it("returns null otherwise", () => {
    expect(validateRelationCategory("novel")).toBeNull();
  });
});

describe("validateMechanismForValence", () => {
  it("accepts a stage-2 mechanism paired with an allowed valence", () => {
    expect(validateMechanismForValence("different_definition", "nuance")).toBe("different_definition");
    expect(validateMechanismForValence("interprets_differently", "contradiction")).toBe("interprets_differently");
    expect(validateMechanismForValence("different_scope_conditions", "nuance")).toBe("different_scope_conditions");
  });

  it("drops to null (never coerces) when the mechanism doesn't fit the valence", () => {
    expect(validateMechanismForValence("different_definition", "support")).toBeNull();
    expect(validateMechanismForValence("different_definition", "unrelated")).toBeNull();
  });

  it("drops to null for a fabricated mechanism string", () => {
    expect(validateMechanismForValence("secretly_agrees", "nuance")).toBeNull();
  });

  it("drops to null for a non-string mechanism", () => {
    expect(validateMechanismForValence(undefined, "nuance")).toBeNull();
    expect(validateMechanismForValence(42, "contradiction")).toBeNull();
  });
});
