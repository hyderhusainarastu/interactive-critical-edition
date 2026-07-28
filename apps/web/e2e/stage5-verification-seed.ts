import {
  claimRelationships,
  db,
  debateClusterMembers,
  debateClusterRelationships,
  debateClusters,
  documents,
  evidenceChambers,
  pages,
  processingRuns,
  researchClaims,
  researchCorpusItems,
  researchGaps,
  researchHypotheses,
  researchHypothesisSources,
  researchHypothesisSupport,
  researchJobRequests,
  researchMonitorHits,
  researchMonitors,
  researchProjectMembers,
  researchProjects,
  textBlocks,
  works,
} from "@ice/db";

/**
 * Stage 5 verification lane — NEW helper file (per this lane's own file-
 * ownership rule: may not edit `e2e/helpers.ts`, must add a new helper file
 * instead). Mirrors the seeding idioms already established across
 * `research.spec.ts`/`research-hypotheses.spec.ts`/`research-monitors.spec.ts`/
 * `research-projectnav.spec.ts` (same table shapes, same "seed directly
 * against Postgres, no worker, no live model call" CI-safety discipline),
 * but composes ALL of it into ONE project so a single verification pass can
 * walk claims → relationship → cluster → chamber → hypotheses/gaps →
 * monitors → corpus without re-deriving each fixture shape from scratch.
 *
 * Deliberately does not seed `detect_relationships`/`cluster_debates`
 * `research_job_request` rows as `complete` with a real worker-computed
 * relationship count baked in twice — the relationship/cluster/chamber rows
 * below ARE the "already ran" state the pipeline stepper and Jobs panel are
 * supposed to read from the live tables (`getResearchPipelineOverview`),
 * not from a job-request row's own note text. Job-request rows here exist
 * only to give the Jobs panel job-history entries to render honestly.
 */

export interface Stage5Fixture {
  projectId: string;
  workAId: string;
  workBId: string;
  claimAId: string;
  claimBId: string;
  relationshipId: string;
  clusterId: string;
  chamberId: string;
  hypothesisId: string;
  gapId: string;
  corpusItemId: string;
  corpusClaimId: string;
  monitorId: string;
  monitorHitId: string;
}

async function seedAnchoredWork(ownerId: string, title: string, bodyText: string) {
  const [work] = await db.insert(works).values({ userId: ownerId, title, authorName: "Test Author" }).returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId: ownerId,
      workId: work.id,
      storagePath: `${ownerId}/${work.id}/edition.txt`,
      originalFilename: "edition.txt",
      mimeType: "text/plain",
      fileSize: bodyText.length,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: bodyText,
    })
    .returning({ id: documents.id });
  const [run] = await db
    .insert(processingRuns)
    .values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true, degraded: false })
    .returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text: bodyText }).returning({ id: pages.id });
  const [block] = await db.insert(textBlocks).values({ pageId: page.id, blockOrder: 0, kind: "body", text: bodyText }).returning({ id: textBlocks.id });
  return { workId: work.id, documentId: doc.id, runId: run.id, blockId: block.id };
}

