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

// D-23-7: the shared, append-only `bibliographic_record` catalogue is
// exactly where earlier measurement/canary runs can leave behind rows
// sharing these titles (this suite's own "Annas 1977 case" test included,
// if it fails before its own trailing cleanup line runs) — the defect this
// purge supports was explicitly reproduced from that catalogue pollution.
// Deleting rows matching ONLY these literal, test-owned titles (never a
// broader sweep) before a test that's about to insert one of them keeps
// `bestOverlapMatch`'s tie-break deterministic without touching any row
// this suite didn't create.
const FIXTURE_TITLES = [
  "Plato and Aristotle on Friendship and Altruism",
  "Love and Friendship in Plato and Aristotle",
];
async function purgeFixtureTitles() {
  await db.delete(bibliographicRecords).where(inArray(bibliographicRecords.title, FIXTURE_TITLES));
}

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
    // D-23-7 determinism fix: this test's own catalogue insert below can
    // collide with a leftover row of the SAME title from an earlier failed
    // run (or from the sibling D-23-7 tests, which use the same real-world
    // title) — see `purgeFixtureTitles`'s doc comment. Purging first makes
    // this test's own two-attempt comparison depend only on the row it just
    // created, not on whatever the catalogue happened to already contain.
    await purgeFixtureTitles();
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

  /**
   * D-23-7 — floors attempt 4 (2026-07-23, local v3 run): the garbled OCR
   * citation "J Annas ... Mind 86 1977" resolved to A. W. Price's unrelated
   * 1990 book "Love and Friendship in Plato and Aristotle", not the true
   * Annas 1977 record, even though the true record existed as a candidate.
   * Root cause: `titleOverlap` scores Price's title HIGHER (4/7 = 0.5714)
   * than the true Annas title (3/7 = 0.4286) against this exact garbled
   * query — both clear `CATALOG_MATCH_THRESHOLD` (0.34), and the old
   * `bestOverlapMatch` picked the higher score with no regard for whether
   * the candidate's own year actually agrees with the citation. (An author-
   * surname veto was tried and reverted — see `analyze.ts`'s doc comment on
   * `yearConflictsWithQuery` — because it false-positived on citation queries
   * with no author name in them at all, e.g. the catalogue-reuse test in
   * `citationBridge.integration.test.ts`. Year alone disambiguates this case.)
   */
  describe("D-23-7 — wrong-work link vetoed by year disagreement", () => {
    const rawText = "Plato and Aristotle on Love and Friendship J Annas Mind 86 1977";
    const query = rawText;
    // FIXTURE_TITLES/purgeFixtureTitles are defined once at file scope (used
    // by both this block and the pre-existing "Annas 1977 case" test above).

    async function seedWrongPriceRecord() {
      const [wrong] = await db
        .insert(bibliographicRecords)
        .values({
          source: "crossref",
          title: "Love and Friendship in Plato and Aristotle",
          authors: "A. W. Price",
          year: 1990,
          accessStatus: "subscription",
        })
        .returning({ id: bibliographicRecords.id });
      return wrong;
    }

    async function seedTrueAnnasRecord() {
      const [truth] = await db
        .insert(bibliographicRecords)
        .values({
          source: "crossref",
          title: "Plato and Aristotle on Friendship and Altruism",
          authors: "JULIA ANNAS",
          year: 1977,
          doi: "10.1093/mind/lxxxvi.344.532",
          accessStatus: "subscription",
        })
        .returning({ id: bibliographicRecords.id });
      return truth;
    }

    it("REPRODUCES the mismatch on the old score-only ranking (documents the defect, does not exercise fixed code)", () => {
      // This is the exact computation `bestOverlapMatch` used to perform with
      // no corroboration guard — kept as a plain arithmetic assertion (no DB,
      // no imports from the fixed module) so it stays true to what the OLD
      // code actually did, rather than re-deriving it through code that has
      // since been patched.
      const sig = (s: string) =>
        new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3));
      const overlap = (q: string, title: string) => {
        const qs = sig(q);
        const ts = sig(title);
        let hits = 0;
        for (const w of qs) if (ts.has(w)) hits++;
        return hits / qs.size;
      };
      const trueScore = overlap(query, "Plato and Aristotle on Friendship and Altruism");
      const wrongScore = overlap(query, "Love and Friendship in Plato and Aristotle");
      expect(trueScore).toBeCloseTo(3 / 7, 5);
      expect(wrongScore).toBeCloseTo(4 / 7, 5);
      // The defect: the WRONG candidate scores higher, so a score-only
      // "highest wins" ranking picks it over the true record.
      expect(wrongScore).toBeGreaterThan(trueScore);
    });

    it("links to the TRUE Annas record via the catalogue fallback, not the higher-scoring wrong Price record", async () => {
      await purgeFixtureTitles();
      const { document, run } = await seedDocument();
      const wrong = await seedWrongPriceRecord();
      const truth = await seedTrueAnnasRecord();

      resolver.resolveCitation.mockResolvedValueOnce(null); // forces the catalogue fallback
      const [citation] = await db
        .insert(citations)
        .values({
          documentId: document.id,
          processingRunId: run.id,
          rawText,
          normalizedQuery: query,
          sourceType: "footnote",
          parserConfidence: 0.9,
          resolutionState: "pending",
          resolutionSource: "unresolved",
        })
        .returning({ id: citations.id });

      await resolveCitationMetadata(citation.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));

      expect(resolved.resolutionState).toBe("resolved");
      expect(resolved.resolvedBibId).toBe(truth.id);
      expect(resolved.resolvedBibId).not.toBe(wrong.id);

      await db.delete(bibliographicRecords).where(inArray(bibliographicRecords.id, [wrong.id, truth.id]));
    });

    it("stays UNRESOLVED when only the wrong-year candidate exists in the catalogue", async () => {
      await purgeFixtureTitles();
      const { document, run } = await seedDocument();
      const wrong = await seedWrongPriceRecord();

      resolver.resolveCitation.mockResolvedValueOnce(null);
      const [citation] = await db
        .insert(citations)
        .values({
          documentId: document.id,
          processingRunId: run.id,
          rawText,
          normalizedQuery: query,
          sourceType: "footnote",
          parserConfidence: 0.9,
          resolutionState: "pending",
          resolutionSource: "unresolved",
        })
        .returning({ id: citations.id });

      await resolveCitationMetadata(citation.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));

      // Wrong-work is worse than unresolved: with no true candidate available,
      // the year-disagreeing Price record must be vetoed outright, not
      // accepted as "the best we've got".
      expect(resolved.resolutionState).toBe("unresolved");
      expect(resolved.resolvedBibId).toBeNull();

      await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, wrong.id));
    });

    it("same-run discovery variant: links to the TRUE same-run research_resource, not a co-candidate wrong-year record", async () => {
      await purgeFixtureTitles();
      const { document, run, work, user } = await seedDocument();
      const wrong = await seedWrongPriceRecord();
      const truth = await seedTrueAnnasRecord();

      // Both candidates were independently discovered in THIS SAME run —
      // exactly the shape the floors-attempt-4 defect described.
      await db.insert(researchResources).values([
        {
          runId: run.id,
          title: "Love and Friendship in Plato and Aristotle",
          provider: "openalex",
          resourceType: "book",
          year: 1990,
          authors: ["A. W. Price"],
          bibRecordId: wrong.id,
        },
        {
          runId: run.id,
          title: "Plato and Aristotle on Friendship and Altruism",
          provider: "crossref",
          resourceType: "article",
          year: 1977,
          authors: ["Julia Annas"],
          bibRecordId: truth.id,
        },
      ]);

      const [citation] = await db
        .insert(citations)
        .values({
          documentId: document.id,
          processingRunId: run.id,
          rawText,
          normalizedQuery: query,
          sourceType: "footnote",
          parserConfidence: 0.9,
          resolutionState: "pending",
          resolutionSource: "unresolved",
        })
        .returning({ id: citations.id });

      await linkCitationsToRunDiscoveries(document.id, run.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));

      expect(resolved.resolutionState).toBe("resolved");
      expect(resolved.resolvedBibId).toBe(truth.id);
      expect(resolved.resolvedBibId).not.toBe(wrong.id);

      const edges = await db.select().from(graphEdges).where(eq(graphEdges.sourceId, work.id));
      expect(edges).toHaveLength(1);
      expect(edges[0].targetId).toBe(truth.id);
      void user;

      await db.delete(bibliographicRecords).where(inArray(bibliographicRecords.id, [wrong.id, truth.id]));
    });

    // These two use `linkCitationsToRunDiscoveries` rather than the catalogue
    // fallback: `findCatalogMatchForQuery`'s coarse SQL pre-filter picks its
    // top-3 "significant words" from the whole query including the author
    // surname (e.g. "bostock", "bywater" — both 7+ chars, easily outranking a
    // 6-char title word like "ethics"), then ANDs all three against the
    // `title` column alone — a surname pre-filter word that never appears in
    // a title always empties the SQL result before `bestOverlapMatch` (my
    // fix's own site) is ever reached. That is a real, separate, PRE-EXISTING
    // gap in the prefilter (not something this fix introduces or repairs —
    // see the reported root-cause writeup), so exercising it here would
    // conflate "the prefilter found nothing" with "the new guard rejected a
    // true positive". `linkCitationsToRunDiscoveries` has no such SQL
    // prefilter — its candidates are the run's own already-fetched
    // `research_resource` rows — so it cleanly isolates exactly the
    // `bestOverlapMatch`/`disagreesWithQuery` logic this fix changed.
    it("regression: true-positive Bostock 2000 same-run link still resolves (year agrees)", async () => {
      const { document, run, work } = await seedDocument();
      const [bostock] = await db
        .insert(bibliographicRecords)
        .values({
          source: "openlibrary",
          title: "Aristotle's Ethics",
          authors: "David Bostock",
          year: 2000,
          accessStatus: "metadata_only",
        })
        .returning({ id: bibliographicRecords.id });
      await db.insert(researchResources).values({
        runId: run.id,
        title: "Aristotle's Ethics",
        provider: "openlibrary",
        resourceType: "book",
        year: 2000,
        authors: ["David Bostock"],
        bibRecordId: bostock.id,
      });

      const [citation] = await db
        .insert(citations)
        .values({
          documentId: document.id,
          processingRunId: run.id,
          rawText: "Bostock, David. Aristotle's Ethics. Oxford: Oxford University Press, 2000.",
          normalizedQuery: "Bostock, David, Aristotle's Ethics 2000",
          sourceType: "bibliography",
          parserConfidence: 0.9,
          resolutionState: "pending",
          resolutionSource: "unresolved",
        })
        .returning({ id: citations.id });

      await linkCitationsToRunDiscoveries(document.id, run.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));
      expect(resolved.resolutionState).toBe("resolved");
      expect(resolved.resolvedBibId).toBe(bostock.id);
      const edges = await db.select().from(graphEdges).where(eq(graphEdges.sourceId, work.id));
      expect(edges).toHaveLength(1);

      await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, bostock.id));
    });

    it("regression: true-positive Bywater 1894 same-run link still resolves (year agrees)", async () => {
      const { document, run, work } = await seedDocument();
      const [bywater] = await db
        .insert(bibliographicRecords)
        .values({
          source: "googlebooks",
          title: "Aristotelis Ethica Nicomachea",
          authors: "Ingram Bywater",
          year: 1894,
          accessStatus: "metadata_only",
        })
        .returning({ id: bibliographicRecords.id });
      await db.insert(researchResources).values({
        runId: run.id,
        title: "Aristotelis Ethica Nicomachea",
        provider: "googlebooks",
        resourceType: "book",
        year: 1894,
        authors: ["Ingram Bywater"],
        bibRecordId: bywater.id,
      });

      const [citation] = await db
        .insert(citations)
        .values({
          documentId: document.id,
          processingRunId: run.id,
          rawText: "Bywater, Ingram, ed., Aristotelis Ethica Nicomachea, Clarendon Press, 1894",
          normalizedQuery: "Bywater, Ingram, ed., Aristotelis Ethica Nicomachea 1894",
          sourceType: "bibliography",
          parserConfidence: 0.9,
          resolutionState: "pending",
          resolutionSource: "unresolved",
        })
        .returning({ id: citations.id });

      await linkCitationsToRunDiscoveries(document.id, run.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));
      expect(resolved.resolutionState).toBe("resolved");
      expect(resolved.resolvedBibId).toBe(bywater.id);
      const edges = await db.select().from(graphEdges).where(eq(graphEdges.sourceId, work.id));
      expect(edges).toHaveLength(1);

      await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, bywater.id));
    });
  });

  /**
   * D-23-19 — floors attempt 4/5, the WRONG-WORK-LINK CLASS. The D-23-7 tests
   * above all mock `resolveCitation` to return `null`, so they only ever
   * exercise the catalogue-fallback / same-run-discovery paths, where the
   * year veto (`bestOverlapMatch`) lives. But the production mis-links came
   * through the OTHER path: `resolveCitationMetadata` accepted a LIVE provider
   * hit (Crossref's own top-N pick, via @ice/bibliographic's `bestTitleMatch`,
   * gated ONLY by `titleOverlap >= 0.34`) with NO year/review corroboration at
   * all. That is how "…J Annas … Mind 86 1977" resolved to A. W. Price's 1990
   * "Love and Friendship in Plato and Aristotle", and how citations to works
   * resolved to REVIEW notices of those works ("… Pp. 374 … Cloth, $8.95.",
   * "Book Reviews … (cloth)"). These tests reproduce the live-path bypass and
   * verify the guards now applied there.
   */
  describe("D-23-19 — live-lookup wrong-work / review link vetoed", () => {
    const rawText = "Plato and Aristotle on Love and Friendship J Annas Mind 86 1977";
    const query = rawText;

    async function seedCitation(document: { id: string }, run: { id: string }) {
      const [citation] = await db
        .insert(citations)
        .values({
          documentId: document.id,
          processingRunId: run.id,
          rawText,
          normalizedQuery: query,
          sourceType: "footnote",
          parserConfidence: 0.9,
          resolutionState: "pending",
          resolutionSource: "unresolved",
        })
        .returning({ id: citations.id });
      return citation;
    }

    it("REJECTS a live provider hit whose year contradicts the citation year (the exact production bypass)", async () => {
      // The live lookup returns A. W. Price's 1990 book — precisely what
      // Crossref's own top-N ranking surfaced for this garbled 1977 query. No
      // catalogue record is seeded, so a correctly-vetoed live hit leaves the
      // citation honestly unresolved rather than mis-linked.
      await purgeFixtureTitles();
      const { document, run } = await seedDocument();
      resolver.resolveCitation.mockResolvedValueOnce({
        source: "crossref" as const,
        externalId: "10.1017/s0031819100037517",
        title: "Love and Friendship in Plato and Aristotle",
        authors: "A. W. Price",
        year: 1990,
        doi: "10.1017/s0031819100037517",
        url: "https://doi.org/10.1017/s0031819100037517",
        accessStatus: "subscription" as const,
        raw: {},
      });
      const citation = await seedCitation(document, run);

      await resolveCitationMetadata(citation.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));

      // A wrong-work link is strictly worse than unresolved (anti-hallucination).
      expect(resolved.resolutionState).toBe("unresolved");
      expect(resolved.resolvedBibId).toBeNull();
      await purgeFixtureTitles();
    });

    it("REJECTS a live provider hit that is a REVIEW notice of the work, even when its year agrees", async () => {
      // Same year (1977) as the citation, so the year veto cannot fire — this
      // isolates the review-notice guard. A citation to a WORK must never link
      // to a published review OF that work.
      await purgeFixtureTitles();
      const { document, run } = await seedDocument();
      resolver.resolveCitation.mockResolvedValueOnce({
        source: "crossref" as const,
        externalId: "10.9999/review",
        title: "Love and Friendship in Plato and Aristotle (review)",
        authors: "John Bussanich",
        year: 1977,
        doi: "10.9999/review",
        url: "https://doi.org/10.9999/review",
        accessStatus: "subscription" as const,
        raw: {},
      });
      const citation = await seedCitation(document, run);

      await resolveCitationMetadata(citation.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));

      expect(resolved.resolutionState).toBe("unresolved");
      expect(resolved.resolvedBibId).toBeNull();
      await purgeFixtureTitles();
    });

    it("rejects the wrong-year live hit AND recovers the TRUE record from the catalogue fallback", async () => {
      // The realistic end-to-end shape: the live lookup returns the wrong
      // (year-conflicting) Price book, but the true Annas 1977 record already
      // sits in the shared catalogue. The live hit is vetoed, then the
      // catalogue fallback links the correct record.
      await purgeFixtureTitles();
      const { document, run } = await seedDocument();
      const [wrong] = await db
        .insert(bibliographicRecords)
        .values({ source: "crossref", title: "Love and Friendship in Plato and Aristotle", authors: "A. W. Price", year: 1990, accessStatus: "subscription" })
        .returning({ id: bibliographicRecords.id });
      const [truth] = await db
        .insert(bibliographicRecords)
        .values({ source: "crossref", title: "Plato and Aristotle on Friendship and Altruism", authors: "JULIA ANNAS", year: 1977, doi: "10.1093/mind/lxxxvi.344.532", accessStatus: "subscription" })
        .returning({ id: bibliographicRecords.id });

      resolver.resolveCitation.mockResolvedValueOnce({
        source: "crossref" as const,
        externalId: "10.1017/s0031819100037517",
        title: "Love and Friendship in Plato and Aristotle",
        authors: "A. W. Price",
        year: 1990,
        doi: "10.1017/s0031819100037517",
        url: "https://doi.org/10.1017/s0031819100037517",
        accessStatus: "subscription" as const,
        raw: {},
      });
      const citation = await seedCitation(document, run);

      await resolveCitationMetadata(citation.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));

      expect(resolved.resolutionState).toBe("resolved");
      expect(resolved.resolvedBibId).toBe(truth.id);
      expect(resolved.resolvedBibId).not.toBe(wrong.id);

      await db.delete(bibliographicRecords).where(inArray(bibliographicRecords.id, [wrong.id, truth.id]));
      await purgeFixtureTitles();
    });

    it("regression: a clean live hit (year agrees, not a review) still resolves normally", async () => {
      await purgeFixtureTitles();
      const { document, run } = await seedDocument();
      resolver.resolveCitation.mockResolvedValueOnce({
        source: "crossref" as const,
        externalId: "10.1093/mind/lxxxvi.344.532",
        title: "Plato and Aristotle on Friendship and Altruism",
        authors: "JULIA ANNAS",
        year: 1977,
        doi: "10.1093/mind/lxxxvi.344.532",
        url: "https://doi.org/10.1093/mind/lxxxvi.344.532",
        accessStatus: "subscription" as const,
        raw: {},
      });
      const citation = await seedCitation(document, run);

      await resolveCitationMetadata(citation.id);
      const [resolved] = await db.select().from(citations).where(eq(citations.id, citation.id));

      expect(resolved.resolutionState).toBe("resolved");
      expect(resolved.resolvedBibId).toBeTruthy();
      await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, resolved.resolvedBibId!));
      await purgeFixtureTitles();
    });
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
