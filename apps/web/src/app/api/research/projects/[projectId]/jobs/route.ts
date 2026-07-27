import { isCorpusProvider, type CorpusProvider } from "@ice/research";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatchImportCorpusJob } from "@/lib/research/corpus";
import { dispatchGenerateHypothesesJob } from "@/lib/research/hypotheses";
import {
  dispatchClusterDebatesJob,
  dispatchDetectRelationshipsJob,
  dispatchExtractClaimsJob,
  dispatchExtractClaimsJobForCorpusItem,
  dispatchSynthesizeChamberJob,
  listResearchJobRequestsForProject,
} from "@/lib/research/jobs";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

const postSchema = z.discriminatedUnion("jobType", [
  z
    .object({
      jobType: z.literal("extract_claims"),
      // Exactly one of workId/corpusItemId — the same XOR the worker's
      // `research_claim_exactly_one_source` CHECK enforces at the DB level
      // (Phase 30 fix lane, D-25-13: the corpus-item abstract-source path).
      workId: z.string().uuid().optional(),
      corpusItemId: z.string().uuid().optional(),
      confirm: z.boolean().default(false),
    })
    .refine((d) => Boolean(d.workId) !== Boolean(d.corpusItemId), { message: "Exactly one of workId or corpusItemId is required." }),
  z.object({
    jobType: z.literal("synthesize_chamber"),
    clusterId: z.string().uuid(),
  }),
  // Phase 30 gap-fix lane: project-scoped, no additional fields beyond
  // `jobType`/`confirm` — everything the dispatcher needs comes from the
  // route's own `projectId` param.
  z.object({
    jobType: z.literal("detect_relationships"),
    confirm: z.boolean().default(false),
  }),
  z.object({
    jobType: z.literal("cluster_debates"),
    confirm: z.boolean().default(false),
  }),
  z.object({
    jobType: z.literal("generate_hypotheses"),
    question: z.string().trim().min(1).max(500).optional(),
    maxHypotheses: z.coerce.number().int().min(1).max(5).optional(),
    confirm: z.boolean().default(false),
  }),
  z.object({
    jobType: z.literal("import_corpus"),
    // A bounded batch of search-result picks (Phase 30's Corpus page) — the
    // worker's own `parseImportCorpusScope` re-validates this shape too, but
    // failing loudly here (400, not a queued job that later errors) is
    // cheaper for the caller.
    items: z
      .array(
        z.object({
          provider: z.string().refine(isCorpusProvider, { message: "provider must be one of the corpus-import providers." }),
          externalId: z.string().trim().min(1),
        }),
      )
      .min(1)
      .max(10),
  }),
]);

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const { projectId } = await params;
  return NextResponse.json({ requests: await listResearchJobRequestsForProject(userId, projectId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser("research-jobs");
  if (isResearchApiError(userId)) return userId;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid job request." }, { status: 400 });
  const { projectId } = await params;

  if (parsed.data.jobType === "synthesize_chamber") {
    const result = await dispatchSynthesizeChamberJob(userId, projectId, parsed.data.clusterId);
    switch (result.action) {
      case "not_found":
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      case "conflict":
        return NextResponse.json({ error: result.reason }, { status: 409 });
      case "reused":
        return NextResponse.json({ requestId: result.requestId, reused: true }, { status: 202 });
      case "queued":
        return NextResponse.json({ requestId: result.requestId }, { status: 202 });
    }
  }

  if (parsed.data.jobType === "extract_claims") {
    const result = parsed.data.workId
      ? await dispatchExtractClaimsJob(userId, projectId, parsed.data.workId, parsed.data.confirm)
      : await dispatchExtractClaimsJobForCorpusItem(userId, projectId, parsed.data.corpusItemId!, parsed.data.confirm);
    switch (result.action) {
      case "not_found":
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      case "not_member":
      case "no_published_edition":
      case "no_extractable_text":
      case "conflict":
        return NextResponse.json({ error: result.reason }, { status: 409 });
      case "needs_confirmation":
        return NextResponse.json({ error: result.reason, needsConfirmation: true, estimatedUnits: result.estimatedUnits }, { status: 409 });
      case "reused":
        return NextResponse.json({ requestId: result.requestId, reused: true }, { status: 202 });
      case "queued":
        return NextResponse.json({ requestId: result.requestId }, { status: 202 });
    }
  }

  if (parsed.data.jobType === "detect_relationships") {
    const result = await dispatchDetectRelationshipsJob(userId, projectId, parsed.data.confirm);
    switch (result.action) {
      case "not_found":
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      case "not_ready":
      case "conflict":
        return NextResponse.json({ error: result.reason }, { status: 409 });
      case "needs_confirmation":
        return NextResponse.json({ error: result.reason, needsConfirmation: true, estimatedUnits: result.estimatedUnits }, { status: 409 });
      case "reused":
        return NextResponse.json({ requestId: result.requestId, reused: true }, { status: 202 });
      case "queued":
        return NextResponse.json({ requestId: result.requestId }, { status: 202 });
    }
  }

  if (parsed.data.jobType === "cluster_debates") {
    const result = await dispatchClusterDebatesJob(userId, projectId, parsed.data.confirm);
    switch (result.action) {
      case "not_found":
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      case "not_ready":
      case "conflict":
        return NextResponse.json({ error: result.reason }, { status: 409 });
      case "needs_confirmation":
        return NextResponse.json({ error: result.reason, needsConfirmation: true, estimatedUnits: result.estimatedUnits }, { status: 409 });
      case "reused":
        return NextResponse.json({ requestId: result.requestId, reused: true }, { status: 202 });
      case "queued":
        return NextResponse.json({ requestId: result.requestId }, { status: 202 });
    }
  }

  if (parsed.data.jobType === "import_corpus") {
    // isCorpusProvider already gated each item in the zod schema above, so
    // this cast is re-asserting a fact zod's own `.refine` type-guard
    // narrowing doesn't reliably propagate through, not skipping a check.
    const items = parsed.data.items.map((item) => ({ provider: item.provider as CorpusProvider, externalId: item.externalId }));
    const result = await dispatchImportCorpusJob(userId, projectId, items);
    switch (result.action) {
      case "not_found":
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      case "reused":
        return NextResponse.json({ requestId: result.requestId, reused: true }, { status: 202 });
      case "queued":
        return NextResponse.json({ requestId: result.requestId }, { status: 202 });
    }
  }

  // jobType === "generate_hypotheses"
  const result = await dispatchGenerateHypothesesJob(userId, projectId, parsed.data.question ?? null, parsed.data.maxHypotheses, parsed.data.confirm);
  switch (result.action) {
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "conflict":
      return NextResponse.json({ error: result.reason }, { status: 409 });
    case "needs_confirmation":
      return NextResponse.json({ error: result.reason, needsConfirmation: true }, { status: 409 });
    case "reused":
      return NextResponse.json({ requestId: result.requestId, reused: true }, { status: 202 });
    case "queued":
      return NextResponse.json({ requestId: result.requestId }, { status: 202 });
  }
}
