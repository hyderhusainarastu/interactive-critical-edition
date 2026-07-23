/**
 * Regression for the 2026-07-23 production resource_role FK-violation incident
 * (processing_run b2750c63, owner user acd82beb; the Brickhouse/Aristotle-vice
 * baseline document). A failed run died with:
 *
 *   insert or update on table "resource_role" violates foreign key constraint
 *   "resource_role_learning_resource_id_learning_resource_id_fk"
 *   params: 34e287b0-... , 963564f9-... , explicit_reference, ,
 *           Direct citation page 19: Nicomachean Ethics, 0.82, system, ...
 *
 * Root cause: `applyResolvedCitation` and `resolveCitationMetadata` run
 * CONCURRENTLY on separate pg-boss queues within one document's pipeline, and
 * both apply a citation via a read-modify-write that is NOT atomic across the
 * two paths. One path reads a citation's target learning_resource id; before
 * its `ensureCitationRole` insert fires, a parallel path's merge (its stub
 * delete) deletes exactly that learning_resource — having first repointed
 * every citationLibraryLink off it onto the surviving canonical row. The
 * insert then references a genuinely-gone id and violates the FK (23503),
 * crashing the whole edition run. e48cb1a unmasked (did not introduce) this:
 * before it, the research_resource duplicate-key crash killed the run long
 * before `linkCitationsToRunDiscoveries` ever ran, so this pre-existing race
 * was structurally unreachable.
 *
 * The fix makes `ensureCitationRole` treat a learning_resource FK violation as
 * the benign concurrent-merge race it is: re-resolve to the citation's CURRENT
 * link (the merge repoints it onto the survivor before deleting the stub) and
 * write the role there; if even that is gone, skip with a structured event
 * (the survivor already carries the (resource, work) role) rather than crash.
 *
 * These tests reconstruct the completed-merge state deterministically (no real
 * external lookup needed) and drive the losing path's `ensureCitationRole`
 * against the now-phantom id, per the DB-integration precedent in
 * `citationLinking.integration.test.ts`.
 */
import {
  citationLibraryLinks,
  citations,
  db,
  documents,
  learningResources,
  processingRuns,
  resourceRoles,
  users,
  workIdentities,
  works,
} from "@ice/db";
import type { RawCitation } from "@ice/ingestion";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createCitationLibraryProjection, ensureCitationRole } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);
const cleanup = { userIds: [] as string[], identityIds: [] as string[], learningResourceIds: [] as string[] };

