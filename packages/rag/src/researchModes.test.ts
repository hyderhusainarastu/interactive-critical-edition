import { describe, expect, it } from "vitest";
import {
  buildResearchModeInput,
  fallbackCounterOrSupportAnswer,
  fallbackDebateMapAnswer,
  fallbackDisagreementAnswer,
  isExplicitResearchMode,
  isResearchMode,
  noEvidenceResearchModeAnswer,
  retrieveCounterarguments,
  retrieveDebateMap,
  retrieveDisagreement,
  retrieveSupport,
  validateResearchModeAnswer,
  type DebateClusterSummary,
  type ResearchModeClaim,
  type ResearchModeRelationship,
  type ResearchModeRepository,
} from "./researchModes";

const USER = "user-1";

function claim(overrides: Partial<ResearchModeClaim> & { id: string }): ResearchModeClaim {
  return {
    claimText: "A claim.",
    claimNature: "interpretive",
    workId: "work-x",
    workTitle: "Work X",
    supportingExcerpt: "excerpt",
    section: "Body",
    ...overrides,
  };
}

function relationship(overrides: Partial<ResearchModeRelationship> & { id: string; claimLoId: string; claimHiId: string }): ResearchModeRelationship {
  return {
    valence: "contradiction",
    category: "theoretical",
    explanation: "They disagree.",
    resolution: "Check the primary text.",
    ...overrides,
  };
}

/** A small in-memory fake — the whole point of the repository seam
 *  (`ResearchModeRepository`) is that retrieval shape is testable without a
 *  database. */
class FakeRepository implements ResearchModeRepository {
  claims = new Map<string, ResearchModeClaim>();
  relationships: ResearchModeRelationship[] = [];
  clusters = new Map<string, DebateClusterSummary>();
  clusterMembers = new Map<string, string[]>();
  clusterRelationshipIds = new Map<string, string[]>();

  async claimsForWork(_userId: string, workId: string) {
    return [...this.claims.values()].filter((c) => c.workId === workId);
  }
  async claimById(_userId: string, claimId: string) {
    return this.claims.get(claimId) ?? null;
  }
  async claimsByIds(_userId: string, claimIds: readonly string[]) {
    return claimIds.map((id) => this.claims.get(id)).filter((c): c is ResearchModeClaim => Boolean(c));
  }
  async relationshipsForClaimIds(_userId: string, claimIds: readonly string[], valences: readonly string[]) {
    const ids = new Set(claimIds);
    return this.relationships.filter(
      (r) => valences.includes(r.valence) && (ids.has(r.claimLoId) || ids.has(r.claimHiId)),
    );
  }
  async cluster(_userId: string, clusterId: string) {
    return this.clusters.get(clusterId) ?? null;
  }
  async clusterMemberClaims(_userId: string, clusterId: string) {
    const ids = this.clusterMembers.get(clusterId) ?? [];
    return ids.map((id) => this.claims.get(id)).filter((c): c is ResearchModeClaim => Boolean(c));
  }
  async clusterRelationships(_userId: string, clusterId: string) {
    const ids = new Set(this.clusterRelationshipIds.get(clusterId) ?? []);
    return this.relationships.filter((r) => ids.has(r.id));
  }
}

describe("mode taxonomy", () => {
  it("validates the exact five-value mode set, NULL/undefined excluded", () => {
    expect(isResearchMode("socratic")).toBe(true);
    expect(isResearchMode("find_counterarguments")).toBe(true);
    expect(isResearchMode("find_support")).toBe(true);
    expect(isResearchMode("explain_disagreement")).toBe(true);
    expect(isResearchMode("map_debate")).toBe(true);
    expect(isResearchMode("fabricated_mode")).toBe(false);
    expect(isResearchMode(undefined)).toBe(false);
  });

  it("distinguishes socratic from the four explicit research modes", () => {
    expect(isExplicitResearchMode("socratic")).toBe(false);
    expect(isExplicitResearchMode("find_support")).toBe(true);
  });
});

