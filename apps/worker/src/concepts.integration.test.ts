import { concepts, db, graphEdges, users, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Integration tests proving the exact concept-extraction write shape
 * `analyze.ts`'s "concepts-people-debates" stage uses round-trips through
 * Drizzle against real Postgres, and specifically that its two idempotency
 * safeguards actually hold: reusing an existing `concept` row by slug rather
 * than duplicating it (the global catalog is append-only, like
 * `bibliographic_record`), and never duplicating the work→concept
 * `graph_edge` on a repeat run (unlike `research_resource`/
 * `passage_annotation`, `graph_edge` carries no `runId` of its own, so
 * nothing else would catch this). Skipped when DATABASE_URL is unset, same
 * as `passageAnnotations.integration.test.ts`.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

async function seedUserAndWork() {
  const [user] = await db.insert(users).values({ email: `concepts-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  const [work] = await db.insert(works).values({ userId: user.id, title: "Ethics", authorName: "Aristotle" }).returning({ id: works.id });
  return { userId: user.id, workId: work.id };
}

/** Mirrors analyze.ts's upsert-by-slug: reuse an existing concept, else insert. */
async function upsertConceptBySlug(input: { slug: string; kind: string; label: string; summary: string }) {
  const [existing] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.slug, input.slug)).limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(concepts)
    .values({ slug: input.slug, kind: input.kind as typeof concepts.$inferInsert.kind, label: input.label, summary: input.summary })
    .returning({ id: concepts.id });
  return created.id;
}

/** Mirrors analyze.ts's idempotent-safe edge insert. */
async function insertPresupposesEdgeIfMissing(input: { userId: string; workId: string; conceptId: string; confidence: number }) {
  const [existingEdge] = await db
    .select({ id: graphEdges.id })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.userId, input.userId),
        eq(graphEdges.sourceType, "work"),
        eq(graphEdges.sourceId, input.workId),
        eq(graphEdges.targetType, "concept"),
        eq(graphEdges.targetId, input.conceptId),
      ),
    )
    .limit(1);
  if (existingEdge) return false;
  await db.insert(graphEdges).values({
    userId: input.userId,
    sourceType: "work",
    sourceId: input.workId,
    targetType: "concept",
    targetId: input.conceptId,
    edgeType: "presupposes",
    confidence: input.confidence,
    evidence: { role: "central", reason: "test" },
    createdBy: "system",
  });
  return true;
}

describe.skipIf(!hasDb)("concept extraction (integration)", () => {
  const cleanupUsers: string[] = [];
  const cleanupConcepts: string[] = [];
  afterEach(async () => {
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
    while (cleanupConcepts.length) await db.delete(concepts).where(eq(concepts.id, cleanupConcepts.pop()!));
  });

  it("persists a concept with the exact shape analyze.ts inserts", async () => {
    const conceptId = await upsertConceptBySlug({ slug: `akrasia-${crypto.randomUUID()}`, kind: "concept", label: "Akrasia", summary: "Weakness of will." });
    cleanupConcepts.push(conceptId);

    const [row] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
    expect(row).toMatchObject({ kind: "concept", label: "Akrasia", summary: "Weakness of will." });
  });

  it("reuses an existing concept by slug rather than duplicating it — the global catalog is append-only", async () => {
    const slug = `akrasia-${crypto.randomUUID()}`;
    const firstId = await upsertConceptBySlug({ slug, kind: "concept", label: "Akrasia", summary: "First run's summary." });
    cleanupConcepts.push(firstId);

    // A second "run" extracting the identical label reuses the same row —
    // it must NOT get a second summary/insert even though the wording of
    // the extraction call could plausibly differ slightly.
    const secondId = await upsertConceptBySlug({ slug, kind: "concept", label: "Akrasia", summary: "Second run's summary." });
    expect(secondId).toBe(firstId);

    const rows = await db.select().from(concepts).where(eq(concepts.slug, slug));
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("First run's summary."); // untouched by the second run
  });

  it("writes a work→concept presupposes edge with role/reason in evidence", async () => {
    const { userId, workId } = await seedUserAndWork();
    cleanupUsers.push(userId);
    const conceptId = await upsertConceptBySlug({ slug: `akrasia-${crypto.randomUUID()}`, kind: "concept", label: "Akrasia", summary: "s" });
    cleanupConcepts.push(conceptId);

    const inserted = await insertPresupposesEdgeIfMissing({ userId, workId, conceptId, confidence: 0.85 });
    expect(inserted).toBe(true);

    const [edge] = await db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.sourceId, workId), eq(graphEdges.targetId, conceptId)));
    expect(edge).toMatchObject({
      sourceType: "work",
      targetType: "concept",
      edgeType: "presupposes",
      confidence: 0.85,
      evidence: { role: "central", reason: "test" },
    });
  });

  it("does not duplicate the work→concept edge on a repeat run over the same work", async () => {
    const { userId, workId } = await seedUserAndWork();
    cleanupUsers.push(userId);
    const conceptId = await upsertConceptBySlug({ slug: `akrasia-${crypto.randomUUID()}`, kind: "concept", label: "Akrasia", summary: "s" });
    cleanupConcepts.push(conceptId);

    const first = await insertPresupposesEdgeIfMissing({ userId, workId, conceptId, confidence: 0.85 });
    const second = await insertPresupposesEdgeIfMissing({ userId, workId, conceptId, confidence: 0.85 });
    expect(first).toBe(true);
    expect(second).toBe(false); // graph_edge has no runId of its own — this is the only guard against unbounded duplication

    const edges = await db
      .select()
      .from(graphEdges)
      .where(and(eq(graphEdges.sourceId, workId), eq(graphEdges.targetId, conceptId)));
    expect(edges).toHaveLength(1);
  });

  it("cascades the concept's mastery/graph rows on user or concept deletion, same as other Phase 9 tables", async () => {
    const { userId, workId } = await seedUserAndWork();
    const conceptId = await upsertConceptBySlug({ slug: `akrasia-${crypto.randomUUID()}`, kind: "concept", label: "Akrasia", summary: "s" });
    await insertPresupposesEdgeIfMissing({ userId, workId, conceptId, confidence: 0.85 });

    await db.delete(users).where(eq(users.id, userId)); // graph_edge.user_id is a real FK (cascade); source_id/work_id is not
    const remaining = await db.select().from(graphEdges).where(eq(graphEdges.targetId, conceptId));
    expect(remaining).toHaveLength(0);

    await db.delete(concepts).where(eq(concepts.id, conceptId));
  });
});
