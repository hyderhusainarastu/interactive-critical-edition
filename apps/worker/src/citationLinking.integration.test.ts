/**
 * Phase 20.8 gate — D-20-68 (citation-to-candidate linking).
 *
 * Two production canaries (`docs/eval` grading reports, 2026-07-22/23)
 * against the same Roochnik fixture found identical citation text resolving
 * differently run to run, and a same-run research_resource candidate never
 * getting linked to its matching citation. Traced to two separate gaps in
 * `apps/worker/src/analyze.ts`:
 *
 *   1. `resolveCitationMetadata` gave up the instant its own live
 *      Crossref/OpenAlex/OpenLibrary lookup returned nothing, never checking
 *      whether the shared, append-only `bibliographic_record` catalogue
 *      already held a confident match from an earlier resolution (the Annas
 *      1977 case: resolved once, then unresolved on identical input).
 *   2. Citation resolution is enqueued as an independent async job at
 *      citation-insert time, well before `research_resource` rows for the
 *      SAME run are written later in `analyzeEditionRun` — so a same-run
 *      discovery a citation should trivially match (the Irwin case: Google
 *      Books found it, the narrower bibliographic-only lookup never queries
 *      Google Books at all) was never even checked against.
 *
 * These tests reproduce both gaps against a real Postgres (mocking only the
 * external @ice/bibliographic lookup, per this suite's existing
 * `phase17CitationIntegrity.integration.test.ts` precedent) and verify the
 * fix: a catalogue fallback in `resolveCitationMetadata`, a same-run linking
 * pass (`linkCitationsToRunDiscoveries`), and an idempotency guard that stops
 * either path from ever downgrading an already-resolved citation.
 */
import {
  bibliographicRecords,
  citations,
  db,
  documents,
  graphEdges,
  processingRuns,
  researchResources,
  users,
  workIdentities,
  works,
} from "@ice/db";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const resolver = vi.hoisted(() => ({ resolveCitation: vi.fn() }));
vi.mock("@ice/bibliographic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ice/bibliographic")>()),
  resolveCitation: resolver.resolveCitation,
}));

import { linkCitationsToRunDiscoveries, resolveCitationMetadata } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);
// Array-tracked, not a single-slot object: the Annas-case test below seeds
// TWO users (documentA, documentB) in one test, and a single-slot
// `{ userId: "" }` tracker only ever remembers the most recent one — the
// first user's cascade rows (work/document/citation) and its own
// work_identity row (created fresh per `seedDocument` call, not shared) would
// silently leak into shared local Postgres on every run. Mirrors the
// `{ userIds: [], identityIds: [] }` precedent in
// `extraction.integration.test.ts`.
const cleanup = { userIds: [] as string[], identityIds: [] as string[] };