describe("retrieveCounterarguments / retrieveSupport", () => {
  it("returns the other-side claim of a contradiction edge, scoped by work", () => {
    const repo = new FakeRepository();
    const base = claim({ id: "claim-a", workId: "work-a" });
    const other = claim({ id: "claim-b", workId: "work-b", claimText: "The opposing claim." });
    repo.claims.set(base.id, base);
    repo.claims.set(other.id, other);
    repo.relationships.push(relationship({ id: "rel-1", claimLoId: "claim-a", claimHiId: "claim-b", valence: "contradiction" }));

    return retrieveCounterarguments(repo, USER, { kind: "work", workId: "work-a" }).then((result) => {
      expect(result.found).toBe(true);
      if (!result.found) throw new Error("unreachable");
      expect(result.claims.map((c) => c.id)).toEqual(["claim-b"]);
      expect(result.relationships).toHaveLength(1);
    });
  });

  it("resolves scope by a single claim id instead of a work", async () => {
    const repo = new FakeRepository();
    const base = claim({ id: "claim-a", workId: "work-a" });
    const other = claim({ id: "claim-b", workId: "work-b" });
    repo.claims.set(base.id, base);
    repo.claims.set(other.id, other);
    repo.relationships.push(relationship({ id: "rel-1", claimLoId: "claim-a", claimHiId: "claim-b", valence: "nuance" }));

    const result = await retrieveCounterarguments(repo, USER, { kind: "claim", claimId: "claim-a" });
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.claims.map((c) => c.id)).toEqual(["claim-b"]);
  });

  it("only pulls 'support' valence for find_support, ignoring a contradiction edge on the same claim", async () => {
    const repo = new FakeRepository();
    const base = claim({ id: "claim-a", workId: "work-a" });
    const supporter = claim({ id: "claim-b", workId: "work-b" });
    const contradictor = claim({ id: "claim-c", workId: "work-c" });
    repo.claims.set(base.id, base);
    repo.claims.set(supporter.id, supporter);
    repo.claims.set(contradictor.id, contradictor);
    repo.relationships.push(
      relationship({ id: "rel-1", claimLoId: "claim-a", claimHiId: "claim-b", valence: "support" }),
      relationship({ id: "rel-2", claimLoId: "claim-a", claimHiId: "claim-c", valence: "contradiction" }),
    );

    const result = await retrieveSupport(repo, USER, { kind: "work", workId: "work-a" });
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.claims.map((c) => c.id)).toEqual(["claim-b"]);
  });

  it("returns not-found when the scoped work/claim has no claims at all", async () => {
    const repo = new FakeRepository();
    const result = await retrieveCounterarguments(repo, USER, { kind: "work", workId: "empty-work" });
    expect(result).toEqual({ found: false, reason: "no_base_claims" });
  });

  it("returns not-found when claims exist but no relationship touches them", async () => {
    const repo = new FakeRepository();
    repo.claims.set("claim-a", claim({ id: "claim-a", workId: "work-a" }));
    const result = await retrieveSupport(repo, USER, { kind: "work", workId: "work-a" });
    expect(result).toEqual({ found: false, reason: "no_relationships" });
  });

  it("skips a relationship entirely internal to the base set (no self-citation)", async () => {
    const repo = new FakeRepository();
    const a = claim({ id: "claim-a", workId: "work-a" });
    const b = claim({ id: "claim-b", workId: "work-a" });
    repo.claims.set(a.id, a);
    repo.claims.set(b.id, b);
    repo.relationships.push(relationship({ id: "rel-1", claimLoId: "claim-a", claimHiId: "claim-b", valence: "contradiction" }));

    const result = await retrieveCounterarguments(repo, USER, { kind: "work", workId: "work-a" });
    expect(result).toEqual({ found: false, reason: "no_relationships" });
  });
});

