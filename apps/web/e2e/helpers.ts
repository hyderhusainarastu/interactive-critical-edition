import {
  aiUsageLogs,
  annotations,
  bibliographicRecords,
  bookmarks,
  cancelQueuedJobsForDocuments,
  claimEvidence,
  concepts,
  conceptMastery,
  credibilityAssessments,
  db,
  documentApparatus,
  docFootnotes,
  documents,
  editionRelations,
  evidenceSpans,
  generatedClaims,
  generatedNotes,
  graphEdges,
  highlights,
  learningResources,
  notes,
  pages,
  passageAnnotations,
  passwordResetTokens,
  processingRuns,
  providerAttempts,
  readingRecords,
  researchResources,
  researchResourceContents,
  resourceProvenance,
  resourceRoles,
  termOccurrences,
  termVariants,
  textBlocks,
  users,
  workIdentities,
  works,
} from "@ice/db";
import { deleteDocumentFile } from "@ice/ingestion";
import { generateToken } from "@/lib/tokens";
import type { Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

/**
 * Seeds a password-reset token exactly the way `requestPasswordReset` does
 * (same `generateToken()` hashing), so a test can drive the real
 * `/reset-password?token=...` UI end to end without needing the raw token
 * from the console-logged email (by design, only the SHA-256 hash is ever
 * stored — see `docs/PROJECT-LOG.md`'s tokens note). This is setup, not the
 * thing under test: token verification/expiry and the reset form itself are
 * exercised for real through the browser.
 */
export async function seedPasswordResetToken(email: string): Promise<string> {
  const { raw, hash } = generateToken();
  await db.insert(passwordResetTokens).values({
    identifier: email.toLowerCase(),
    token: hash,
    expires: new Date(Date.now() + 60 * 60 * 1000),
  });
  return raw;
}

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
 * Same gap applies to pg-boss: any still-queued `extract-text`/
 * `analyze-work` job for one of this user's documents survives the
 * user delete (pgboss.job has no FK to document either) and later
 * fails noisily as "Document not found" once a worker dequeues it —
 * found via a local worker boot draining hours of these from prior
 * test runs during the Phase 19 backend/data audit (D-19-2).
 *
 * D-20-65: `work_identity`/`learning_resource` are shared, unscoped catalog
 * tables with no user FK at all (same design precedent as
 * `bibliographic_record` — see PROJECT-LOG Design Decisions), so nothing in
 * the user-delete cascade ever reaches them, and every seed helper below
 * that creates one leaks it into the shared local Postgres forever (found
 * at 1,500+/1,973+ rows respectively before this fix). Every one of those
 * helpers tags its rows with a recognizable test-only key so a sweep can
 * find them without guessing: `work:test:...`/`work:graph-test:...`
 * `work_identity.work_key`s, and `title:...`/`seeded-lr-...`
 * `learning_resource.normalized_key`s. Production's real identity keys
 * (`work:<hash>` from `apps/worker/src/analyze.ts`'s `identity.key`) never
 * match either pattern, so this sweep can never touch real canonical data
 * even if this helper were ever pointed at a non-test database.
 */
const TEST_WORK_IDENTITY_KEY_PATTERN = /^work:(test|graph-test):/;
const TEST_LEARNING_RESOURCE_KEY_PATTERN = /^(title:|seeded-lr-)/;

export async function deleteTestUser(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return;

  const docs = await db
    .select({ id: documents.id, storagePath: documents.storagePath })
    .from(documents)
    .where(eq(documents.userId, user.id));

  await Promise.all(docs.map((d) => deleteDocumentFile(d.storagePath).catch(() => {})));
  await cancelQueuedJobsForDocuments(docs.map((d) => d.id));

  // Collect every work_identity this user's own works reference, BEFORE the
  // cascading delete removes those works — this is the only place they're
  // still reachable via `works.work_identity_id`.
  const ownedIdentityRows = await db
    .selectDistinct({ id: workIdentities.id })
    .from(works)
    .innerJoin(workIdentities, eq(works.workIdentityId, workIdentities.id))
    .where(eq(works.userId, user.id));
  const candidateIdentityIds = new Set(ownedIdentityRows.map((r) => r.id));

  // A recommended (not-owned) learning_resource carries its OWN canonical
  // identity directly on `learning_resource.work_identity_id`, reached only
  // via `resource_role.work_identity_id` pointing at one of the identities
  // above (see `seedLibraryItemForSourceAttach`) — collect both directions
  // before anything is deleted.
  let candidateLearningResourceIds: string[] = [];
  if (candidateIdentityIds.size > 0) {
    const roleRows = await db
      .selectDistinct({ id: resourceRoles.learningResourceId })
      .from(resourceRoles)
      .where(inArray(resourceRoles.workIdentityId, [...candidateIdentityIds]));
    candidateLearningResourceIds = roleRows.map((r) => r.id);

    if (candidateLearningResourceIds.length > 0) {
      const ownIdentityRows = await db
        .select({ id: learningResources.workIdentityId })
        .from(learningResources)
        .where(inArray(learningResources.id, candidateLearningResourceIds));
      for (const row of ownIdentityRows) if (row.id) candidateIdentityIds.add(row.id);
    }
  }

  await db.delete(users).where(eq(users.id, user.id));

  // Only delete a candidate if (a) its key still matches the test-only
  // pattern and (b) no work anywhere still references it — the second
  // check is what keeps a concurrent test's still-live fixture (same key
  // pattern, different random suffix) safe from this sweep.
  for (const identityId of candidateIdentityIds) {
    const [identity] = await db.select({ workKey: workIdentities.workKey }).from(workIdentities).where(eq(workIdentities.id, identityId)).limit(1);
    if (!identity || !TEST_WORK_IDENTITY_KEY_PATTERN.test(identity.workKey)) continue;
    const [stillOwned] = await db.select({ id: works.id }).from(works).where(eq(works.workIdentityId, identityId)).limit(1);
    if (stillOwned) continue;
    // Cascades any resource_role still pointing at this identity.
    await db.delete(workIdentities).where(eq(workIdentities.id, identityId));
  }

  for (const learningResourceId of candidateLearningResourceIds) {
    const [resource] = await db
      .select({ normalizedKey: learningResources.normalizedKey })
      .from(learningResources)
      .where(eq(learningResources.id, learningResourceId))
      .limit(1);
    if (!resource || !TEST_LEARNING_RESOURCE_KEY_PATTERN.test(resource.normalizedKey)) continue;
    const [stillReferenced] = await db.select({ id: resourceRoles.id }).from(resourceRoles).where(eq(resourceRoles.learningResourceId, learningResourceId)).limit(1);
    if (stillReferenced) continue;
    await db.delete(learningResources).where(eq(learningResources.id, learningResourceId));
  }
}

/**
 * Drives a single-file upload through the real `/upload` batch UI and
 * returns the resulting work id. Phase 14 replaced the old "upload
 * redirects straight to `/works/<id>`" flow with a batch-status list that
 * never navigates away on its own — the user clicks an "Open work" link
 * once the file reaches `queued_for_processing` — but three older,
 * manual-only Phase 3/4/5 specs (`reader`, `annotations`, `roadmap`) still
 * assumed the pre-Phase-14 redirect and were silently failing every run
 * since (`page.waitForURL` timing out after 2 minutes with no useful
 * signal beyond "navigation never happened"). Found and fixed during the
 * Phase 19 user-journey audit (D-19-5) — extracted here once rather than
 * patched three times so a future upload-UI change only needs updating in
 * one place.
 */
export async function uploadOneFileViaUI(page: Page, filePath: string): Promise<string> {
  await page.goto("/upload");
  await page.getByLabel("Choose files to upload").setInputFiles(filePath);
  const openWork = page.locator("[data-upload-item]").getByRole("link", { name: "Open work" });
  await openWork.waitFor({ state: "visible", timeout: 45000 });
  const href = await openWork.getAttribute("href");
  if (!href) throw new Error("Open work link had no href");
  await page.goto(href);
  return href.split("/works/")[1];
}

/**
 * Uploads one file via the real UI, then handles the metadata-review step
 * — but that step is conditional, not guaranteed: `apps/worker/src/index.ts`
 * (`autoReady`) skips straight to `ready` whenever extraction's title
 * confidence is high (>=0.9) and a title was detected, which a clean
 * "Title on its own line" fixture reliably triggers. Older manual-only
 * specs (`reader`, `annotations`, `roadmap`) assumed the confirm form
 * always appears, so under pipeline v2 (this project's actual production
 * pipeline — local dev defaults to the legacy v1, see the Phase 19
 * environment-drift finding, D-19-6) they'd hang waiting for a form that
 * had already been skipped. Races both outcomes rather than assuming one.
 */
export async function uploadAndConfirmViaUI(page: Page, filePath: string, title: string): Promise<string> {
  const workId = await uploadOneFileViaUI(page, filePath);
  const confirmForm = page.getByText("Confirm or correct");
  const openReaderLink = page.getByRole("link", { name: "Open reader" });
  // Generous: under pipeline v2+, `handleEditionExtraction` runs the ENTIRE
  // pipeline (extraction, GROBID, a live multi-provider research pass,
  // classification) as one job BEFORE the document ever reaches
  // needs_review/ready — confirmed by reading apps/worker/src/index.ts,
  // where analyzeEditionRun() (the expensive stage) runs before the
  // autoReady decision. So "Confirm or correct" (or its auto-ready
  // bypass — see this function's own doc comment) can legitimately take
  // well over a minute to appear, not because anything is slow/broken but
  // because that is the real, current shape of the v2+ pipeline — a
  // genuine behavior change from v1's old "confirm fast, analyze in the
  // background" split (D-19-6).
  await Promise.race([
    confirmForm.waitFor({ timeout: 150000 }),
    openReaderLink.waitFor({ timeout: 150000 }),
  ]).catch(() => {});
  if (await confirmForm.isVisible()) {
    await page.locator('input[name="title"]').fill(title);
    await page.getByRole("button", { name: "Confirm and add to library" }).click();
  }
  await openReaderLink.waitFor({ timeout: 30000 });
  return workId;
}

/**
 * Seeds a work + document directly in one of the four terminal/in-flight
 * `processing_status` states (Phase 19 work-status interaction inventory),
 * bypassing the worker entirely — the same CI-safety rationale as every
 * other seed helper here, but specifically so needs_review/processing/failed
 * fixtures never depend on a real (live-network-bound, potentially costly)
 * pipeline run finishing, per D-19-6's finding. `extractedText` is
 * deliberately citation-pattern-free (no parentheticals, reference-list
 * heading, or numbered markers) so that if a test does trigger the real
 * `analyze-work` queue against this fixture (e.g. via `/confirm`), the
 * legacy classifier's `extractCitations()` finds zero candidates and the
 * run completes with zero AI spend rather than silently costing money.
 */
export async function seedWorkInStatus(
  userId: string,
  status: "needs_review" | "processing" | "failed" | "ready",
  opts: {
    title?: string;
    extractedTitle?: string;
    extractedAuthor?: string;
    processingError?: string;
    processingRun?: {
      pipelineVersion?: string;
      stage?: string;
      runStatus?: "pending" | "running" | "complete" | "failed";
      structureState?: "full" | "limited";
    };
  } = {},
): Promise<{ workId: string; documentId: string }> {
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.title ?? "Work-status fixture", authorName: "Fixture Author" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/nonexistent-fixture.txt`,
      originalFilename: "nonexistent-fixture.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: status,
      extractedTitle: opts.extractedTitle ?? null,
      extractedAuthor: opts.extractedAuthor ?? null,
      processingError: opts.processingError ?? null,
      extractedText: "Seeded plain text for a work-status Playwright fixture, no citations here.",
    })
    .returning({ id: documents.id });

  if (opts.processingRun) {
    await db.insert(processingRuns).values({
      documentId: doc.id,
      version: 1,
      pipelineVersion: opts.processingRun.pipelineVersion ?? "v2",
      status: opts.processingRun.runStatus ?? "running",
      stage: opts.processingRun.stage ?? null,
      structureState: opts.processingRun.structureState ?? "limited",
      isPublished: false,
    });
  }

  return { workId: work.id, documentId: doc.id };
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
  termId: string;
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
  // Phase 19 audit (IDOR matrix completeness): the terms sub-route had no
  // owned resource to probe against — one suggested term pair is enough.
  const [term] = await db
    .insert(termVariants)
    .values({ documentId: doc.id, originalScript: "Privat", transliteration: "Private", language: "de" })
    .returning({ id: termVariants.id });

  return {
    workId: work.id,
    documentId: doc.id,
    highlightId: hl.id,
    noteId: note.id,
    bookmarkId: bm.id,
    annotationId: ann.id,
    termId: term.id,
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
  bodyBlockId: string;
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
      extractedText: "Vicious people act on decision, yet live according to passion. Vice remains a state on which one decides.",
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

  // Phase 9.7: real per-stage usage rows so getRunCostBreakdown() has
  // something to group — sums to the same 0.0421 already seeded on the run.
  await db.insert(aiUsageLogs).values([
    { runId: run.id, documentId: doc.id, task: "research", stage: "research-discovery", provider: "openai", model: "gpt-5.4-nano", promptTokens: 1200, completionTokens: 300, estimatedCostUsd: 0.03 },
    { runId: run.id, documentId: doc.id, task: "classify", stage: "classification", provider: "openai", model: "gpt-5.4-nano", promptTokens: 500, completionTokens: 100, estimatedCostUsd: 0.0121 },
  ]);

  const [page] = await db
    .insert(pages)
    .values({ runId: run.id, pageIndex: 0, isOcr: false, text: "Vicious people act on decision. Vice remains a state on which one decides." })
    .returning({ id: pages.id });
  const blocks = await db
    .insert(textBlocks)
    .values([
      { pageId: page.id, blockOrder: 0, kind: "header", text: "A Gap in Aristotle's Moral Psychology" },
      { pageId: page.id, blockOrder: 1, kind: "body", text: "Vicious people act on decision, yet live according to passion. Vice remains a state on which one decides." },
      { pageId: page.id, blockOrder: 2, kind: "footnote", marker: "1", text: "Adapted from Aquinas on sin from passion, ignorance, and deliberate badness." },
      { pageId: page.id, blockOrder: 3, kind: "bibliography", text: "Irwin, Terence. Vice and Reason." },
    ])
    .returning({ id: textBlocks.id, blockOrder: textBlocks.blockOrder });
  const bodyBlock = blocks.find((b) => b.blockOrder === 1)!;
  const footnoteBlock = blocks.find((b) => b.blockOrder === 2)!;
  const bibliographyBlock = blocks.find((b) => b.blockOrder === 3)!;

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
  await db.insert(documentApparatus).values([
    { runId: run.id, textBlockId: footnoteBlock.id, kind: "footnote", marker: "1", text: "Adapted from Aquinas on sin from passion, ignorance, and deliberate badness.", scope: { pageIndex: 0, blockOrder: 2 }, source: "structure" },
    { runId: run.id, textBlockId: bibliographyBlock.id, kind: "bibliography_entry", marker: null, text: "Irwin, Terence. Vice and Reason.", scope: { pageIndex: 0, blockOrder: 3 }, source: "structure" },
  ]);

  // Phase 19 audit (workspace preferences interaction inventory): one
  // verified term with a distinguishable transliteration, so the reader's
  // "Script display" preference has a real occurrence to swap between
  // original/transliteration for — this fixture had no such row before.
  const bodyText = "Vicious people act on decision, yet live according to passion. Vice remains a state on which one decides.";
  const termWord = "decision";
  const termStart = bodyText.indexOf(termWord);
  const [termVariant] = await db
    .insert(termVariants)
    .values({
      documentId: doc.id,
      originalScript: termWord,
      transliteration: "DECISION-XLIT",
      language: "en",
      direction: "ltr",
      verificationStatus: "verified",
      source: "system",
    })
    .returning({ id: termVariants.id });
  await db.insert(termOccurrences).values({
    termVariantId: termVariant.id,
    textBlockId: bodyBlock.id,
    startOffset: termStart,
    endOffset: termStart + termWord.length,
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

  return { workId: work.id, documentId: doc.id, runId: run.id, bodyBlockId: bodyBlock.id };
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

/**
 * Seeds ONE work carrying all four graph node types the Phase 9.7 knowledge
 * graph shows (plan §34.4): the work itself, a referenced bibliographic
 * record (`work -[cites]-> bibliographic_record`, the pre-9.7 shape),
 * a concept (`work -[presupposes]-> concept`, same shape `seedWorkWithConcepts`
 * uses), and — via a published run + page + header text_block — a section
 * outline node. All in one work so a single `/works/[workId]/graph` fetch
 * exercises every node type together. Seeded directly for the same
 * CI-safety reason as the other seed helpers: no worker, no live model call.
 */
export async function seedWorkWithGraphData(
  userId: string,
  options: {
    title?: string;
    withRelatedSource?: boolean;
    withPublicSources?: boolean;
    conceptId?: string;
    /** Adds a SECOND `graph_edge` of a different edge type between the same
     *  (work, bib) pair — the multi-edge-type shape D-21-1's relation-filter
     *  edge test needs (a `cites` and an `influences` edge can coexist for
     *  one pair because citation-resolution and classification write
     *  independently). */
    withSecondEdgeType?: boolean;
    /** Links the work to a `work_identity` and seeds a `learning_resource`
     *  (keyed to the same bib record) with a `resource_role` pointing at that
     *  identity — the exact eligibility shape `/library/[resourceId]`
     *  enforces, so the graph contract's `destination` field has a real,
     *  non-404 route to point at. */
    withLibraryResource?: boolean;
  } = {},
): Promise<{ workId: string; documentId: string; bibId: string; resourceId: string; relatedResourceId?: string; publicResourceIds: string[]; conceptId: string; sectionBlockId: string; libraryResourceId?: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const workTitle = options.title ?? "On the Soul";
  const [work] = await db
    .insert(works)
    .values({ userId, title: workTitle, authorName: "Aristotle" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/graph.txt`,
      originalFilename: "graph.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "The soul is the form of a natural body having life potentially.",
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
      aiCostUsd: 0.01,
      degraded: false,
    })
    .returning({ id: processingRuns.id });
  const [page] = await db
    .insert(pages)
    .values({ runId: run.id, pageIndex: 0, isOcr: false, text: "The soul is the form of a natural body." })
    .returning({ id: pages.id });
  const [sectionBlock] = await db
    .insert(textBlocks)
    .values({ pageId: page.id, blockOrder: 0, kind: "header", text: "Book II: The Nature of the Soul" })
    .returning({ id: textBlocks.id });

  const [bib] = await db
    .insert(bibliographicRecords)
    .values({ source: "crossref", title: "Physics", authors: "Aristotle", year: -350, accessStatus: "metadata_only" })
    .returning({ id: bibliographicRecords.id });
  const [resource] = await db
    .insert(researchResources)
    .values({
      runId: run.id,
      title: "Physics",
      provider: "crossref",
      resourceType: "book",
      year: -350,
      authors: ["Aristotle"],
      bibRecordId: bib.id,
      normalizedKey: `seeded-physics-${suffix}`,
      workKey: `work:physics:aristotle:${suffix}`,
      workCanonicalTitle: "Physics",
      workAuthorSurname: "aristotle",
      workEvidence: "seeded graph test",
    })
    .returning({ id: researchResources.id });
  await db.insert(credibilityAssessments).values({
    resourceId: resource.id,
    score: 0.82,
    authority: "A",
    relevance: 0.9,
    inspectionDepth: 1,
    evidenceStrength: 0.8,
    agreement: "strong",
    rationale: "seeded graph test",
  });
  await db.insert(resourceProvenance).values({
    resourceId: resource.id,
    provider: "crossref",
    query: "On the Soul Physics",
    inspectionDepth: 1,
    inspectedAt: new Date("2026-07-21T12:00:00.000Z"),
  });
  await db.insert(researchResourceContents).values({
    resourceId: resource.id,
    status: "open_access_indexed",
    sourceUrl: "https://example.test/open-physics",
    license: "CC BY 4.0",
    licenseEvidence: { providerLicense: "CC BY 4.0", seeded: true },
    text: "An openly licensed source excerpt for graph provenance testing.",
    contentHash: `seeded-hash-${suffix}`,
    retrievedAt: new Date("2026-07-21T12:00:01.000Z"),
  });
  await db.insert(editionRelations).values({
    runId: run.id,
    resourceId: resource.id,
    relationType: "explicit_reference",
    depth: 1,
    importance: 0.82,
    evidence: { category: "explicit_reference", sourceText: "Physics is cited in the source work." },
    confidence: 0.85,
  });
  let relatedResourceId: string | undefined;
  if (options.withRelatedSource) {
    const [review] = await db.insert(researchResources).values({
      runId: run.id,
      title: "Physics: a peer review",
      url: "https://example.test/physics-review",
      provider: "openalex",
      resourceType: "article",
      accessStatus: "metadata_only",
      year: -349,
      authors: ["Theophrastus"],
      normalizedKey: `seeded-physics-review-${suffix}`,
      workKey: `work:physics:aristotle:${suffix}`,
      workRole: "review",
      workCanonicalTitle: "Physics",
      workAuthorSurname: "aristotle",
      workEvidence: "seeded review grouping",
    }).returning({ id: researchResources.id });
    relatedResourceId = review.id;
    await db.insert(credibilityAssessments).values({ resourceId: review.id, score: 0.71, authority: "B", peerReviewed: true });
    await db.insert(resourceProvenance).values({ resourceId: review.id, provider: "openalex", query: "Physics review", inspectionDepth: 1, inspectedAt: new Date("2026-07-21T12:01:00.000Z") });
    await db.insert(editionRelations).values({
      runId: run.id,
      resourceId: review.id,
      relatedResourceId: resource.id,
      relationType: "review_of",
      depth: 1,
      importance: 0.71,
      evidence: { provenance: "seeded shared work identity" },
      confidence: 1,
    });
  }
  const publicResourceIds: string[] = [];
  if (options.withPublicSources) {
    for (const [provider, title, resourceType, authority] of [
      ["youtube", "A relevant lecture on Aristotle", "video", "D"],
      ["mastodon", "A relevant Mastodon discussion", "social_post", "E"],
      ["bluesky", "A relevant Bluesky discussion", "social_post", "E"],
    ] as const) {
      const [publicSource] = await db.insert(researchResources).values({
        runId: run.id,
        title,
        url: `https://example.test/${provider}/${suffix}`,
        provider,
        resourceType,
        accessStatus: "metadata_only",
        normalizedKey: `seeded-${provider}-${suffix}`,
      }).returning({ id: researchResources.id });
      publicResourceIds.push(publicSource.id);
      await db.insert(credibilityAssessments).values({ resourceId: publicSource.id, score: authority === "D" ? 0.25 : 0.1, authority, peerReviewed: false });
      await db.insert(resourceProvenance).values({ resourceId: publicSource.id, provider, query: "On the Soul relevant discussion", inspectionDepth: 0, inspectedAt: new Date("2026-07-21T12:02:00.000Z") });
      await db.insert(editionRelations).values({ runId: run.id, resourceId: publicSource.id, relationType: "supplementary_context", depth: 0, importance: 0.2, evidence: { provider, supplementary: true }, confidence: 0.5 });
    }
  }
  const concept = options.conceptId
    ? { id: options.conceptId }
    : (await db
        .insert(concepts)
        .values({ slug: `hylomorphism-${suffix}`, kind: "doctrine", label: "Hylomorphism", summary: "Matter and form as co-constituents of a substance." })
        .returning({ id: concepts.id }))[0]!;

  await db.insert(graphEdges).values([
    {
      userId, sourceType: "work", sourceId: work.id, targetType: "bibliographic_record", targetId: bib.id,
      edgeType: "cites", confidence: 0.85, evidence: { category: "explicit_reference" }, createdBy: "system",
    },
    {
      userId, sourceType: "work", sourceId: work.id, targetType: "concept", targetId: concept.id,
      edgeType: "presupposes", confidence: 0.8, evidence: { role: "central", reason: "Core doctrine of the work." }, createdBy: "system",
    },
    ...(options.withSecondEdgeType
      ? [{
          userId, sourceType: "work" as const, sourceId: work.id, targetType: "bibliographic_record" as const, targetId: bib.id,
          edgeType: "influences" as const, confidence: 0.7, evidence: { category: "conceptual_influence" }, createdBy: "system" as const,
        }]
      : []),
  ]);

  let libraryResourceId: string | undefined;
  if (options.withLibraryResource) {
    const [identity] = await db
      .insert(workIdentities)
      .values({ workKey: `work:graph-test:${suffix}`, canonicalTitle: workTitle, authorSurname: "aristotle", authors: ["Aristotle"], evidence: "seeded graph contract test" })
      .returning({ id: workIdentities.id });
    await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));
    const [libraryResource] = await db
      .insert(learningResources)
      .values({
        title: "Physics",
        normalizedKey: `seeded-lr-${suffix}`,
        resourceType: "book",
        provider: "crossref",
        authors: ["Aristotle"],
        year: -350,
        bibRecordId: bib.id,
      })
      .returning({ id: learningResources.id });
    libraryResourceId = libraryResource.id;
    await db.insert(resourceRoles).values({
      learningResourceId: libraryResource.id,
      workIdentityId: identity.id,
      relationship: "explicit_reference",
      readerLevel: null,
      rationale: "Cited directly by the source work.",
      confidence: 0.85,
      createdBy: "system",
    });
  }

  return { workId: work.id, documentId: doc.id, bibId: bib.id, resourceId: resource.id, relatedResourceId, publicResourceIds, conceptId: concept.id, sectionBlockId: sectionBlock.id, libraryResourceId };
}

