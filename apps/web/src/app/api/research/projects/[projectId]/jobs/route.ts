import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatchGenerateHypothesesJob } from "@/lib/research/hypotheses";
import { dispatchExtractClaimsJob, dispatchSynthesizeChamberJob, listResearchJobRequestsForProject } from "@/lib/research/jobs";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

const postSchema = z.discriminatedUnion("jobType", [
  z.object({
    jobType: z.literal("extract_claims"),
    workId: z.string().uuid(),
    confirm: z.boolean().default(false),
  }),
  z.object({
    jobType: z.literal("synthesize_chamber"),
    clusterId: z.string().uuid(),
  }),
  z.object({
    jobType: z.literal("generate_hypotheses"),
    question: z.string().trim().min(1).max(500).optional(),
    maxHypotheses: z.coerce.number().int().min(1).max(5).optional(),
    confirm: z.boolean().default(false),
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
    const result = await dispatchExtractClaimsJob(userId, projectId, parsed.data.workId, parsed.data.confirm);
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