describe("retrieveDisagreement", () => {
  it("splits into two sides for an explicit work pair, keeping only cross-work edges", async () => {
    const repo = new FakeRepository();
    const a1 = claim({ id: "a1", workId: "work-a", claimText: "A says X." });
    const b1 = claim({ id: "b1", workId: "work-b", claimText: "B says not-X." });
    const a2 = claim({ id: "a2", workId: "work-a", claimText: "Unrelated claim from A." });
    repo.claims.set(a1.id, a1);
    repo.claims.set(b1.id, b1);
    repo.claims.set(a2.id, a2);
    repo.relationships.push(relationship({ id: "rel-1", claimLoId: "a1", claimHiId: "b1", valence: "contradiction" }));

    const result = await retrieveDisagreement(repo, USER, { kind: "workPair", workIdA: "work-a", workIdB: "work-b" });
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.sideA.map((c) => c.id)).toEqual(["a1"]);
    expect(result.sideB.map((c) => c.id)).toEqual(["b1"]);
    expect(result.cluster).toBeNull();
  });

  it("returns the explicit not-found when a work pair has no cross-work relationship", async () => {
    const repo = new FakeRepository();
    repo.claims.set("a1", claim({ id: "a1", workId: "work-a" }));
    repo.claims.set("b1", claim({ id: "b1", workId: "work-b" }));
    const result = await retrieveDisagreement(repo, USER, { kind: "workPair", workIdA: "work-a", workIdB: "work-b" });
    expect(result).toEqual({ found: false, reason: "no_relationships" });
  });

  it("splits a two-work cluster into sides by work", async () => {
    const repo = new FakeRepository();
    const a1 = claim({ id: "a1", workId: "work-a" });
    const b1 = claim({ id: "b1", workId: "work-b" });
    repo.claims.set(a1.id, a1);
    repo.claims.set(b1.id, b1);
    repo.clusters.set("cluster-1", { id: "cluster-1", name: "The Debate", researchQuestion: null, description: null });
    repo.clusterMembers.set("cluster-1", ["a1", "b1"]);
    repo.relationships.push(relationship({ id: "rel-1", claimLoId: "a1", claimHiId: "b1", valence: "nuance" }));
    repo.clusterRelationshipIds.set("cluster-1", ["rel-1"]);

    const result = await retrieveDisagreement(repo, USER, { kind: "cluster", clusterId: "cluster-1" });
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.sideA.map((c) => c.id)).toEqual(["a1"]);
    expect(result.sideB.map((c) => c.id)).toEqual(["b1"]);
    expect(result.cluster?.name).toBe("The Debate");
  });

  it("returns the honest not-found for a cluster spanning three works (no principled binary split)", async () => {
    const repo = new FakeRepository();
    const a1 = claim({ id: "a1", workId: "work-a" });
    const b1 = claim({ id: "b1", workId: "work-b" });
    const c1 = claim({ id: "c1", workId: "work-c" });
    repo.claims.set(a1.id, a1);
    repo.claims.set(b1.id, b1);
    repo.claims.set(c1.id, c1);
    repo.clusters.set("cluster-1", { id: "cluster-1", name: "Three-way", researchQuestion: null, description: null });
    repo.clusterMembers.set("cluster-1", ["a1", "b1", "c1"]);

    const result = await retrieveDisagreement(repo, USER, { kind: "cluster", clusterId: "cluster-1" });
    expect(result).toEqual({ found: false, reason: "ambiguous_sides" });
  });

  it("returns the honest not-found for a cluster confined to a single work", async () => {
    const repo = new FakeRepository();
    const a1 = claim({ id: "a1", workId: "work-a" });
    const a2 = claim({ id: "a2", workId: "work-a" });
    repo.claims.set(a1.id, a1);
    repo.claims.set(a2.id, a2);
    repo.clusters.set("cluster-1", { id: "cluster-1", name: "Internal tension", researchQuestion: null, description: null });
    repo.clusterMembers.set("cluster-1", ["a1", "a2"]);

    const result = await retrieveDisagreement(repo, USER, { kind: "cluster", clusterId: "cluster-1" });
    expect(result).toEqual({ found: false, reason: "ambiguous_sides" });
  });

  it("returns not-found when the cluster id does not resolve", async () => {
    const repo = new FakeRepository();
    const result = await retrieveDisagreement(repo, USER, { kind: "cluster", clusterId: "missing" });
    expect(result).toEqual({ found: false, reason: "cluster_not_found" });
  });
});