/**
 * Seeds a work already linked to a `work_identity`, plus one Library item
 * recommended for it (`learning_resource` + `resource_role`) — the shape
 * `apps/worker/src/analyze.ts`'s v3-only promotion block writes (plan §34.4
 * 9.5). Concepts are real extraction output normally; the Library items here
 * are SEEDED rather than produced by the real pipeline, same CI-safety
 * reasoning as `seedWorkWithConcepts` (no worker, no live model call).
 */
export async function seedWorkWithLibraryItem(
  userId: string,
  opts: {
    title?: string;
    resourceTitle?: string;
    relationship?: "prerequisite" | "interpretive_aid" | "secondary_scholarly_recommendation";
    readingStatus?: "planned" | "reading" | "completed" | "abandoned";
    /** Reader level the seeded resource_role targets, or null for "every level" (the default, matching the prior hardcoded behavior). */
    readerLevel?: "beginner" | "undergraduate" | "advanced" | "research" | null;
  } = {},
): Promise<{ workId: string; resourceId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.title ?? "Vice and Reason", authorName: "Terence Irwin" })
    .returning({ id: works.id });
  const [identity] = await db
    .insert(workIdentities)
    .values({ workKey: `work:test:${suffix}`, canonicalTitle: opts.title ?? "Vice and Reason", authorSurname: "irwin", authors: ["Terence Irwin"], evidence: "seeded for test" })
    .returning({ id: workIdentities.id });
  await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));

  const [resource] = await db
    .insert(learningResources)
    .values({
      title: opts.resourceTitle ?? "Nicomachean Ethics",
      normalizedKey: `title:${suffix}`,
      resourceType: "book",
      provider: "openalex",
      authors: ["Aristotle"],
      year: -340,
      peerReviewed: null,
    })
    .returning({ id: learningResources.id });
  await db.insert(resourceRoles).values({
    learningResourceId: resource.id,
    workIdentityId: identity.id,
    relationship: opts.relationship ?? "prerequisite",
    readerLevel: opts.readerLevel ?? null,
    rationale: "Foundational for understanding the paper's central argument.",
    confidence: 0.8,
    createdBy: "system",
  });

  if (opts.readingStatus) {
    await db.insert(readingRecords).values({ userId, learningResourceId: resource.id, status: opts.readingStatus });
  }

  return { workId: work.id, resourceId: resource.id };
}

