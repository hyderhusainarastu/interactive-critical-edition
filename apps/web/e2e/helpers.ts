import {
  annotations,
  bibliographicRecords,
  bookmarks,
  claimEvidence,
  concepts,
  conceptMastery,
  credibilityAssessments,
  db,
  docFootnotes,
  documents,
  evidenceSpans,
  generatedClaims,
  generatedNotes,
  graphEdges,
  highlights,
  notes,
  pages,
  passageAnnotations,
  processingRuns,
  providerAttempts,
  readingRecords,
  researchResources,
  textBlocks,
  users,
  works,
} from "@ice/db";
import { deleteDocumentFile } from "@ice/ingestion";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

/**
 * E2E fixtures talk to the DB directly for setup/teardown that isn't
 * the thing under test (e.g. creating an already-verified user) — the
 * signup/verify/reset flow itself is covered separately (manually
 * verified end-to-end in Phase 1/2; not re-driven here since the raw
 * verification token is only ever available via the console-logged
 * email, not recoverable from the DB by design — tokens are stored
 * hashed, see lib/tokens.ts).
 */
export async function createVerifiedTestUser(email: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({ name: "E2E Test", email, passwordHash, emailVerified: new Date() })
    .returning({ id: users.id });
  return user.id;
}

/**
 * Deletes the test user AND the Storage files their documents point
 * to — the DB cascade (onDelete: cascade on documents.user_id) cleans
 * up rows fine, but Storage objects aren't part of that cascade at all
 * (Postgres has no idea Supabase Storage exists), so every test run
 * that uploads a file would otherwise leak it into the bucket forever.
 * Found this the hard way: 16 orphaned files accumulated in Storage
 * from earlier manual + first E2E test runs before this existed.
 */
export async function deleteTestUser(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return;

  const docs = await db
    .select({ storagePath: documents.storagePath })
    .from(documents)
    .where(eq(documents.userId, user.id));

  await Promise.all(docs.map((d) => deleteDocumentFile(d.storagePath).catch(() => {})));
  await db.delete(users).where(eq(users.id, user.id));
}

/**
 * Seeds a ready work + document plus one of every per-user reader/analysis
 * record for the given user, returning the ids — so the authorization
 * matrix (security.spec.ts) has real resources to try to reach as a
 * different user. No Storage upload (the storage path is a placeholder;
 * these tests never fetch the file).
 */
