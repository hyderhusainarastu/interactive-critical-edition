import { concepts, conceptMastery, db, graphEdges, readingRecords } from "@ice/db";
import { INFERRED_FROM_COMPLETION_SCORE, inferMasteryFromCompletedWorks, shouldOverwriteMastery, type MasterySource } from "@ice/research";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/**
 * Phase 9.4 (plan §34.4): the optional, skippable per-work diagnostic —
 * self-assessed familiarity with the concepts this work actually
 * presupposes/discusses (extracted by the v3 "concepts-people-debates"
 * stage, see `apps/worker/src/analyze.ts`, and linked via
 * `work -[presupposes]-> concept` graph edges). Self-assessment rather than
 * an LLM-graded fact quiz deliberately: fabricating "correct answers" for a
 * scholarly domain is a real hallucination risk this app's whole posture
 * (packages/bibliographic, quoteIsGrounded, etc.) exists to avoid, and a
 * structured "how familiar are you with X" question is still legitimately
 * more informative than a bare number (why `concept_mastery.source` has a
 * distinct "diagnostic" value from bare "explicit").
 */
const MAX_DIAGNOSTIC_CONCEPTS = 10;

async function workRelevantConcepts(workId: string) {
  return db
    .select({
      id: concepts.id,
      slug: concepts.slug,
      kind: concepts.kind,
      label: concepts.label,
      summary: concepts.summary,
      confidence: graphEdges.confidence,
      role: graphEdges.evidence,
    })
    .from(graphEdges)
    .innerJoin(concepts, eq(concepts.id, graphEdges.targetId))
    .where(and(eq(graphEdges.sourceType, "work"), eq(graphEdges.sourceId, workId), eq(graphEdges.targetType, "concept"), eq(graphEdges.edgeType, "presupposes")))
    .orderBy(desc(graphEdges.confidence))
    .limit(MAX_DIAGNOSTIC_CONCEPTS);
}

export async function GET(_request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const relevant = await workRelevantConcepts(workId);
  const conceptIds = relevant.map((c) => c.id);
  // Sub-phase 22.9b (plan §3.4): `evidence` now also carries the verbatim
  // basis text for a chat-inferred row ('Reader statement in Ask Library
  // chat: "…"'), so the UI can render the same provenance line it shows
  // for a completed-prerequisite inference below — cheap to add since this
  // select already scans the same rows.
  let existing = conceptIds.length
    ? await db
        .select({ conceptId: conceptMastery.conceptId, score: conceptMastery.score, source: conceptMastery.source, evidence: conceptMastery.evidence })
        .from(conceptMastery)
        .where(and(eq(conceptMastery.userId, userId), inArray(conceptMastery.conceptId, conceptIds)))
    : [];

  // Precedence chain's third step (plan §34.4): a concept with no recorded
  // mastery yet, but which the reader implicitly demonstrated by completing
  // ANOTHER work that also presupposes it, gets a weak inferred score
  // rather than falling straight to the coarse reader-level default.
  // Opportunistic write, not silent: it only ever fills a genuinely empty
  // slot (shouldOverwriteMastery(null, "inferred") is always true, and
  // nothing here ever touches a concept that already has a row).
  const uncoveredConceptIds = conceptIds.filter((id) => !existing.some((e) => e.conceptId === id));
  if (uncoveredConceptIds.length) {
    const [completed, allEdges] = await Promise.all([
      db.select({ workId: readingRecords.workId }).from(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.status, "completed"))),
      db.select({ workId: graphEdges.sourceId, conceptId: graphEdges.targetId }).from(graphEdges).where(and(eq(graphEdges.userId, userId), eq(graphEdges.sourceType, "work"), eq(graphEdges.targetType, "concept"), eq(graphEdges.edgeType, "presupposes"))),
    ]);
    const completedWorkIds = completed.map((c) => c.workId).filter((id): id is string => id !== null);
    const inferred: (typeof conceptMastery.$inferInsert)[] = [];
    for (const conceptId of uncoveredConceptIds) {
      if (inferMasteryFromCompletedWorks({ targetConceptId: conceptId, completedWorkIds, workConceptEdges: allEdges })) {
        inferred.push({ userId, conceptId, score: INFERRED_FROM_COMPLETION_SCORE, source: "inferred", evidence: "Inferred from a completed prerequisite work." });
      }
    }
    if (inferred.length) {
      const written = await db.insert(conceptMastery).values(inferred).onConflictDoNothing().returning({ conceptId: conceptMastery.conceptId, score: conceptMastery.score, source: conceptMastery.source, evidence: conceptMastery.evidence });
      existing = [...existing, ...written];
    }
  }

  return NextResponse.json({
    concepts: relevant.map((c) => ({
      id: c.id,
      slug: c.slug,
      kind: c.kind,
      label: c.label,
      summary: c.summary,
      role: (c.role as { role?: string } | null)?.role ?? null,
    })),
    existingMastery: existing,
  });
}

const SELF_ASSESSMENT_SCHEMA = {
  never: 5,
  heard: 30,
  basics: 55,
  explain: 85,
} as const;
type SelfAssessment = keyof typeof SELF_ASSESSMENT_SCHEMA;

interface AnswerInput {
  conceptId: string;
  assessment: SelfAssessment;
}

export async function POST(request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { answers?: unknown } | null;
  if (!body || !Array.isArray(body.answers)) {
    return NextResponse.json({ error: "answers must be an array" }, { status: 400 });
  }

  // Only accept answers about concepts this work actually presupposes — a
  // client can't back-write mastery for an arbitrary concept id it invents.
  const relevant = await workRelevantConcepts(workId);
  const relevantIds = new Set(relevant.map((c) => c.id));

  const answers: AnswerInput[] = (body.answers as unknown[])
    .map((a) => a as Record<string, unknown>)
    .filter(
      (a) =>
        typeof a.conceptId === "string" &&
        relevantIds.has(a.conceptId) &&
        typeof a.assessment === "string" &&
        a.assessment in SELF_ASSESSMENT_SCHEMA,
    )
    .map((a) => ({ conceptId: a.conceptId as string, assessment: a.assessment as SelfAssessment }));
  if (answers.length === 0) return NextResponse.json({ written: 0 });

  const conceptIds = answers.map((a) => a.conceptId);
  const existing = await db
    .select({ conceptId: conceptMastery.conceptId, source: conceptMastery.source })
    .from(conceptMastery)
    .where(and(eq(conceptMastery.userId, userId), inArray(conceptMastery.conceptId, conceptIds)));
  const existingSourceByConcept = new Map<string, MasterySource>(existing.map((e) => [e.conceptId, e.source]));

  let written = 0;
  for (const answer of answers) {
    const existingSource = existingSourceByConcept.get(answer.conceptId) ?? null;
    // The precedence rule (plan §34.4): a diagnostic answer must never
    // silently downgrade an explicit rating already on record for this
    // concept, though retaking the diagnostic itself is allowed through.
    if (!shouldOverwriteMastery(existingSource, "diagnostic")) continue;

    const score = SELF_ASSESSMENT_SCHEMA[answer.assessment];
    await db
      .insert(conceptMastery)
      .values({ userId, conceptId: answer.conceptId, score, source: "diagnostic", evidence: `Self-assessed via the ${doc.title} diagnostic.` })
      .onConflictDoUpdate({
        target: [conceptMastery.userId, conceptMastery.conceptId],
        set: { score, source: "diagnostic", evidence: `Self-assessed via the ${doc.title} diagnostic.`, updatedAt: new Date() },
      });
    written += 1;
  }

  return NextResponse.json({ written });
}