/**
 * Same seeding shape as `seedWorkWithLibraryItem`, but for ONE work with
 * SEVERAL `resource_role` rows across different relationship categories —
 * what curriculum.spec.ts needs to exercise multiple stages at once (plan
 * §34.4 9.6). Kept separate rather than generalizing the singular helper so
 * existing callers/signatures don't change.
 *
 * Unlike `seedWorkWithLibraryItem`, this ALSO inserts a `documents` row.
 * `/library` reads across every owned work via `getLibrary(userId)`, which
 * never needs one — but `/works/[workId]/curriculum` resolves ownership
 * through `getOwnedDocument`, an inner join against `documents`, so a work
 * with no document 404s before the curriculum view ever renders.
 */
export async function seedWorkWithLibraryItems(
  userId: string,
  workTitle: string,
  items: {
    resourceTitle: string;
    relationship: "prerequisite" | "conceptual_influence" | "explicit_reference" | "historical_context" | "optional_extension";
    resourceType?: string;
    /** resource_role confidence — the Library's per-focus relevance evidence. */
    relationshipConfidence?: number;
    /** Creates the matching run-scoped credibility evidence when supplied. */
    credibilityScore?: number;
  }[],
  opts: { createdAt?: Date } = {},
): Promise<{ workId: string; resourceIds: string[] }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [work] = await db
    .insert(works)
    .values({ userId, title: workTitle, authorName: "Terence Irwin", ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) })
    .returning({ id: works.id });
  const [document] = await db.insert(documents).values({
    userId,
    workId: work.id,
    storagePath: `${userId}/${work.id}/none.txt`,
    originalFilename: "none.txt",
    mimeType: "text/plain",
    fileSize: 100,
    processingStatus: "ready",
    analysisStatus: "complete",
    extractedText: "Seeded text for curriculum tests.",
  }).returning({ id: documents.id });
  const [identity] = await db
    .insert(workIdentities)
    .values({ workKey: `work:test:${suffix}`, canonicalTitle: workTitle, authorSurname: "irwin", authors: ["Terence Irwin"], evidence: "seeded for test" })
    .returning({ id: workIdentities.id });
  await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));

  const needsCredibility = items.some((item) => item.credibilityScore !== undefined);
  const [run] = needsCredibility
    ? await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v4", status: "complete" }).returning({ id: processingRuns.id })
    : [];

  const resourceIds: string[] = [];
  for (const [i, item] of items.entries()) {
    const [resource] = await db
      .insert(learningResources)
      .values({
      title: item.resourceTitle,
      normalizedKey: `title:${suffix}:${i}`,
        resourceType: item.resourceType ?? "book",
        provider: "openalex",
        authors: ["Aristotle"],
        year: -340,
        peerReviewed: null,
      })
      .returning({ id: learningResources.id });
    await db.insert(resourceRoles).values({
      learningResourceId: resource.id,
      workIdentityId: identity.id,
      relationship: item.relationship,
      readerLevel: null,
      rationale: "Seeded rationale text for a Playwright fixture.",
      confidence: item.relationshipConfidence ?? 0.8,
      createdBy: "system",
    });
    if (run && item.credibilityScore !== undefined) {
      const [researchResource] = await db.insert(researchResources).values({
        runId: run.id,
        title: item.resourceTitle,
        normalizedKey: `title:${suffix}:${i}`,
        provider: "openalex",
        resourceType: item.resourceType ?? "book",
      }).returning({ id: researchResources.id });
      await db.insert(credibilityAssessments).values({ resourceId: researchResource.id, score: item.credibilityScore, authority: "B" });
    }
    resourceIds.push(resource.id);
  }

  return { workId: work.id, resourceIds };
}

