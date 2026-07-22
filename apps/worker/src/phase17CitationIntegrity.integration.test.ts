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
import { extractCitationMentions, type CitationSourceType } from "@ice/ingestion";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/vice-and-reason-citations.json";

const resolver = vi.hoisted(() => ({ resolveCitation: vi.fn() }));
vi.mock("@ice/bibliographic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ice/bibliographic")>()),
  resolveCitation: resolver.resolveCitation,
}));

import { createCitationLibraryProjection, resolveCitationMetadata } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);
const cleanup = { userId: "", identityId: "", resourceIds: [] as string[], bibIds: [] as string[] };

describe.skipIf(!hasDb)("Phase 17 — Vice and Reason citation integrity", () => {
  afterEach(async () => {
    resolver.resolveCitation.mockReset();
    // User deletion cascades document/citation/citation-link/graph rows. The
    // cross-work catalogue and Library rows are intentionally shared, so this
    // fixture removes only the exact rows it created afterwards.
    if (cleanup.userId) await db.delete(users).where(eq(users.id, cleanup.userId));
    if (cleanup.resourceIds.length) await db.delete(learningResources).where(inArray(learningResources.id, cleanup.resourceIds));
    if (cleanup.bibIds.length) await db.delete(bibliographicRecords).where(inArray(bibliographicRecords.id, cleanup.bibIds));
    if (cleanup.identityId) await db.delete(workIdentities).where(eq(workIdentities.id, cleanup.identityId));
    cleanup.userId = "";
    cleanup.identityId = "";
    cleanup.resourceIds = [];
    cleanup.bibIds = [];
  });

  it("persists all 22 works plus an unresolved citation as anchored Library and graph targets", async () => {
    const [user] = await db.insert(users).values({ email: `vice-reason-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanup.userId = user.id;
    const [identity] = await db.insert(workIdentities).values({
      workKey: `fixture:vice-and-reason:${crypto.randomUUID()}`,
      canonicalTitle: "Vice and Reason",
      authorSurname: "irwin",
      authors: ["Terence Irwin"],
      evidence: "Phase 17 deterministic fixture",
    }).returning({ id: workIdentities.id });
    cleanup.identityId = identity.id;
    const [work] = await db.insert(works).values({ userId: user.id, workIdentityId: identity.id, title: "Vice and Reason", authorName: "Terence Irwin" }).returning({ id: works.id });
    const [document] = await db.insert(documents).values({
      userId: user.id,
      workId: work.id,
      storagePath: `fixtures/${work.id}/vice-and-reason.txt`,
      originalFilename: "vice-and-reason.txt",
      mimeType: "text/plain",
      fileSize: fixture.bodyText.length,
      processingStatus: "ready",
      extractedText: fixture.bodyText,
    }).returning({ id: documents.id });

    const mentions = extractCitationMentions(fixture.references.map((reference, index) => ({
      sourceType: reference.sourceType as CitationSourceType,
      text: reference.text,
      pageIndex: index,
      blockOrder: index,
      marker: `fixture-${index + 1}`,
      parserConfidence: 0.97,
    })));
    const unresolvedMentions = extractCitationMentions([{
      sourceType: fixture.unresolved.sourceType as CitationSourceType,
      text: fixture.unresolved.text,
      pageIndex: 99,
      blockOrder: 99,
      marker: "fixture-unresolved",
      parserConfidence: 0.89,
    }]);

    // Every expected work must be detected once from its own structural
    // source; apparatus is never concatenated into `bodyText` for this test.
    expect(mentions).toHaveLength(22);
    expect(unresolvedMentions).toHaveLength(1);
    for (const reference of fixture.references) {
      expect(mentions.some((mention) => mention.query.includes(reference.title) || reference.title.includes(mention.query))).toBe(true);
      expect(fixture.bodyText).not.toContain(reference.text);
    }

    const citationRows: { id: string; mentionIndex: number }[] = [];
    for (const [index, mention] of [...mentions, ...unresolvedMentions].entries()) {
      const [citation] = await db.insert(citations).values({
        documentId: document.id,
        rawText: mention.text,
        normalizedQuery: mention.query,
        sourceType: mention.sourceType!,
        parserConfidence: mention.parserConfidence!,
        sourceAnchor: mention.anchor,
        resolutionState: "pending",
        resolutionSource: "unresolved",
      }).returning({ id: citations.id });
      citationRows.push({ id: citation.id, mentionIndex: index });
      await createCitationLibraryProjection({ citationId: citation.id, citation: mention, workIdentityId: identity.id });
    }

    const referencesByTitle = fixture.references;
    resolver.resolveCitation.mockImplementation(async (query: string) => {
      const reference = referencesByTitle
        .filter((candidate) => query.includes(candidate.title) || candidate.title.includes(query))
        .sort((a, b) => b.title.length - a.title.length)[0];
      if (!reference) return null;
      return {
        source: "crossref" as const,
        externalId: `fixture:${reference.key}`,
        title: reference.title,
        authors: reference.authors,
        year: null,
        doi: null,
        url: `https://fixture.invalid/vice-and-reason/${reference.key}`,
        accessStatus: "metadata_only" as const,
        raw: { fixture: true, key: reference.key },
      };
    });
    for (const row of citationRows) await resolveCitationMetadata(row.id);

    const persistedCitations = await db.select().from(citations).where(eq(citations.documentId, document.id));
    const resolved = persistedCitations.filter((citation) => citation.resolutionState === "resolved");
    const unresolved = persistedCitations.filter((citation) => citation.resolutionState === "unresolved");
    expect(resolved).toHaveLength(22);
    expect(unresolved).toHaveLength(1);
    expect(new Set(resolved.map((citation) => citation.resolvedBibId)).size).toBe(22);
    expect(persistedCitations.every((citation) => citation.sourceAnchor && citation.sourceType && citation.parserConfidence > 0 && citation.normalizedQuery)).toBe(true);
    expect(new Set(persistedCitations.map((citation) => citation.sourceAnchor as { marker: string }).map((anchor) => anchor.marker)).size).toBe(23);

    const links = await db.select().from(citationLibraryLinks).where(inArray(citationLibraryLinks.citationId, citationRows.map((row) => row.id)));
    expect(links).toHaveLength(23);
    expect(new Set(links.map((link) => link.learningResourceId)).size).toBe(23);
    cleanup.resourceIds = [...new Set(links.map((link) => link.learningResourceId))];
    const libraryRows = await db.select().from(learningResources).where(inArray(learningResources.id, cleanup.resourceIds));
    expect(libraryRows).toHaveLength(23);
    expect(libraryRows.filter((resource) => resource.resourceType === "unresolved-citation")).toEqual([
      expect.objectContaining({ title: expect.stringContaining("Needs bibliographic resolution — The Archive of Lost Virtues") }),
    ]);
    expect(new Set(libraryRows.map((resource) => resource.normalizedKey)).size).toBe(23);

    const roles = await db.select().from(resourceRoles).where(and(eq(resourceRoles.workIdentityId, identity.id), inArray(resourceRoles.learningResourceId, cleanup.resourceIds)));
    expect(roles).toHaveLength(23);
    expect(roles.every((role) => role.relationship === "explicit_reference")).toBe(true);
    const targets = await db.select().from(graphEdges).where(and(eq(graphEdges.userId, user.id), eq(graphEdges.sourceId, work.id), eq(graphEdges.edgeType, "cites")));
    expect(targets).toHaveLength(22);
    expect(new Set(targets.map((target) => target.targetId)).size).toBe(22);
    cleanup.bibIds = resolved.map((citation) => citation.resolvedBibId!).filter(Boolean);
  });
});