describe.skipIf(!hasDb)("resource_role phantom-FK race (2026-07-23 incident b2750c63)", () => {
  afterEach(async () => {
    // learning_resource is not user-scoped (shared, append-only), so its rows
    // do not cascade from a user delete — remove them explicitly first, then
    // the user cascade takes citation/document/work/etc.
    if (cleanup.learningResourceIds.length) {
      await db.delete(learningResources).where(inArray(learningResources.id, cleanup.learningResourceIds));
      cleanup.learningResourceIds = [];
    }
    while (cleanup.userIds.length) await db.delete(users).where(eq(users.id, cleanup.userIds.pop()!));
    if (cleanup.identityIds.length) {
      await db.delete(workIdentities).where(inArray(workIdentities.id, cleanup.identityIds));
      cleanup.identityIds = [];
    }
  });

  async function seed() {
    const [user] = await db.insert(users).values({ email: `phantom-fk-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanup.userIds.push(user.id);
    const [identity] = await db
      .insert(workIdentities)
      .values({
        workKey: `fixture:phantom-fk:${crypto.randomUUID()}`,
        canonicalTitle: "Aristotle's Account of the Vicious",
        authorSurname: "brickhouse",
        authors: ["Thomas Brickhouse"],
        evidence: "phantom-fk fixture",
      })
      .returning({ id: workIdentities.id });
    cleanup.identityIds.push(identity.id);
    const [work] = await db
      .insert(works)
      .values({ userId: user.id, workIdentityId: identity.id, title: "Aristotle's Account of the Vicious", authorName: "Thomas Brickhouse" })
      .returning({ id: works.id });
    const [document] = await db
      .insert(documents)
      .values({
        userId: user.id,
        workId: work.id,
        storagePath: `fixtures/${work.id}/vice.txt`,
        originalFilename: "vice.txt",
        mimeType: "text/plain",
        fileSize: 10,
        processingStatus: "ready",
        extractedText: "fixture body text",
      })
      .returning({ id: documents.id });
    const [run] = await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v3" }).returning({ id: processingRuns.id });
    return { user, identity, work, document, run };
  }

  // A citation matching the incident's own params exactly: page-19 inline
  // "Nicomachean Ethics", parserConfidence 0.82 → rationale
  // "Direct citation page 19: Nicomachean Ethics".
  const rawCitation: RawCitation = {
    text: "Nicomachean Ethics",
    query: "nicomachean ethics",
    kind: "inline",
    sourceType: "inline",
    parserConfidence: 0.82,
    anchor: { textBlockId: null, pageIndex: 18, blockOrder: null, marker: null, startOffset: null, endOffset: null },
  };

  it("re-points the role to the survivor when the target learning_resource was concurrently merged away", async () => {
    const { identity, document, run } = await seed();

    const [citation] = await db
      .insert(citations)
      .values({
        documentId: document.id,
        processingRunId: run.id,
        rawText: rawCitation.text,
        normalizedQuery: rawCitation.query,
        sourceType: "inline",
        parserConfidence: 0.82,
        resolutionState: "pending",
        resolutionSource: "unresolved",
      })
      .returning({ id: citations.id });

    // The stub Library row exactly as the projection loop creates it.
    const stubId = await createCitationLibraryProjection({ citationId: citation.id, citation: rawCitation, workIdentityId: identity.id });
    cleanup.learningResourceIds.push(stubId);

    // Reconstruct the state left by the WINNER of the concurrent merge
    // (applyResolvedCitation's merge branch, analyze.ts ~L629-631): a surviving
    // canonical row exists, the citation's link is repointed onto it, and the
    // stub's role + the stub itself are deleted.
    const [survivor] = await db
      .insert(learningResources)
      .values({ normalizedKey: `canonical:${crypto.randomUUID()}`, title: "Aristotle, Nicomachean Ethics (Irwin)", resourceType: "bibliographic", provider: "crossref", authors: ["Aristotle"] })
      .returning({ id: learningResources.id });
    cleanup.learningResourceIds.push(survivor.id);
    await db.update(citationLibraryLinks).set({ learningResourceId: survivor.id }).where(eq(citationLibraryLinks.learningResourceId, stubId));
    await db.delete(resourceRoles).where(eq(resourceRoles.learningResourceId, stubId));
    await db.delete(learningResources).where(eq(learningResources.id, stubId));

    // The LOSER of the race still holds the now-phantom `stubId`. On the old
    // code this insert threw the incident's FK 23503 and crashed the run.
    await expect(
      ensureCitationRole({ learningResourceId: stubId, workIdentityId: identity.id, citation: rawCitation, citationId: citation.id }),
    ).resolves.toBeUndefined();

    // The role landed on the surviving canonical row — not lost, not phantom.
    const roles = await db.select().from(resourceRoles).where(eq(resourceRoles.workIdentityId, identity.id));
    expect(roles).toHaveLength(1);
    expect(roles[0].learningResourceId).toBe(survivor.id);
    expect(roles[0].rationale).toBe("Direct citation page 19: Nicomachean Ethics");
    expect(roles[0].relationship).toBe("explicit_reference");
  });

  it("skips without crashing when even the re-resolved link is gone", async () => {
    const { identity, document, run } = await seed();

    const [citation] = await db
      .insert(citations)
      .values({
        documentId: document.id,
        processingRunId: run.id,
        rawText: rawCitation.text,
        normalizedQuery: rawCitation.query,
        sourceType: "inline",
        parserConfidence: 0.82,
        resolutionState: "pending",
        resolutionSource: "unresolved",
      })
      .returning({ id: citations.id });

    const stubId = await createCitationLibraryProjection({ citationId: citation.id, citation: rawCitation, workIdentityId: identity.id });
    cleanup.learningResourceIds.push(stubId);

    // A fuller concurrent cleanup: the stub AND the citation's link are gone,
    // so re-resolution finds no surviving target. The role is legitimately
    // covered by whatever the merge kept, so this must skip, not throw.
    await db.delete(citationLibraryLinks).where(eq(citationLibraryLinks.learningResourceId, stubId));
    await db.delete(resourceRoles).where(eq(resourceRoles.learningResourceId, stubId));
    await db.delete(learningResources).where(eq(learningResources.id, stubId));

    await expect(
      ensureCitationRole({ learningResourceId: stubId, workIdentityId: identity.id, citation: rawCitation, citationId: citation.id }),
    ).resolves.toBeUndefined();

    const roles = await db.select().from(resourceRoles).where(and(eq(resourceRoles.workIdentityId, identity.id)));
    expect(roles).toHaveLength(0);
  });
});