describe("retrieveDebateMap", () => {
  it("returns the cluster and its member claims", async () => {
    const repo = new FakeRepository();
    const a1 = claim({ id: "a1", workId: "work-a" });
    const b1 = claim({ id: "b1", workId: "work-b" });
    repo.claims.set(a1.id, a1);
    repo.claims.set(b1.id, b1);
    repo.clusters.set("cluster-1", { id: "cluster-1", name: "Akrasia debate", researchQuestion: "Q", description: "D" });
    repo.clusterMembers.set("cluster-1", ["a1", "b1"]);
    repo.relationships.push(relationship({ id: "rel-1", claimLoId: "a1", claimHiId: "b1", valence: "contradiction" }));
    repo.clusterRelationshipIds.set("cluster-1", ["rel-1"]);

    const result = await retrieveDebateMap(repo, USER, "cluster-1");
    expect(result.found).toBe(true);
    if (!result.found) throw new Error("unreachable");
    expect(result.claims.map((c) => c.id).sort()).toEqual(["a1", "b1"]);
    expect(result.relationships).toHaveLength(1);
  });

  it("returns not-found for a cluster with fewer than 2 members", async () => {
    const repo = new FakeRepository();
    repo.claims.set("a1", claim({ id: "a1", workId: "work-a" }));
    repo.clusters.set("cluster-1", { id: "cluster-1", name: "Lonely", researchQuestion: null, description: null });
    repo.clusterMembers.set("cluster-1", ["a1"]);
    const result = await retrieveDebateMap(repo, USER, "cluster-1");
    expect(result).toEqual({ found: false, reason: "insufficient_members" });
  });
});

describe("unified SOURCE_N + CLAIM_N label namespace", () => {
  it("labels claims as CLAIM_N and round-trips them through validateResearchModeAnswer", () => {
    const a = claim({ id: "claim-a", claimText: "First claim." });
    const b = claim({ id: "claim-b", claimText: "Second claim." });
    const { prompt, labelToRef } = buildResearchModeInput({
      mode: "find_counterarguments",
      question: "What pushes back on this?",
      history: [],
      claims: [a, b],
    });

    expect(prompt).toContain('<claim id="CLAIM_1"');
    expect(prompt).toContain('<claim id="CLAIM_2"');
    expect(labelToRef.get("CLAIM_1")).toEqual({ kind: "claim", id: "claim-a" });
    expect(labelToRef.get("CLAIM_2")).toEqual({ kind: "claim", id: "claim-b" });
    // No raw claim UUID appears anywhere in the model-facing prompt.
    expect(prompt).not.toContain("claim-a");
    expect(prompt).not.toContain("claim-b");

    const answer = validateResearchModeAnswer(
      { answer: "Claim two pushes back on this.", citedLabels: ["CLAIM_2"], notFound: false },
      labelToRef,
    );
    expect(answer.citedClaimIds).toEqual(["claim-b"]);
    expect(answer.citedChunkIds).toEqual([]);
    expect(answer.droppedCitationCount).toBe(0);
  });

  it("labels each side distinctly for explain_disagreement, both sides sharing one label counter", () => {
    const a = claim({ id: "claim-a" });
    const b = claim({ id: "claim-b" });
    const { prompt, labelToRef } = buildResearchModeInput({
      mode: "explain_disagreement",
      question: "Where do these disagree?",
      history: [],
      sides: { a: [a], b: [b] },
    });
    expect(prompt).toContain('<claim id="CLAIM_1"');
    expect(prompt).toContain('side="A"');
    expect(prompt).toContain('<claim id="CLAIM_2"');
    expect(prompt).toContain('side="B"');
    expect(labelToRef.size).toBe(2);
  });

  it("drops a fabricated/near-miss label rather than trusting or fabricating a citation", () => {
    const labelToRef = new Map([["CLAIM_1", { kind: "claim" as const, id: "claim-a" }]]);
    const answer = validateResearchModeAnswer(
      { answer: "Substantive answer.", citedLabels: ["CLAIM_1", "CLAIM_99", "Claim_1"], notFound: false },
      labelToRef,
    );
    expect(answer.citedClaimIds).toEqual(["claim-a"]);
    expect(answer.droppedCitationCount).toBe(2);
  });

  it("rejects a substantive answer with zero real citations", () => {
    const labelToRef = new Map([["CLAIM_1", { kind: "claim" as const, id: "claim-a" }]]);
    expect(() =>
      validateResearchModeAnswer({ answer: "Unsupported.", citedLabels: ["CLAIM_9"], notFound: false }, labelToRef),
    ).toThrow(/citation/);
  });

  it("accepts an explicit not-found answer with zero citations", () => {
    const labelToRef = new Map<string, { kind: "claim"; id: string }>();
    const answer = validateResearchModeAnswer({ answer: "No support found.", citedLabels: [], notFound: true }, labelToRef);
    expect(answer.notFound).toBe(true);
    expect(answer.citedClaimIds).toEqual([]);
  });
});