export async function seedStage5Fixture(ownerId: string, suffix: string): Promise<Stage5Fixture> {
  const [project] = await db
    .insert(researchProjects)
    .values({ userId: ownerId, title: `Stage 5 verification project ${suffix}` })
    .returning({ id: researchProjects.id });

  const workA = await seedAnchoredWork(
    ownerId,
    `Akrasia and Knowledge ${suffix}`,
    "The akratic agent acts against knowledge because desire overrides judgment in the moment of action.",
  );
  const workB = await seedAnchoredWork(
    ownerId,
    `Virtue and Passion ${suffix}`,
    "The akratic agent never truly possesses knowledge of the good; what looks like knowledge overridden is only opinion.",
  );

  await db.insert(researchProjectMembers).values([
    { projectId: project.id, memberType: "work", workId: workA.workId, role: "central" },
    { projectId: project.id, memberType: "work", workId: workB.workId, role: "central" },
  ]);

  const [claimA] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workA.workId,
      processingRunId: workA.runId,
      textBlockId: workA.blockId,
      quote: "desire overrides judgment",
      prefix: "because ",
      suffix: " in the moment",
      anchorState: "anchored",
      claimText: "The akratic agent acts against genuine knowledge because desire overrides judgment.",
      claimNature: "interpretive",
      confidence: "high",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "acts against knowledge because desire overrides judgment",
      excerptVerified: true,
      contentHash: `stage5-claim-a-${suffix}`,
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const [claimB] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workB.workId,
      processingRunId: workB.runId,
      textBlockId: workB.blockId,
      quote: "only opinion",
      prefix: "overridden is ",
      suffix: ".",
      anchorState: "anchored",
      claimText: "The akratic agent never truly possesses knowledge; what is overridden is only opinion.",
      claimNature: "interpretive",
      confidence: "medium",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "what looks like knowledge overridden is only opinion",
      excerptVerified: true,
      contentHash: `stage5-claim-b-${suffix}`,
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const [claimLoId, claimHiId] = [claimA.id, claimB.id].sort();
  const [relationship] = await db
    .insert(claimRelationships)
    .values({
      userId: ownerId,
      projectId: project.id,
      claimLoId,
      claimHiId,
      valence: "contradiction",
      category: "theoretical",
      judgeBranch: "humanities",
      strongerSide: "neither",
      explanation: "One claim treats akrasia as knowledge overridden by desire; the other denies real knowledge was ever present.",
      resolution: "Compare both readings' account of what 'knowledge' means in the akratic case.",
      engagement: "none_detected",
      basisHash: `stage5-basis-${suffix}`,
      promptVersion: "seed-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: claimRelationships.id });

  const [cluster] = await db
    .insert(debateClusters)
    .values({
      userId: ownerId,
      projectId: project.id,
      name: `Does the akratic agent know? ${suffix}`,
      researchQuestion: "Does the akratic agent know what they are doing?",
      memberHash: `stage5-member-hash-${suffix}`,
      edgeCount: 1,
      counts: { contradiction: 1, support: 0, nuance: 0 },
      status: "active",
      hidden: false,
      promptVersion: "seed-v1",
      provider: "seed",
      model: "seed",
    })
    .returning({ id: debateClusters.id });

  await db.insert(debateClusterMembers).values([
    { clusterId: cluster.id, claimId: claimA.id },
    { clusterId: cluster.id, claimId: claimB.id },
  ]);
  await db.insert(debateClusterRelationships).values({ clusterId: cluster.id, claimRelationshipId: relationship.id });

  const [chamber] = await db
    .insert(evidenceChambers)
    .values({
      userId: ownerId,
      projectId: project.id,
      clusterId: cluster.id,
      question: "Does the akratic agent know what they are doing?",
      sharedGround: "Both readings agree the akratic agent acts against their own better course.",
      pointOfDivergence: "One reading keeps real knowledge in play and overridden; the other denies it was ever really knowledge.",
      possibleReconciliation: "Distinguish occurrent from dispositional knowledge in the akratic moment.",
      unresolvedQuestion: "Whether 'knowledge overridden' is coherent or merely a manner of speaking.",
      missingEvidence: "A shared criterion for what counts as 'really knowing' in the moment of action.",
      nextAction: "Compare both readings against the Nicomachean Ethics VII discussion directly.",
      basisHash: `stage5-chamber-basis-${suffix}`,
      promptVersion: "evidence-chamber-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: evidenceChambers.id });

  const [hypothesis] = await db
    .insert(researchHypotheses)
    .values({
      userId: ownerId,
      projectId: project.id,
      question: null,
      statement: "Akrasia is best explained as a breakdown between occurrent and dispositional knowledge, not as knowledge simply absent.",
      rationale: "Both readings converge once 'knowledge' is split into what is actively attended to versus what is merely retained.",
      methodology: "Compare both works' treatment of occurrent vs. dispositional knowledge in the akratic case.",
      challenges: ["Requires reconciling divergent translations of 'knowledge' across both works."],
      grounding: "detected_conflicts",
      noveltyDistance: 0.79,
      noveltyTier: "high",
      noveltyEmbeddingModel: "text-embedding-3-small",
      noveltyCorpus: "project_claims:2",
      runHash: `stage5-hyp-run-hash-${suffix}`,
      promptVersion: "hypothesis-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: researchHypotheses.id });
  await db.insert(researchHypothesisSources).values({ hypothesisId: hypothesis.id, claimRelationshipId: relationship.id });
  await db.insert(researchHypothesisSupport).values([
    { hypothesisId: hypothesis.id, workId: workA.workId, corpusItemId: null },
    { hypothesisId: hypothesis.id, workId: workB.workId, corpusItemId: null },
  ]);

  const [gap] = await db
    .insert(researchGaps)
    .values({
      userId: ownerId,
      projectId: project.id,
      debateClusterId: cluster.id,
      description: `"Does the akratic agent know? ${suffix}" contains 1 unresolved contradiction with no reconciling account yet recorded — the open question is: Does the akratic agent know what they are doing?`,
      unresolvedContradictionCount: 1,
    })
    .returning({ id: researchGaps.id });

  const [corpusItem] = await db
    .insert(researchCorpusItems)
    .values({
      userId: ownerId,
      source: "semanticscholar",
      externalId: `stage5-corpus-${suffix}`,
      dedupKey: `title:stage-5-verification-corpus-item-${suffix}`,
      title: `A Reading of Akrasia ${suffix}`,
      authors: ["Corpus Author"],
      year: 2018,
      doi: null,
      url: "https://example.com/stage5-corpus-item",
      abstract: "This paper surveys competing accounts of akratic knowledge and finds both readings incomplete.",
      venue: "Journal of Stage 5 Testing",
      raw: {},
    })
    .returning({ id: researchCorpusItems.id });
  await db.insert(researchProjectMembers).values({ projectId: project.id, memberType: "corpus_item", corpusItemId: corpusItem.id, role: "supporting" });

  const [corpusClaim] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      corpusItemId: corpusItem.id,
      anchorState: "unanchored",
      claimText: "Both hylomorphic and intellectualist readings of akrasia leave the moment of action under-described.",
      claimNature: "interpretive",
      confidence: "medium",
      section: "Abstract",
      sourceScope: "abstract",
      supportingExcerpt: "both readings incomplete",
      excerptVerified: true,
      contentHash: `stage5-corpus-claim-${suffix}`,
      promptVersion: "e2e-seed-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const [monitor] = await db
    .insert(researchMonitors)
    .values({
      userId: ownerId,
      projectId: project.id,
      monitorType: "topic",
      query: `akrasia and practical knowledge ${suffix}`,
      cadence: "weekly",
    })
    .returning({ id: researchMonitors.id });
  const [hit] = await db
    .insert(researchMonitorHits)
    .values({
      monitorId: monitor.id,
      dedupKey: `title:stage-5-monitor-hit-${suffix}`,
      title: `A New Paper on Akrasia ${suffix}`,
      authors: ["Some Author"],
      year: 2025,
      venue: "Journal of Stage 5 Testing",
      url: "https://example.com/stage5-monitor-hit",
      provider: "semanticscholar",
      dismissedAt: null,
    })
    .returning({ id: researchMonitorHits.id });

  await db.insert(researchJobRequests).values([
    {
      userId: ownerId,
      jobType: "extract_claims",
      scope: { workId: workA.workId },
      idempotencyKey: `stage5-extract-a-${suffix}`,
      status: "complete",
      coverage: "full",
      note: "Extracted 1 claim from 1 chunk.",
      estimatedCostUsd: 0.01,
      actualCostUsd: 0.01,
    },
    {
      userId: ownerId,
      jobType: "extract_claims",
      scope: { workId: workB.workId },
      idempotencyKey: `stage5-extract-b-${suffix}`,
      status: "complete",
      coverage: "full",
      note: "Extracted 1 claim from 1 chunk.",
      estimatedCostUsd: 0.01,
      actualCostUsd: 0.01,
    },
    {
      userId: ownerId,
      jobType: "detect_relationships",
      scope: { projectId: project.id },
      idempotencyKey: `stage5-detect-${suffix}`,
      status: "complete",
      coverage: "full",
      note: "Judged 1 claim pair; found 1 relationship.",
      estimatedCostUsd: 0.02,
      actualCostUsd: 0.02,
    },
    {
      userId: ownerId,
      jobType: "cluster_debates",
      scope: { projectId: project.id },
      idempotencyKey: `stage5-cluster-${suffix}`,
      status: "complete",
      coverage: "full",
      note: "Formed 1 debate cluster from 1 relationship.",
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    },
  ]);

  return {
    projectId: project.id,
    workAId: workA.workId,
    workBId: workB.workId,
    claimAId: claimA.id,
    claimBId: claimB.id,
    relationshipId: relationship.id,
    clusterId: cluster.id,
    chamberId: chamber.id,
    hypothesisId: hypothesis.id,
    gapId: gap.id,
    corpusItemId: corpusItem.id,
    corpusClaimId: corpusClaim.id,
    monitorId: monitor.id,
    monitorHitId: hit.id,
  };
}

// No standalone cleanup export: every table this fixture writes to (works,
// research_project, research_claim, claim_relationship, debate_cluster,
// evidence_chamber, research_hypothesis, research_gap, research_corpus_item,
// research_monitor, research_job_request — and research_revision, written
// only by correction actions taken against this fixture, not by the seed
// itself) cascades on `user_id` (verified by direct read of
// `packages/db/src/schema.ts`), so `deleteTestUser(email)` from
// `./helpers` is the complete, sufficient cleanup path — no separate sweep
// needed here.

void crypto;
