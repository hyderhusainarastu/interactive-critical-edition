import {
  bibliographicRecords,
  citationLibraryLinks,
  citations,
  db,
  documents,
  graphEdges,
  learningResources,
  resourceRoles,
  users,
  workIdentities,
  works,
} from "@ice/db";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { findClassicalStubCandidates, runCleanupClassicalCitationStubs } from "./cleanupClassicalCitationStubs";

/**
 * DB integration for the classical-citation-stub cleanup script, against
 * real local Postgres. Seeds exactly the shape the OLD (pre-fix) extraction
 * gate used to produce — a junk "Needs bibliographic resolution —
 * Af?;7.8.1151a20-8." Library stub — alongside a genuine modern unresolved
 * citation stub that must never be touched, then drives the script's
 * dry-run and `--execute` (with and without `--reproject`) paths directly.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const marker = `bekker-cleanup-${crypto.randomUUID().slice(0, 8)}`;
const cleanup = {
  userIds: [] as string[],
  identityIds: [] as string[],
  workIds: [] as string[],
  documentIds: [] as string[],
  citationIds: [] as string[],
  resourceIds: [] as string[],
  bibIds: [] as string[],
};

async function seedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `${marker}-${crypto.randomUUID().slice(0, 6)}@integration.test`, passwordHash: "x" })
    .returning({ id: users.id });
  cleanup.userIds.push(user.id);
  return user.id;
}

async function seedWork(userId: string): Promise<{ workId: string; identityId: string; documentId: string }> {
  const [identity] = await db
    .insert(workIdentities)
    .values({ workKey: `${marker}:${crypto.randomUUID()}`, canonicalTitle: `${marker} work`, authorSurname: "seed", evidence: marker })
    .returning({ id: workIdentities.id });
  cleanup.identityIds.push(identity.id);

  const [work] = await db
    .insert(works)
    .values({ userId, title: `${marker} work`, workIdentityId: identity.id })
    .returning({ id: works.id });
  cleanup.workIds.push(work.id);

  const [document] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `fixtures/${work.id}/${marker}.txt`,
      originalFilename: `${marker}.txt`,
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      extractedText: "seed",
    })
    .returning({ id: documents.id });
  cleanup.documentIds.push(document.id);

  return { workId: work.id, identityId: identity.id, documentId: document.id };
}

/** Seeds exactly the pre-fix junk shape: a `citation` row plus its
 *  "Needs bibliographic resolution — <text>" Library stub, linked and given
 *  a resource_role — so cascade-on-delete is genuinely exercised, not just
 *  asserted from the schema. */
async function seedJunkStub(input: { documentId: string; identityId: string; rawText: string }): Promise<{
  citationId: string;
  learningResourceId: string;
}> {
  const [citation] = await db
    .insert(citations)
    .values({
      documentId: input.documentId,
      rawText: input.rawText,
      normalizedQuery: input.rawText,
      sourceType: "footnote",
      parserConfidence: 0.9,
      sourceAnchor: { pageIndex: 6, blockOrder: 3, marker: "12", startOffset: null, endOffset: null, textBlockId: null },
      resolutionState: "unresolved",
      resolutionSource: "unresolved",
    })
    .returning({ id: citations.id });
  cleanup.citationIds.push(citation.id);

  const [resource] = await db
    .insert(learningResources)
    .values({
      normalizedKey: `${marker}:stub:${crypto.randomUUID()}`,
      title: `Needs bibliographic resolution — ${input.rawText}`,
      resourceType: "unresolved-citation",
      provider: "citation-extraction",
      authors: [],
    })
    .returning({ id: learningResources.id });
  // Registered for cleanup even though several tests expect the script to
  // have already deleted this row itself — the afterEach sweep below is an
  // idempotent no-op against an id that's already gone, and this is what
  // keeps the dry-run/modern-untouched tests (which never delete anything)
  // from leaking a row.
  cleanup.resourceIds.push(resource.id);

  await db.insert(resourceRoles).values({
    learningResourceId: resource.id,
    workIdentityId: input.identityId,
    relationship: "explicit_reference",
    rationale: `Footnote: ${input.rawText}`,
    confidence: 0.9,
    createdBy: "system",
  });
  await db.insert(citationLibraryLinks).values({ citationId: citation.id, learningResourceId: resource.id });

  return { citationId: citation.id, learningResourceId: resource.id };
}