describe.skipIf(!hasDb)("D-20-68 — citation-to-candidate linking", () => {
  afterEach(async () => {
    resolver.resolveCitation.mockReset();
    // Cascades work/document/citation/research_resource/graph_edge rows.
    // bibliographic_record is the deliberately shared, append-only catalogue
    // (see Design Decisions) and is cleaned up explicitly per test instead.
    while (cleanup.userIds.length) await db.delete(users).where(eq(users.id, cleanup.userIds.pop()!));
    if (cleanup.identityIds.length) {
      await db.delete(workIdentities).where(inArray(workIdentities.id, cleanup.identityIds));
      cleanup.identityIds = [];
    }
  });

  async function seedDocument() {
    const [user] = await db.insert(users).values({ email: `d-20-68-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanup.userIds.push(user.id);
    const [identity] = await db.insert(workIdentities).values({
      workKey: `fixture:d-20-68:${crypto.randomUUID()}`,
      canonicalTitle: "Aristotle's Account of the Vicious",
      authorSurname: "roochnik",
      authors: ["David Roochnik"],
      evidence: "D-20-68 fixture",
    }).returning({ id: workIdentities.id });
    cleanup.identityIds.push(identity.id);
    const [work] = await db.insert(works).values({
      userId: user.id,
      workIdentityId: identity.id,
      title: "Aristotle's Account of the Vicious",
      authorName: "David Roochnik",
    }).returning({ id: works.id });
    const [document] = await db.insert(documents).values({
      userId: user.id,
      workId: work.id,
      storagePath: `fixtures/${work.id}/roochnik.txt`,
      originalFilename: "roochnik.txt",
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

  it("links a citation to a same-run research_resource candidate the live lookup never sees (Irwin case)", async () => {
    const { user, work, document, run } = await seedDocument();

    // The live bibliographic-only path (Crossref/OpenAlex/OpenLibrary) never
    // finds this — exactly as it wouldn't for a Google-Books-only match.
    resolver.resolveCitation.mockResolvedValue(null);

    const [citation] = await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      rawText: "T Irwin Aristotle's Nicomachean Ethics Indianapolis: Hackett 1999 292",
      normalizedQuery: "T Irwin Aristotle's Nicomachean Ethics Indianapolis Hackett 1999 292",
      sourceType: "footnote",
      parserConfidence: 0.9,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });

    // A same-run discovery already found the right work (e.g. via Google
    // Books) and projected it into the shared catalogue, exactly as
    // `analyzeEditionRun`'s discovery loop does before this pass runs.
    const [bibRecord] = await db.insert(bibliographicRecords).values({
      source: "googlebooks",
      title: "Aristotle's Nicomachean Ethics",
      authors: "Aristotle, Terence Irwin",
      year: 1999,
      accessStatus: "metadata_only",
    }).returning({ id: bibliographicRecords.id });
    await db.insert(researchResources).values({
      runId: run.id,
      title: "Aristotle's Nicomachean Ethics",
      provider: "googlebooks",
      resourceType: "book",
      bibRecordId: bibRecord.id,
    });

    // The citation resolution job runs first (as it does in production,
    // enqueued at insert time) and — with no catalogue/same-run fallback yet
    // reachable — correctly reports the live lookup found nothing.
    await resolveCitationMetadata(citation.id);
    const [afterLiveOnly] = await db.select().from(citations).where(eq(citations.id, citation.id));
    expect(afterLiveOnly.resolutionState).toBe("unresolved");

    // Discovery has now finished (research_resource row above exists for this
    // run); the linking pass must find and apply it.
    await linkCitationsToRunDiscoveries(document.id, run.id);

    const [linked] = await db.select().from(citations).where(eq(citations.id, citation.id));
    expect(linked.resolutionState).toBe("resolved");
    expect(linked.resolvedBibId).toBe(bibRecord.id);
    expect(linked.resolutionSource).toBe("research:googlebooks");

    const edges = await db.select().from(graphEdges).where(eq(graphEdges.sourceId, work.id));
    expect(edges).toHaveLength(1);
    expect(edges[0].targetId).toBe(bibRecord.id);
    expect(edges[0].targetType).toBe("bibliographic_record");
    expect(edges[0].edgeType).toBe("cites");
    expect(edges[0].userId).toBe(user.id);

    // Re-running the pass (idempotent on reprocess) must not duplicate the edge.
    await linkCitationsToRunDiscoveries(document.id, run.id);
    const edgesAfterRerun = await db.select().from(graphEdges).where(eq(graphEdges.sourceId, work.id));
    expect(edgesAfterRerun).toHaveLength(1);

    await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, bibRecord.id));
  });

  it("reuses an existing catalogue record when the live lookup fails on identical input (Annas 1977 case)", async () => {
    const { document: documentA, run: runA } = await seedDocument();
    const { document: documentB, run: runB } = await seedDocument();

    const rawText = "Plato and Aristotle on Love and Friendship J Annas Mind 86 1977";
    const query = "Plato and Aristotle on Love and Friendship J Annas Mind 86 1977";

    // Attempt 1: the live lookup succeeds and resolves correctly.
    resolver.resolveCitation.mockResolvedValueOnce({
      source: "crossref" as const,
      externalId: "10.1093/mind/lxxxvi.344.532",
      title: "Plato and Aristotle on Friendship and Altruism",
      authors: "JULIA ANNAS",
      year: 1977,
      doi: "10.1093/mind/lxxxvi.344.532",
      url: "https://doi.org/10.1093/mind/lxxxvi.344.532",
      accessStatus: "subscription" as const,
      raw: { fixture: true },
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
    expect(resolvedA.resolutionState).toBe("resolved");
    expect(resolvedA.resolvedBibId).toBeTruthy();

    // Attempt 2: IDENTICAL raw/normalized citation text, on a different
    // document/run (mirroring the real canary's fresh-upload-per-attempt
    // shape) — but this time the live call fails (network flakiness, or
    // Crossref's own top-1 ranking not surfacing the right hit this time).
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

    // The fix: reuse the SAME bibliographic_record the first attempt created,
    // instead of leaving an otherwise-known citation unresolved.
    expect(resolvedB.resolutionState).toBe("resolved");
    expect(resolvedB.resolvedBibId).toBe(resolvedA.resolvedBibId);
    expect(resolvedB.resolutionSource).toContain("catalog:");

    await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, resolvedA.resolvedBibId!));
  });

  it("never re-runs a live lookup or downgrades an already-resolved citation (idempotency guard)", async () => {
    const { document, run } = await seedDocument();
    resolver.resolveCitation.mockResolvedValueOnce({
      source: "crossref" as const,
      externalId: "10.9999/fixture",
      title: "A Perfectly Resolvable Fixture Title",
      authors: "Fixture Author",
      year: 2001,
      doi: "10.9999/fixture",
      url: "https://doi.org/10.9999/fixture",
      accessStatus: "subscription" as const,
      raw: {},
    });
    const [citation] = await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      rawText: "A Perfectly Resolvable Fixture Title, Fixture Author, 2001",
      normalizedQuery: "A Perfectly Resolvable Fixture Title Fixture Author 2001",
      sourceType: "bibliography",
      parserConfidence: 0.9,
      resolutionState: "pending",
      resolutionSource: "unresolved",
    }).returning({ id: citations.id });

    await resolveCitationMetadata(citation.id);
    const [first] = await db.select().from(citations).where(eq(citations.id, citation.id));
    expect(first.resolutionState).toBe("resolved");
    expect(resolver.resolveCitation).toHaveBeenCalledTimes(1);

    // A retried/duplicate job call (e.g. a pg-boss retry) on the SAME
    // already-resolved citation: even if the live lookup would now fail, the
    // guard must skip calling it at all and must never regress the citation.
    resolver.resolveCitation.mockResolvedValueOnce(null);
    await resolveCitationMetadata(citation.id);
    const [second] = await db.select().from(citations).where(eq(citations.id, citation.id));
    expect(second.resolutionState).toBe("resolved");
    expect(second.resolvedBibId).toBe(first.resolvedBibId);
    expect(resolver.resolveCitation).toHaveBeenCalledTimes(1); // not called again

    await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, first.resolvedBibId!));
  });
});
