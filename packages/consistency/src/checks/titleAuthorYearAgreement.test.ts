import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkTitleAuthorYearAgreement } from "./titleAuthorYearAgreement";

describe("checkTitleAuthorYearAgreement", () => {
  it("reports nothing when a work's title/author agree with its linked identity", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [{ id: "wi1", canonicalTitle: "The Nicomachean Ethics", authorSurname: "aristotle", year: -340 }],
      works: [{ id: "w1", title: "Nicomachean Ethics", authorName: "Aristotle", workIdentityId: "wi1", deletedAt: null }],
    };
    expect(checkTitleAuthorYearAgreement(snapshot)).toEqual([]);
  });

  it("flags (report-only, never repaired) a work whose title has near-zero overlap with its identity's canonical title", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [{ id: "wi1", canonicalTitle: "The Nicomachean Ethics", authorSurname: "aristotle", year: null }],
      works: [{ id: "w1", title: "Completely Different Book Entirely", authorName: "Aristotle", workIdentityId: "wi1", deletedAt: null }],
    };
    const mismatches = checkTitleAuthorYearAgreement(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toBeNull();
    expect(mismatches[0].severity).toBe("info");
  });

  it("flags (report-only) a work whose author surname disagrees with its identity", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [{ id: "wi1", canonicalTitle: "The Nicomachean Ethics", authorSurname: "aristotle", year: null }],
      works: [{ id: "w1", title: "The Nicomachean Ethics", authorName: "Plato", workIdentityId: "wi1", deletedAt: null }],
    };
    const mismatches = checkTitleAuthorYearAgreement(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toBeNull();
  });

  it("ignores a soft-deleted (trashed) work", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [{ id: "wi1", canonicalTitle: "The Nicomachean Ethics", authorSurname: "aristotle", year: null }],
      works: [{ id: "w1", title: "Nothing alike", authorName: "Nobody", workIdentityId: "wi1", deletedAt: "2026-01-01T00:00:00Z" }],
    };
    expect(checkTitleAuthorYearAgreement(snapshot)).toEqual([]);
  });

  it("backfills a work_identity's null year from its own primary learning_resource's year", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [{ id: "wi1", canonicalTitle: "Sample Primary Text", authorSurname: null, year: null }],
      learningResources: [{ id: "lr1", workIdentityId: "wi1", bibRecordId: null, workRole: "primary", title: "Sample Primary Text", year: 1999 }],
    };
    const mismatches = checkTitleAuthorYearAgreement(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toEqual({
      kind: "update",
      table: "work_identity",
      id: "wi1",
      patch: { year: 1999 },
      reason: expect.any(String),
    });
  });

  it("reports (never overwrites) a year disagreement between an identity and its own primary resource", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [{ id: "wi1", canonicalTitle: "Sample Primary Text", authorSurname: null, year: 2001 }],
      learningResources: [{ id: "lr1", workIdentityId: "wi1", bibRecordId: null, workRole: "primary", title: "Sample Primary Text", year: 1999 }],
    };
    const mismatches = checkTitleAuthorYearAgreement(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toBeNull();
  });

  it("ignores a non-primary (review/edition) learning_resource entirely for the year backfill", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [{ id: "wi1", canonicalTitle: "T", authorSurname: null, year: null }],
      learningResources: [{ id: "lr1", workIdentityId: "wi1", bibRecordId: null, workRole: "review", title: "Review of T", year: 2005 }],
    };
    expect(checkTitleAuthorYearAgreement(snapshot)).toEqual([]);
  });
});
