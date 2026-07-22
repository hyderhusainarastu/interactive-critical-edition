import { afterEach, describe, expect, it } from "vitest";
import { bibliographicRecords, citations, db, documents, users, works } from "@ice/db";
import { inArray } from "drizzle-orm";
import { fetchConsistencySnapshot } from "./snapshot";

/**
 * Phase 20.7 DB integration — smoke test that `fetchConsistencySnapshot`
 * really reads the live tables into exactly the flat shape the pure checks
 * expect (as opposed to only ever being exercised against hand-built
 * in-memory fixtures, which `@ice/consistency`'s own unit tests already
 * cover exhaustively).
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const marker = `p207-snap-${crypto.randomUUID().slice(0, 8)}`;
const cleanup = { userIds: [] as string[], workIds: [] as string[], documentIds: [] as string[], bibIds: [] as string[], citationIds: [] as string[] };

async function seedUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `${marker}-${crypto.randomUUID().slice(0, 6)}@integration.test`, passwordHash: "x" }).returning({ id: users.id });
  cleanup.userIds.push(user.id);
  return user.id;
}

describe.skipIf(!hasDb)("fetchConsistencySnapshot (integration)", () => {
  afterEach(async () => {
    if (cleanup.citationIds.length) await db.delete(citations).where(inArray(citations.id, cleanup.citationIds));
    if (cleanup.documentIds.length) await db.delete(documents).where(inArray(documents.id, cleanup.documentIds));
    if (cleanup.workIds.length) await db.delete(works).where(inArray(works.id, cleanup.workIds));
    if (cleanup.bibIds.length) await db.delete(bibliographicRecords).where(inArray(bibliographicRecords.id, cleanup.bibIds));
    if (cleanup.userIds.length) await db.delete(users).where(inArray(users.id, cleanup.userIds));
    cleanup.userIds = [];
    cleanup.workIds = [];
    cleanup.documentIds = [];
    cleanup.bibIds = [];
    cleanup.citationIds = [];
  });

  it("includes a freshly seeded citation, work, and bibliographic_record in the flat snapshot", async () => {
    const userId = await seedUser();
    const [work] = await db.insert(works).values({ userId, title: `${marker} work` }).returning({ id: works.id });
    cleanup.workIds.push(work.id);
    const [document] = await db
      .insert(documents)
      .values({ userId, workId: work.id, storagePath: `${marker}/doc.txt`, originalFilename: "doc.txt", mimeType: "text/plain", fileSize: 10 })
      .returning({ id: documents.id });
    cleanup.documentIds.push(document.id);
    const [bib] = await db.insert(bibliographicRecords).values({ source: "crossref", title: `${marker} bib` }).returning({ id: bibliographicRecords.id });
    cleanup.bibIds.push(bib.id);
    const [citation] = await db
      .insert(citations)
      .values({ documentId: document.id, rawText: `${marker} raw`, normalizedQuery: marker, resolvedBibId: bib.id, resolutionSource: "crossref", resolutionState: "resolved" })
      .returning({ id: citations.id });
    cleanup.citationIds.push(citation.id);

    const snapshot = await fetchConsistencySnapshot();

    expect(snapshot.works.some((w) => w.id === work.id && w.title === `${marker} work`)).toBe(true);
    expect(snapshot.bibliographicRecords.some((b) => b.id === bib.id && b.title === `${marker} bib`)).toBe(true);
    const snapshotCitation = snapshot.citations.find((c) => c.id === citation.id);
    expect(snapshotCitation).toMatchObject({ documentId: document.id, resolvedBibId: bib.id });
  });
});
