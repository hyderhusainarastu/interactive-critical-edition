/**
 * Floors-capability-proposal §2.3 — the citation-resolution → research_resource
 * bridge. `resolveCitationMetadata`'s live lookup and catalogue-match reuse
 * both resolve a citation without ever writing a `research_resource` row —
 * the ONLY table the direct-source-floor gate counts. These tests verify the
 * bridge against a real Postgres (mocking only the external
 * @ice/bibliographic lookup, same precedent as
 * `citationLinking.integration.test.ts`), and that the OTHER resolution
 * pathway (`linkCitationsToRunDiscoveries`, whose match already comes from an
 * existing same-run `research_resource` row) is deliberately NOT bridged
 * again.
 */
import {
  bibliographicRecords,
  citations,
  db,
  documents,
  processingRuns,
  researchResources,
  users,
  workIdentities,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const resolver = vi.hoisted(() => ({ resolveCitation: vi.fn() }));
vi.mock("@ice/bibliographic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ice/bibliographic")>()),
  resolveCitation: resolver.resolveCitation,
}));

import { linkCitationsToRunDiscoveries, resolveCitationMetadata } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);
const cleanup = { userIds: [] as string[], identityIds: [] as string[], bibIds: [] as string[] };

describe.skipIf(!hasDb)("floors §2.3 — citation-resolution → research_resource bridge", () => {
  afterEach(async () => {
    resolver.resolveCitation.mockReset();
    while (cleanup.userIds.length) await db.delete(users).where(eq(users.id, cleanup.userIds.pop()!));
    if (cleanup.identityIds.length) {
      await db.delete(workIdentities).where(eq(workIdentities.id, cleanup.identityIds.pop()!));
    }
    if (cleanup.bibIds.length) {
      for (const id of cleanup.bibIds.splice(0)) await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, id));
    }
  });

  async function seedDocument() {
    const [user] = await db.insert(users).values({ email: `floors-2-3-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanup.userIds.push(user.id);
    const [identity] = await db.insert(workIdentities).values({
      workKey: `fixture:floors-2-3:${crypto.randomUUID()}`,
      canonicalTitle: "A Bridge Fixture Work",
      authorSurname: "fixture",
      authors: ["Fixture Author"],
      evidence: "floors §2.3 fixture",
    }).returning({ id: workIdentities.id });
    cleanup.identityIds.push(identity.id);
    const [work] = await db.insert(works).values({
      userId: user.id,
      workIdentityId: identity.id,
      title: "A Bridge Fixture Work",
      authorName: "Fixture Author",
    }).returning({ id: works.id });
    const [document] = await db.insert(documents).values({
      userId: user.id,
      workId: work.id,
      storagePath: `fixtures/${work.id}/bridge.txt`,
      originalFilename: "bridge.txt",
      mimeType: "text/plain",
      fileSize: 10,
      processingStatus: "ready",
      extractedText: "fixture body text",
    }).returning({ id: documents.id });
    const [run] = await db.insert(processingRuns).values({
      documentId: document.id,
      version: 1,
      pipelineVersion: "v3",
    }).returning({ id: processingRuns.id });
    return { user, identity, work, document, run };
  }

  it("bridges a live-lookup resolution into research_resource with honest, non-fabricated provenance", async () => {
    const { document, run } = await seedDocument();
    resolver.resolveCitation.mockResolvedValueOnce({
      source: "crossref" as const,
      externalId: "10.1234/bridge-fixture",
      title: "The Bridged Secondary Source",
      authors: "A Real Author",
      year: 1991,
      doi: "10.1234/bridge-fixture",
      url: "https://doi.org/10.1234/bridge-fixture",
      accessStatus: "subscription" as const,
      raw: {},
    });
    const [citation] = await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      rawText: "A Real Author, The Bridged Secondary Source, 1991.",
      normalizedQuery: "A Real Author The Bridged Secondary Source 1991",
      sourceType: "footnote",
      parserConfidence: 0.9,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });

    await resolveCitationMetadata(citation.id);

    const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));
    expect(resolved.resolutionState).toBe("resolved");
    cleanup.bibIds.push(resolved.resolvedBibId!);

    const bridged = await db.select().from(researchResources).where(eq(researchResources.runId, run.id));
    expect(bridged).toHaveLength(1);
    expect(bridged[0].title).toBe("The Bridged Secondary Source");
    expect(bridged[0].bibRecordId).toBe(resolved.resolvedBibId);
    // Visibly citation-grounded, never a bare provider name.
    expect(bridged[0].provider).toBe("citation-resolution:crossref");
    expect(bridged[0].accessStatus).toBe("metadata_only");
    expect(bridged[0].doi).toBe("10.1234/bridge-fixture");
  });

  it("does not bridge a bare inline mention", async () => {
    const { document, run } = await seedDocument();
    resolver.resolveCitation.mockResolvedValueOnce({
      source: "crossref" as const,
      externalId: "10.1234/inline-fixture",
      title: "An Inline-Only Mention",
      authors: "Someone",
      year: 2000,
      doi: "10.1234/inline-fixture",
      url: null,
      accessStatus: "subscription" as const,
      raw: {},
    });
    const [citation] = await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      rawText: "as Someone (2000) notes",
      normalizedQuery: "Someone 2000",
      sourceType: "inline",
      parserConfidence: 0.7,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });

    await resolveCitationMetadata(citation.id);
    const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));
    expect(resolved.resolutionState).toBe("resolved");
    cleanup.bibIds.push(resolved.resolvedBibId!);

    const bridged = await db.select().from(researchResources).where(eq(researchResources.runId, run.id));
    expect(bridged).toHaveLength(0);
  });

  it("does not create a duplicate row when this run's own discovery already inserted the identical resource (race-safe)", async () => {
    const { document, run } = await seedDocument();
    resolver.resolveCitation.mockResolvedValueOnce({
      source: "crossref" as const,
      externalId: "10.5555/already-discovered",
      title: "Already Discovered By This Run",
      authors: "Someone Else",
      year: 1985,
      doi: "10.5555/already-discovered",
      url: "https://doi.org/10.5555/already-discovered",
      accessStatus: "subscription" as const,
      raw: {},
    });
    // Simulate the run's own discovery/acceptance loop having ALREADY
    // written a research_resource row for this exact DOI before the async
    // resolve-citation job gets to it.
    await db.insert(researchResources).values({
      runId: run.id,
      title: "Already Discovered By This Run",
      provider: "crossref",
      resourceType: "article",
      doi: "10.5555/already-discovered",
      normalizedKey: "doi:10.5555/already-discovered",
    });

    const [citation] = await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      rawText: "Someone Else, Already Discovered By This Run, 1985.",
      normalizedQuery: "Someone Else Already Discovered By This Run 1985",
      sourceType: "footnote",
      parserConfidence: 0.9,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });

    await resolveCitationMetadata(citation.id);
    const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));
    expect(resolved.resolutionState).toBe("resolved");
    cleanup.bibIds.push(resolved.resolvedBibId!);

    // Still exactly one research_resource row for this run+key — the bridge
    // insert conflicted harmlessly against the pre-existing discovery row
    // rather than duplicating it or throwing.
    const rows = await db.select().from(researchResources).where(eq(researchResources.runId, run.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("crossref"); // the ORIGINAL discovery row, untouched
  });

  it("does NOT bridge a resolution that comes from linkCitationsToRunDiscoveries (already-in-run reuse, no coverage gain)", async () => {
    const { document, work, run } = await seedDocument();
    const [bibRecord] = await db.insert(bibliographicRecords).values({
      source: "googlebooks",
      title: "A Same-Run Discovered Work",
      authors: "Fixture Author",
      year: 1999,
      accessStatus: "metadata_only",
    }).returning({ id: bibliographicRecords.id });
    cleanup.bibIds.push(bibRecord.id);
    await db.insert(researchResources).values({
      runId: run.id,
      title: "A Same-Run Discovered Work",
      provider: "googlebooks",
      resourceType: "book",
      bibRecordId: bibRecord.id,
    });

    resolver.resolveCitation.mockResolvedValueOnce(null); // live lookup never sees it
    const [citation] = await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      rawText: "Fixture Author, A Same-Run Discovered Work, 1999.",
      normalizedQuery: "Fixture Author A Same-Run Discovered Work 1999",
      sourceType: "footnote",
      parserConfidence: 0.9,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });

    await resolveCitationMetadata(citation.id); // leaves it unresolved (no bridge fires)
    await linkCitationsToRunDiscoveries(document.id, run.id); // resolves via same-run reuse

    const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));
    expect(resolved.resolutionState).toBe("resolved");
    expect(resolved.resolutionSource).toBe("research:googlebooks");

    // Exactly the ONE research_resource row that already existed — the
    // linking pass must not have bridged a second one for the same match.
    const rows = await db.select().from(researchResources).where(eq(researchResources.runId, run.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBeTruthy();
    expect(rows[0].provider).toBe("googlebooks");
    // Sanity: the fixture actually has a work (unused directly, but confirms
    // the seeded graph edge target exists for this run).
    expect(work.id).toBeTruthy();
  });

  it("bridges a catalogue-match reuse (Annas-1977-style) with catalog: provenance preserved", async () => {
    const { document: documentA, run: runA } = await seedDocument();
    const { document: documentB, run: runB } = await seedDocument();
    // The query's own top significant words must literally appear in the
    // resolved title, matching `findCatalogMatchForQuery`'s ILIKE pre-filter
    // — exactly the shape a real citation query/title pair has.
    const rawText = "A Catalogue-Reused Work, Mind 86 (1988).";
    const query = "A Catalogue-Reused Work Mind 86 1988";

    resolver.resolveCitation.mockResolvedValueOnce({
      source: "crossref" as const,
      externalId: "10.7777/catalog-reuse",
      title: "A Catalogue-Reused Work",
      authors: "A Real Author",
      year: 1988,
      doi: "10.7777/catalog-reuse",
      url: "https://doi.org/10.7777/catalog-reuse",
      accessStatus: "subscription" as const,
      raw: {},
    });
    const [citationA] = await db.insert(citations).values({
      documentId: documentA.id,
      processingRunId: runA.id,
      rawText,
      normalizedQuery: query,
      sourceType: "footnote",
      parserConfidence: 0.9,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });
    await resolveCitationMetadata(citationA.id);
    const [resolvedA] = await db.select().from(citations).where(eq(citations.id, citationA.id));
    cleanup.bibIds.push(resolvedA.resolvedBibId!);

    // Second document, second run: identical text, but the live lookup fails
    // this time — must fall back to the catalogue match created above.
    resolver.resolveCitation.mockResolvedValueOnce(null);
    const [citationB] = await db.insert(citations).values({
      documentId: documentB.id,
      processingRunId: runB.id,
      rawText,
      normalizedQuery: query,
      sourceType: "footnote",
      parserConfidence: 0.9,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });
    await resolveCitationMetadata(citationB.id);
    const [resolvedB] = await db.select().from(citations).where(eq(citations.id, citationB.id));
    expect(resolvedB.resolutionState).toBe("resolved");
    expect(resolvedB.resolutionSource).toContain("catalog:");

    const bridgedB = await db.select().from(researchResources).where(eq(researchResources.runId, runB.id));
    expect(bridgedB).toHaveLength(1);
    expect(bridgedB[0].provider).toBe(`citation-resolution:${resolvedB.resolutionSource}`);
    expect(bridgedB[0].bibRecordId).toBe(resolvedA.resolvedBibId);
  });

  it("leaves credibility unset for a bridged row — no fabricated authority/score signal", async () => {
    const { document, run } = await seedDocument();
    resolver.resolveCitation.mockResolvedValueOnce({
      source: "openalex" as const,
      externalId: "W123",
      title: "A Bridged Row With No Credibility Assessment",
      authors: "Nobody In Particular",
      year: 2005,
      doi: null,
      url: null,
      accessStatus: "metadata_only" as const,
      raw: {},
    });
    const [citation] = await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      rawText: "Nobody In Particular, A Bridged Row With No Credibility Assessment, 2005.",
      normalizedQuery: "Nobody In Particular A Bridged Row With No Credibility Assessment 2005",
      sourceType: "endnote",
      parserConfidence: 0.9,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });

    await resolveCitationMetadata(citation.id);
    const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));
    cleanup.bibIds.push(resolved.resolvedBibId!);

    const bridged = await db.select().from(researchResources).where(eq(researchResources.runId, run.id));
    expect(bridged).toHaveLength(1);
    // No credibility_assessment row was written for this resource — the
    // Library/graph LEFT JOIN against this table, so an absent row renders
    // as an honest null authority/score rather than a guessed one.
    const { credibilityAssessments } = await import("@ice/db");
    const assessments = await db.select().from(credibilityAssessments).where(eq(credibilityAssessments.resourceId, bridged[0].id));
    expect(assessments).toHaveLength(0);
  });
});