export async function seedOwnedWork(userId: string): Promise<{
  workId: string;
  documentId: string;
  highlightId: string;
  noteId: string;
  bookmarkId: string;
  annotationId: string;
}> {
  const [work] = await db
    .insert(works)
    .values({ userId, title: "Owner's Private Work", authorName: "Owner" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/none.txt`,
      originalFilename: "none.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "Private text. Kant is referenced here.",
    })
    .returning({ id: documents.id });
  const [hl] = await db
    .insert(highlights)
    .values({ userId, documentId: doc.id, anchor: { kind: "text", paragraphIndex: 0, quote: "Private", prefix: "", suffix: " text" }, color: "gold" })
    .returning({ id: highlights.id });
  const [note] = await db
    .insert(notes)
    .values({ userId, documentId: doc.id, body: "owner note" })
    .returning({ id: notes.id });
  const [bm] = await db
    .insert(bookmarks)
    .values({ userId, documentId: doc.id, position: { kind: "text", paragraphIndex: 0 }, label: "Paragraph 1" })
    .returning({ id: bookmarks.id });
  const [bib] = await db
    .insert(bibliographicRecords)
    .values({ source: "openalex", title: "Critique of Pure Reason", authors: "Kant", accessStatus: "open" })
    .returning({ id: bibliographicRecords.id });
  const [ann] = await db
    .insert(annotations)
    .values({
      userId,
      documentId: doc.id,
      relationshipCategory: "explicit_reference",
      targetBibId: bib.id,
      targetLabel: "Critique of Pure Reason",
      explanation: "owner annotation",
      confidence: 0.6,
      createdBy: "system",
    })
    .returning({ id: annotations.id });

  return {
    workId: work.id,
    documentId: doc.id,
    highlightId: hl.id,
    noteId: note.id,
    bookmarkId: bm.id,
    annotationId: ann.id,
  };
}

/**
 * Seeds a PUBLISHED v2 critical edition directly in the database — a page with
 * blocks, an authorial footnote, a generated note with claim-level evidence on
 * both sides, per-provider reports, and four research resources of which three
 * describe the SAME work (the book, a review of it, and a second edition).
 *
 * Seeding rather than running the pipeline is deliberate: it makes the edition
 * reader testable in CI, where there is no worker, no GROBID and no budget for
 * live API calls. The pipeline that produces this shape is exercised separately
 * by production canary runs.
 */
export async function seedPublishedEdition(userId: string): Promise<{
  workId: string;
  documentId: string;
  runId: string;
}> {
  const [work] = await db
    .insert(works)
    .values({ userId, title: "Vice and Reason", authorName: "Terence Irwin" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/edition.txt`,
      originalFilename: "edition.txt",
      mimeType: "text/plain",
      fileSize: 200,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "Vicious people act on decision, yet live according to passion.",
    })
    .returning({ id: documents.id });

  const [run] = await db
    .insert(processingRuns)
    .values({
      documentId: doc.id,
      version: 1,
      pipelineVersion: "v2",
      status: "complete",
      stage: "publish",
      structureState: "full",
      isPublished: true,
      aiCostUsd: 0.0421,
      degraded: false,
    })
    .returning({ id: processingRuns.id });

  const [page] = await db
    .insert(pages)
    .values({ runId: run.id, pageIndex: 0, isOcr: false, text: "Vicious people act on decision." })
    .returning({ id: pages.id });
  const blocks = await db
    .insert(textBlocks)
    .values([
      { pageId: page.id, blockOrder: 0, kind: "header", text: "A Gap in Aristotle's Moral Psychology" },
      { pageId: page.id, blockOrder: 1, kind: "body", text: "Vicious people act on decision, yet live according to passion." },
    ])
    .returning({ id: textBlocks.id, blockOrder: textBlocks.blockOrder });
  const bodyBlock = blocks.find((b) => b.blockOrder === 1)!;

  // Phase 9.3: one anchored passage annotation (a real quote from the body
  // block above) and one whole-work guidance note — the two forms the reader
  // renders differently.
  await db.insert(passageAnnotations).values([
    {
      runId: run.id,
      textBlockId: bodyBlock.id,
      isWholeWork: false,
      quote: "live according to passion",
      summary: "Flags the gap between decision and passion.",
      explanation: "The passage attributes vicious action to decision while describing the vicious agent as living by passion — the tension Irwin's paper investigates.",
      annotationType: "clarification",
      relationship: "interpretive_aid",
      readerLevel: "undergraduate",
      confidence: 0.75,
    },
    {
      runId: run.id,
      textBlockId: null,
      isWholeWork: true,
      quote: null,
      summary: "The paper argues vice and akrasia are distinct psychological states.",
      explanation: "Across the whole paper, Irwin distinguishes the vicious agent (who acts on a settled, mistaken decision) from the akratic agent (who acts against their own better judgment) — no single passage states this thesis on its own.",
      annotationType: "context",
      relationship: "interpretive_aid",
      readerLevel: null,
      confidence: 0.68,
    },
  ]);

  await db.insert(docFootnotes).values({
    runId: run.id,
    marker: "1",
    text: "Adapted from Aquinas on sin from passion, ignorance, and deliberate badness.",
    kind: "authorial",
    source: "grobid",
  });

  // Three records describing ONE work, plus a genuinely different work. This is
  // the shape a real run produces and the reason work-level grouping exists.
  const inserted = await db
    .insert(researchResources)
    .values([
      {
        runId: run.id, title: "Ethics with Aristotle", provider: "crossref", resourceType: "book",
        isbn: "9780195085600", year: 1991, authors: ["Sarah Broadie"], normalizedKey: "isbn:9780195085600",
        workKey: "work:aristotle ethics with:broadie", workRole: "primary" as const,
        workCanonicalTitle: "Ethics with Aristotle", workAuthorSurname: "broadie", workEvidence: "title/author match",
      },
      {
        runId: run.id, title: "[Recensão a] Ethics with Aristotle", provider: "crossref", resourceType: "article",
        doi: "10.9999/review-1", authors: ["A Reviewer"], normalizedKey: "doi:10.9999/review-1",
        workKey: "work:aristotle ethics with:broadie", workRole: "review" as const,
        workCanonicalTitle: "Ethics with Aristotle", workAuthorSurname: "broadie", workEvidence: "bracketed review marker",
      },
      {
        runId: run.id, title: "Ethics with Aristotle, 2nd edition", provider: "openlibrary", resourceType: "book",
        year: 2002, authors: ["Sarah Broadie"], normalizedKey: "title:aristotle ethics with:broadie:2002",
        workKey: "work:aristotle ethics with:broadie", workRole: "edition" as const,
        workCanonicalTitle: "Ethics with Aristotle", workAuthorSurname: "broadie", workEvidence: "2nd edition",
      },
      {
        runId: run.id, title: "Aristotle on Vice", provider: "openalex", resourceType: "article",
        doi: "10.1080/09608788.2015.1022855", year: 2015, authors: ["Jozef Müller"],
        normalizedKey: "doi:10.1080/09608788.2015.1022855",
        workKey: "work:aristotle vice:muller", workRole: "primary" as const,
        workCanonicalTitle: "Aristotle on Vice", workAuthorSurname: "muller", workEvidence: "title/author match",
      },
    ])
    .returning({ id: researchResources.id });

  await db.insert(credibilityAssessments).values(
    inserted.map((r, i) => ({
      resourceId: r.id,
      score: 0.9,
      authority: (i === 3 ? "A" : "B") as "A" | "B",
      relevance: 0.9,
      inspectionDepth: 1,
      evidenceStrength: 0.7,
      agreement: (i === 3 ? "strong" : "insufficient") as "strong" | "insufficient",
      rationale: "seeded",
    })),
  );

  const spans = await db
    .insert(evidenceSpans)
    .values([
      { runId: run.id, resourceId: inserted[3].id, quote: "Vice remains a state on which one decides." },
      { runId: run.id, resourceId: inserted[0].id, quote: "The vicious agent's soul is not harmonious." },
    ])
    .returning({ id: evidenceSpans.id });

  const [note] = await db
    .insert(generatedNotes)
    .values({
      runId: run.id,
      evidenceSpanId: spans[0].id,
      noteType: "commentary",
      body: "Irwin reads vice as reason subordinated to antecedent inclination rather than absent.",
      confidence: 0.72,
    })
    .returning({ id: generatedNotes.id });
  const [claim] = await db
    .insert(generatedClaims)
    .values({
      runId: run.id,
      noteId: note.id,
      text: "Vice involves decision, so it cannot be equated with akrasia.",
      claimType: "interpretive",
      agreement: "contested",
      confidence: 0.66,
    })
    .returning({ id: generatedClaims.id });
  // Both sides, so the reader's evidence drill-down has something to contrast.
  await db.insert(claimEvidence).values([
    { claimId: claim.id, evidenceSpanId: spans[0].id, stance: "supports" },
    { claimId: claim.id, evidenceSpanId: spans[1].id, stance: "contradicts" },
  ]);

  await db.insert(providerAttempts).values([
    { runId: run.id, provider: "crossref", status: "queried" as const, queries: ["vice and reason"], resultCount: 12, inspectionDepth: 1, latencyMs: 210 },
    { runId: run.id, provider: "googlebooks", status: "rate_limited" as const, queries: ["ethics with aristotle"], resultCount: 0, inspectionDepth: 0, latencyMs: 90 },
    { runId: run.id, provider: "mastodon", status: "disabled" as const, queries: [], resultCount: 0, inspectionDepth: 0, latencyMs: 0 },
  ]);

  return { workId: work.id, documentId: doc.id, runId: run.id };
}