describe("explain_disagreement's per-side citation rule", () => {
  it("accepts an answer citing at least one claim from each side", () => {
    const labelToRef = new Map([
      ["CLAIM_1", { kind: "claim" as const, id: "a1" }],
      ["CLAIM_2", { kind: "claim" as const, id: "b1" }],
    ]);
    const answer = validateResearchModeAnswer(
      { answer: "A holds X; B holds not-X.", citedLabels: ["CLAIM_1", "CLAIM_2"], notFound: false },
      labelToRef,
      { requireSides: { sideA: new Set(["a1"]), sideB: new Set(["b1"]) } },
    );
    expect(answer.citedClaimIds.sort()).toEqual(["a1", "b1"]);
  });

  it("rejects a one-sided answer, forcing the caller to the not-found path", () => {
    const labelToRef = new Map([
      ["CLAIM_1", { kind: "claim" as const, id: "a1" }],
      ["CLAIM_2", { kind: "claim" as const, id: "b1" }],
    ]);
    expect(() =>
      validateResearchModeAnswer(
        { answer: "A holds X.", citedLabels: ["CLAIM_1"], notFound: false },
        labelToRef,
        { requireSides: { sideA: new Set(["a1"]), sideB: new Set(["b1"]) } },
      ),
    ).toThrow(/each side/);
  });

  it("never applies the per-side rule to a notFound answer", () => {
    const labelToRef = new Map([["CLAIM_1", { kind: "claim" as const, id: "a1" }]]);
    const answer = validateResearchModeAnswer(
      { answer: "No well-defined disagreement found.", citedLabels: [], notFound: true },
      labelToRef,
      { requireSides: { sideA: new Set(["a1"]), sideB: new Set(["b1"]) } },
    );
    expect(answer.notFound).toBe(true);
  });
});

describe("deterministic $0 fallbacks", () => {
  it("cites the first claim for find_counterarguments/find_support", () => {
    const c = claim({ id: "claim-a", workTitle: "Work A", claimText: "Text." });
    const answer = fallbackCounterOrSupportAnswer("find_support", [c]);
    expect(answer.notFound).toBe(false);
    expect(answer.citedClaimIds).toEqual(["claim-a"]);
  });

  it("returns the honest not-found when there are no claims to fall back on", () => {
    expect(fallbackCounterOrSupportAnswer("find_counterarguments", [])).toEqual(noEvidenceResearchModeAnswer("find_counterarguments"));
  });

  it("cites one claim per side for explain_disagreement", () => {
    const a = claim({ id: "a1", workTitle: "Work A" });
    const b = claim({ id: "b1", workTitle: "Work B" });
    const answer = fallbackDisagreementAnswer([a], [b]);
    expect(answer.citedClaimIds.sort()).toEqual(["a1", "b1"]);
    expect(answer.notFound).toBe(false);
  });

  it("cites a sample of cluster members for map_debate", () => {
    const cluster: DebateClusterSummary = { id: "cluster-1", name: "The Debate", researchQuestion: null, description: null };
    const claims = [claim({ id: "a1" }), claim({ id: "b1" })];
    const answer = fallbackDebateMapAnswer(cluster, claims);
    expect(answer.citedClaimIds.sort()).toEqual(["a1", "b1"]);
    expect(answer.answer).toContain("The Debate");
  });
});
