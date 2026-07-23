/**
 * D-23-3 — confirm-triggered legacy analyze-work must never wipe an edition
 * pipeline's run-scoped citation set.
 *
 * Discovered during the 2026-07-23 local floors measurement
 * (`.../floors4-evidence/09-ANOMALY-citation-wipe.md`): on a v2/v3/v4 edition
 * document, POST /confirm unconditionally enqueued analyze-work, and the
 * QUEUE_ANALYZE_WORK handler called the LEGACY `analyzeWork()`
 * unconditionally. `analyzeWork()` then ran
 * `db.delete(citations).where(documentId = …)` and re-extracted with the OLD
 * heuristic (no processing_run_id), silently destroying the 18–21 rich,
 * run-scoped, provider-resolved citations `analyzeEditionRun` had written
 * minutes earlier — replacing them with a single un-scoped junk row.
 *
 * The fix is a data-driven, version-independent guard (it never reads
 * ANALYSIS_PIPELINE, so it survives web/worker env divergence): the presence
 * of a `processing_run` for the document means the edition pipeline owns its
 * analysis, so legacy `analyzeWork()` no-ops and leaves the citation set
 * intact. A true v1 document has no run and still gets legacy analysis.
 *
 * These tests exercise the guard against a real Postgres, mocking only the
 * external @ice/bibliographic lookup (per this suite's existing
 * `citationLinking.integration.test.ts` / `phase17CitationIntegrity` precedent).
 * Red-then-green: with the guard removed, the first test fails — its fixture
 * prose is citation-free, so the legacy delete-and-re-extract leaves the
 * citation set wiped to zero rows rather than the three seeded run-scoped
 * ones; with the guard in place, the run-scoped set survives untouched.
 */
import {
  citations,
  db,
  documents,
  processingRuns,
  users,
  workIdentities,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

// The v1 path can, in principle, reach a live bibliographic lookup. We seed
// citation-free prose so `extractCitations` yields zero candidates and that
// path is never taken, but mocking to null keeps the test hermetic regardless.
const resolver = vi.hoisted(() => ({ resolveCitation: vi.fn().mockResolvedValue(null) }));
vi.mock("@ice/bibliographic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ice/bibliographic")>()),
  resolveCitation: resolver.resolveCitation,
}));

import { analyzeWork } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);
const cleanup = { userIds: [] as string[], identityIds: [] as string[] };