describe.skipIf(!hasDb)("cleanupClassicalCitationStubs (integration)", () => {
  afterEach(async () => {
    // citation/citationLibraryLink/resourceRole cascade from document/user
    // deletion; delete top-down. The canonical classical `learning_resource`
    // + `bibliographic_record` the reproject test creates are shared/global
    // (keyed by normalizedKey "classical:aristotle:nicomachean-ethics" — the
    // real production key, deliberately the SAME one the sibling test in
    // `phase17CitationIntegrity.integration.test.ts` exercises) and have no
    // FK back to this test's own seeds, so they're deleted by the id each
    // test tracked for itself (`cleanup.resourceIds`/`cleanup.bibIds`) —
    // NEVER by that shared key/title directly. A blanket delete-by-key here
    // would race a concurrently-running file's own use of the identical
    // canonical row (Vitest runs test files in parallel by default).
    if (cleanup.documentIds.length) await db.delete(documents).where(inArray(documents.id, cleanup.documentIds));
    if (cleanup.workIds.length) await db.delete(works).where(inArray(works.id, cleanup.workIds));
    if (cleanup.userIds.length) await db.delete(users).where(inArray(users.id, cleanup.userIds));
    if (cleanup.identityIds.length) await db.delete(workIdentities).where(inArray(workIdentities.id, cleanup.identityIds));
    if (cleanup.resourceIds.length) {
      await db.delete(resourceRoles).where(inArray(resourceRoles.learningResourceId, cleanup.resourceIds));
      await db.delete(learningResources).where(inArray(learningResources.id, cleanup.resourceIds));
    }
    if (cleanup.bibIds.length) await db.delete(bibliographicRecords).where(inArray(bibliographicRecords.id, cleanup.bibIds));
    cleanup.userIds = [];
    cleanup.identityIds = [];
    cleanup.workIds = [];
    cleanup.documentIds = [];
    cleanup.citationIds = [];
    cleanup.resourceIds = [];
    cleanup.bibIds = [];
  });

  it("finds only the locus-dominated classical stub, never the genuine modern unresolved one", async () => {
    const userId = await seedUser();
    const { documentId, identityId } = await seedWork(userId);
    const classical = await seedJunkStub({ documentId, identityId, rawText: "Af?;7.8.1151a20-8." });
    const modern = await seedJunkStub({ documentId, identityId, rawText: "The Archive of Lost Virtues, anonymous manuscript." });

    const candidates = await findClassicalStubCandidates();
    const ours = candidates.filter((c) => c.citationId === classical.citationId || c.citationId === modern.citationId);
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ citationId: classical.citationId, classicalWork: "Nicomachean Ethics" });
  });

  it("dry run (default) writes nothing", async () => {
    const userId = await seedUser();
    const { documentId, identityId } = await seedWork(userId);
    const stub = await seedJunkStub({ documentId, identityId, rawText: "Af?;7.8.1151a20-8." });

    const result = await runCleanupClassicalCitationStubs({ execute: false, reproject: false });
    expect(result.deleted).toBe(0);
    expect(result.reprojected).toBe(0);

    const [stillThere] = await db.select().from(learningResources).where(eq(learningResources.id, stub.learningResourceId));
    expect(stillThere).toBeDefined();
    const [link] = await db.select().from(citationLibraryLinks).where(eq(citationLibraryLinks.citationId, stub.citationId));
    expect(link).toBeDefined();
  });

  it("--execute (no --reproject) deletes the stub, cascades role and link, and never touches the citation row", async () => {
    const userId = await seedUser();
    const { documentId, identityId } = await seedWork(userId);
    const stub = await seedJunkStub({ documentId, identityId, rawText: "Af?;7.8.1151a20-8." });

    const result = await runCleanupClassicalCitationStubs({ execute: true, reproject: false });
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(result.failures).toHaveLength(0);

    const [resourceRow] = await db.select().from(learningResources).where(eq(learningResources.id, stub.learningResourceId));
    expect(resourceRow).toBeUndefined();
    const roles = await db.select().from(resourceRoles).where(eq(resourceRoles.learningResourceId, stub.learningResourceId));
    expect(roles).toHaveLength(0);
    const links = await db.select().from(citationLibraryLinks).where(eq(citationLibraryLinks.learningResourceId, stub.learningResourceId));
    expect(links).toHaveLength(0);

    // Provenance preserved exactly: the citation row itself is untouched.
    const [citationRow] = await db.select().from(citations).where(eq(citations.id, stub.citationId));
    expect(citationRow).toMatchObject({ rawText: "Af?;7.8.1151a20-8.", resolutionState: "unresolved", resolvedBibId: null });
  });

  it("leaves a genuine modern unresolved citation's stub untouched under --execute", async () => {
    const userId = await seedUser();
    const { documentId, identityId } = await seedWork(userId);
    const modern = await seedJunkStub({ documentId, identityId, rawText: "The Archive of Lost Virtues, anonymous manuscript." });

    await runCleanupClassicalCitationStubs({ execute: true, reproject: false });

    const [resourceRow] = await db.select().from(learningResources).where(eq(learningResources.id, modern.learningResourceId));
    expect(resourceRow).toBeDefined();
    expect(resourceRow?.title).toContain("The Archive of Lost Virtues");
  });

  it("--execute --reproject re-points an identifiable stub onto the canonical classical Library entry and resolves the citation", async () => {
    const userId = await seedUser();
    const { documentId, identityId, workId } = await seedWork(userId);
    const stub = await seedJunkStub({ documentId, identityId, rawText: "Af?;7.8.1151a20-8." });

    const result = await runCleanupClassicalCitationStubs({ execute: true, reproject: true });
    expect(result.reprojected).toBeGreaterThanOrEqual(1);
    expect(result.failures).toHaveLength(0);

    // The old stub is gone (merged away, not left dangling).
    const [oldResource] = await db.select().from(learningResources).where(eq(learningResources.id, stub.learningResourceId));
    expect(oldResource).toBeUndefined();

    // The citation now resolves to the canonical classical entry.
    const [citationRow] = await db.select().from(citations).where(eq(citations.id, stub.citationId));
    expect(citationRow).toMatchObject({ resolutionState: "resolved", resolutionSource: "classical-canon" });
    expect(citationRow?.resolvedBibId).toBeTruthy();
    cleanup.bibIds.push(citationRow!.resolvedBibId!);

    const [link] = await db.select().from(citationLibraryLinks).where(eq(citationLibraryLinks.citationId, stub.citationId));
    expect(link).toBeDefined();
    const [canonical] = await db.select().from(learningResources).where(eq(learningResources.id, link!.learningResourceId));
    expect(canonical).toMatchObject({
      normalizedKey: "classical:aristotle:nicomachean-ethics",
      title: "Aristotle, Nicomachean Ethics",
      resourceType: "classical-primary-source",
      provider: "classical-citation",
    });
    cleanup.resourceIds.push(canonical!.id);

    const edges = await db.select().from(graphEdges).where(eq(graphEdges.sourceId, workId));
    expect(edges.some((edge) => edge.edgeType === "cites" && edge.targetId === citationRow!.resolvedBibId)).toBe(true);
  });
});
