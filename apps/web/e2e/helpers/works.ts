import {
  aiUsageLogs,
  annotations,
  bibliographicRecords,
  bookmarks,
  claimEvidence,
  credibilityAssessments,
  db,
  documentApparatus,
  docFootnotes,
  documents,
  evidenceSpans,
  generatedClaims,
  generatedNotes,
  highlights,
  notes,
  pages,
  passageAnnotations,
  processingRuns,
  providerAttempts,
  researchResources,
  termOccurrences,
  termVariants,
  textBlocks,
  works,
} from "@ice/db";

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
      /** Per-source loop position (Lane F), only set when the fixture wants
       * to simulate the worker mid-way through the up-to-120-source
       * discovery/classification loop. */
      stageSourceIndex?: number;
      stageSourceTotal?: number;
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
      stageSourceIndex: opts.processingRun.stageSourceIndex ?? null,
      stageSourceTotal: opts.processingRun.stageSourceTotal ?? null,
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