describe.skipIf(!hasDb)("D-23-3 — confirm/analyze must not wipe run-scoped citations", () => {
  afterEach(async () => {
    resolver.resolveCitation.mockClear();
    // Cascades work/document/citation/processing_run/graph_edge rows.
    while (cleanup.userIds.length) await db.delete(users).where(eq(users.id, cleanup.userIds.pop()!));
    while (cleanup.identityIds.length) await db.delete(workIdentities).where(eq(workIdentities.id, cleanup.identityIds.pop()!));
  });

  async function seedDocument(opts: { extractedText: string }) {
    const [user] = await db.insert(users).values({ email: `d-23-3-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanup.userIds.push(user.id);
    const [identity] = await db.insert(workIdentities).values({
      workKey: `fixture:d-23-3:${crypto.randomUUID()}`,
      canonicalTitle: "Aristotle's Account of the Vicious",
      authorSurname: "roochnik",
      authors: ["David Roochnik"],
      evidence: "D-23-3 fixture",
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
      extractedText: opts.extractedText,
    }).returning({ id: documents.id });
    return { user, identity, work, document };
  }

  it("leaves an edition pipeline's run-scoped citations intact (the wipe reproduction)", async () => {
    const { document } = await seedDocument({ extractedText: "fixture body text" });

    // An edition run and its own run-scoped, provider-resolved citation set,
    // exactly as handleEditionExtraction → analyzeEditionRun writes them.
    const [run] = await db.insert(processingRuns).values({
      documentId: document.id,
      version: 1,
      pipelineVersion: "v3",
      status: "complete",
      structureState: "full",
      isPublished: true,
    }).returning({ id: processingRuns.id });

    const seeded = await db.insert(citations).values(
      [
        { rawText: "T Irwin, Aristotle's Nicomachean Ethics, Hackett 1999", source: "footnote" as const, resolved: "resolved" as const },
        { rawText: "J Annas, Plato and Aristotle on Friendship, Mind 1977", source: "footnote" as const, resolved: "resolved" as const },
        { rawText: "D Bostock, Aristotle's Ethics, OUP 2000", source: "bibliography" as const, resolved: "unresolved" as const },
      ].map((c, i) => ({
        documentId: document.id,
        processingRunId: run.id,
        rawText: c.rawText,
        normalizedQuery: c.rawText.toLowerCase(),
        sourceType: c.source,
        parserConfidence: 0.9,
        resolutionState: c.resolved,
        resolutionSource: c.resolved === "resolved" ? "research:googlebooks" : "unresolved",
      })),
    ).returning({ id: citations.id });
    expect(seeded).toHaveLength(3);

    // The exact call the QUEUE_ANALYZE_WORK handler makes when a stale/confirm
    // job is dequeued for this edition document.
    await analyzeWork(document.id);

    const after = await db.select().from(citations).where(eq(citations.documentId, document.id));
    // Every run-scoped citation survives, unchanged and still run-scoped.
    expect(after).toHaveLength(3);
    expect(after.every((c) => c.processingRunId === run.id)).toBe(true);
    expect(new Set(after.map((c) => c.id))).toEqual(new Set(seeded.map((c) => c.id)));

    // The legacy delete/re-extract never ran (no external lookup attempted).
    expect(resolver.resolveCitation).not.toHaveBeenCalled();

    // The document is recorded as analyzed (edition pipeline is authoritative).
    const [doc] = await db.select({ analysisStatus: documents.analysisStatus }).from(documents).where(eq(documents.id, document.id));
    expect(doc.analysisStatus).toBe("complete");
  });

  it("is idempotent on a retried/duplicate job for an edition document", async () => {
    const { document } = await seedDocument({ extractedText: "fixture body text" });
    const [run] = await db.insert(processingRuns).values({
      documentId: document.id,
      version: 1,
      pipelineVersion: "v3",
      status: "complete",
      isPublished: true,
    }).returning({ id: processingRuns.id });
    const [seeded] = await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      rawText: "S Broadie, Ethics with Aristotle, OUP 1991",
      normalizedQuery: "s broadie ethics with aristotle oup 1991",
      sourceType: "bibliography",
      parserConfidence: 0.9,
      resolutionState: "resolved",
      resolutionSource: "research:crossref",
    }).returning({ id: citations.id });

    await analyzeWork(document.id);
    await analyzeWork(document.id);

    const after = await db.select().from(citations).where(eq(citations.documentId, document.id));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(seeded.id);
    expect(after[0].processingRunId).toBe(run.id);
  });

  it("still runs legacy analysis for a true v1 document (no processing_run)", async () => {
    // Citation-free prose → extractCitations yields no candidates → no external
    // lookup, no classifier call — the legacy path runs but re-inserts nothing.
    const { document } = await seedDocument({
      extractedText: "This fixture document deliberately contains ordinary prose and makes no scholarly reference of any kind.",
    });

    // A legacy citation with NO processing_run_id, exactly as pre-edition
    // analyzeWork produced them. There is deliberately no processing_run row.
    await db.insert(citations).values({
      documentId: document.id,
      processingRunId: null,
      rawText: "A stale legacy citation row",
      normalizedQuery: "a stale legacy citation row",
      sourceType: "bibliography",
      parserConfidence: 0.5,
      resolutionState: "unresolved",
      resolutionSource: "unresolved",
    });

    await analyzeWork(document.id);

    // The guard did NOT fire: legacy analysis ran its idempotent delete, so the
    // stale row is gone and (no candidates in the prose) nothing replaced it.
    const after = await db.select().from(citations).where(eq(citations.documentId, document.id));
    expect(after).toHaveLength(0);

    const [doc] = await db.select({ analysisStatus: documents.analysisStatus }).from(documents).where(eq(documents.id, document.id));
    expect(doc.analysisStatus).toBe("complete");
  });
});