/**
 * Seeds a ready work + document plus two globally-shared concepts, each
 * linked to the work via a `work -[presupposes]-> concept` graph edge — the
 * shape Phase 9.4's diagnostic reads (`apps/web/src/app/api/works/[workId]/
 * diagnostic/route.ts`). Concepts use a random slug per test run so repeat
 * runs never collide on the catalog's unique slug constraint.
 *
 * Seeded directly rather than produced by the real v3 pipeline for the same
 * CI-safety reason as `seedPublishedEdition`: no worker, no live model call.
 */
export async function seedWorkWithConcepts(
  userId: string,
  opts: {
    existingMastery?: { conceptIndex: 0 | 1; score: number; source: "explicit" | "diagnostic" | "inferred" };
    /** Reuse an existing concept pair (e.g. from a prior call) instead of
     *  creating new ones — for testing two works that share a concept. */
    reuseConceptIds?: [string, string];
    title?: string;
    readingStatus?: "planned" | "reading" | "completed" | "abandoned";
  } = {},
): Promise<{ workId: string; documentId: string; conceptIds: [string, string] }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.title ?? "Nicomachean Ethics", authorName: "Aristotle" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/concepts.txt`,
      originalFilename: "concepts.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "Akrasia is weakness of will. Sophrosyne is temperance.",
    })
    .returning({ id: documents.id });

  let conceptIds: [string, string];
  if (opts.reuseConceptIds) {
    conceptIds = opts.reuseConceptIds;
  } else {
    const inserted = await db
      .insert(concepts)
      .values([
        { slug: `akrasia-${suffix}`, kind: "concept", label: "Akrasia", summary: "Weakness of will — acting against one's own better judgment." },
        { slug: `sophrosyne-${suffix}`, kind: "concept", label: "Sophrosyne", summary: "Temperance, as understood in the Peripatetic tradition." },
      ])
      .returning({ id: concepts.id });
    conceptIds = [inserted[0].id, inserted[1].id];
  }

  await db.insert(graphEdges).values([
    {
      userId, sourceType: "work", sourceId: work.id, targetType: "concept", targetId: conceptIds[0],
      edgeType: "presupposes", confidence: 0.9, evidence: { role: "central", reason: "Central to the work's argument." }, createdBy: "system",
    },
    {
      userId, sourceType: "work", sourceId: work.id, targetType: "concept", targetId: conceptIds[1],
      edgeType: "presupposes", confidence: 0.7, evidence: { role: "mentioned", reason: "Contrasted with akrasia." }, createdBy: "system",
    },
  ]);

  if (opts.existingMastery) {
    await db.insert(conceptMastery).values({
      userId,
      conceptId: conceptIds[opts.existingMastery.conceptIndex],
      score: opts.existingMastery.score,
      source: opts.existingMastery.source,
      evidence: "seeded for test",
    });
  }

  if (opts.readingStatus) {
    await db.insert(readingRecords).values({ userId, workId: work.id, status: opts.readingStatus });
  }

  return { workId: work.id, documentId: doc.id, conceptIds };
}