/**
 * Seeds one owned work plus one `learning_resource` with every field the
 * Library search bar (plan §20.1) is required to match against — title,
 * authors, venue, year, DOI, ISBN, and resource type — all independently
 * settable so a test can search on exactly one field at a time. Kept as a
 * separate helper (append-only convention for this sub-phase) rather than
 * widening `seedWorkWithLibraryItem`'s existing signature.
 */
export async function seedSearchableLibraryItem(
  userId: string,
  opts: {
    workTitle?: string;
    resourceTitle: string;
    authors?: string[];
    venue?: string | null;
    year?: number | null;
    doi?: string | null;
    isbn?: string | null;
    resourceType?: string;
  },
): Promise<{ workId: string; resourceId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.workTitle ?? "Search Fixture Work", authorName: "Terence Irwin" })
    .returning({ id: works.id });
  const [identity] = await db
    .insert(workIdentities)
    .values({
      workKey: `work:test:${suffix}`,
      canonicalTitle: opts.workTitle ?? "Search Fixture Work",
      authorSurname: "irwin",
      authors: ["Terence Irwin"],
      evidence: "seeded for test",
    })
    .returning({ id: workIdentities.id });
  await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));

  const [resource] = await db
    .insert(learningResources)
    .values({
      title: opts.resourceTitle,
      normalizedKey: `title:${suffix}`,
      resourceType: opts.resourceType ?? "book",
      provider: "openalex",
      authors: opts.authors ?? ["Aristotle"],
      venue: opts.venue ?? null,
      year: opts.year ?? null,
      doi: opts.doi ?? null,
      isbn: opts.isbn ?? null,
      peerReviewed: null,
    })
    .returning({ id: learningResources.id });
  await db.insert(resourceRoles).values({
    learningResourceId: resource.id,
    workIdentityId: identity.id,
    relationship: "prerequisite",
    readerLevel: null,
    rationale: "Seeded rationale text for a Playwright search fixture.",
    confidence: 0.8,
    createdBy: "system",
  });

  return { workId: work.id, resourceId: resource.id };
}

/**
 * Phase 20.4: a Library entry (`learning_resource`) recommended for one of
 * the user's own uploads, with its OWN `work_identity` set — the identity
 * "Upload source text" should attach a newly-uploaded document to. Two
 * DISTINCT identities are seeded deliberately: `recommendingWork`'s own
 * identity (what `resource_role.work_identity_id` targets — "recommended
 * FOR this owned work") is not the same thing as the resource's own
 * canonical identity (what `learning_resource.work_identity_id` records —
 * "this resource, if uploaded, IS this canonical work"). Conflating the two
 * would make every recommended-for chip look like "the user already owns
 * this," which is exactly the bug this seeding shape exists to avoid.
 */
export async function seedLibraryItemForSourceAttach(
  userId: string,
  opts: {
    resourceTitle?: string;
    recommendingWorkTitle?: string;
    /** When true, also creates an owned work + document sharing the
     *  resource's own identity — simulating "the user already has the full
     *  text," so the attach affordance must not be offered. */
    alreadyOwned?: boolean;
  } = {},
): Promise<{ resourceId: string; recommendingWorkId: string; resourceWorkIdentityId: string; ownedWorkId: string | null }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const resourceTitle = opts.resourceTitle ?? "Nicomachean Ethics";

  const [recommendingWork] = await db
    .insert(works)
    .values({ userId, title: opts.recommendingWorkTitle ?? "Recommending Upload", authorName: "Test Author" })
    .returning({ id: works.id });
  const [recommendingIdentity] = await db
    .insert(workIdentities)
    .values({ workKey: `work:test:recommending:${suffix}`, canonicalTitle: opts.recommendingWorkTitle ?? "Recommending Upload", evidence: "seeded for test" })
    .returning({ id: workIdentities.id });
  await db.update(works).set({ workIdentityId: recommendingIdentity.id }).where(eq(works.id, recommendingWork.id));

  const [resourceIdentity] = await db
    .insert(workIdentities)
    .values({ workKey: `work:test:resource:${suffix}`, canonicalTitle: resourceTitle, evidence: "seeded for test" })
    .returning({ id: workIdentities.id });

  const [resource] = await db
    .insert(learningResources)
    .values({
      workIdentityId: resourceIdentity.id,
      title: resourceTitle,
      normalizedKey: `title:resource:${suffix}`,
      resourceType: "book",
      provider: "openalex",
      authors: ["Aristotle"],
      year: -340,
      peerReviewed: null,
    })
    .returning({ id: learningResources.id });

  await db.insert(resourceRoles).values({
    learningResourceId: resource.id,
    workIdentityId: recommendingIdentity.id,
    relationship: "prerequisite",
    readerLevel: null,
    rationale: "Seeded rationale for a source-attach Playwright fixture.",
    confidence: 0.8,
    createdBy: "system",
  });

  let ownedWorkId: string | null = null;
  if (opts.alreadyOwned) {
    const [ownedWork] = await db
      .insert(works)
      .values({ userId, title: resourceTitle, workIdentityId: resourceIdentity.id })
      .returning({ id: works.id });
    await db.insert(documents).values({
      userId,
      workId: ownedWork.id,
      storagePath: `${userId}/${ownedWork.id}/already-owned.txt`,
      originalFilename: "already-owned.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      extractedText: "Already-owned full text for a source-attach eligibility fixture.",
    });
    ownedWorkId = ownedWork.id;
  }

  return { resourceId: resource.id, recommendingWorkId: recommendingWork.id, resourceWorkIdentityId: resourceIdentity.id, ownedWorkId };
}
