import { NextResponse } from "next/server";
import { z } from "zod";
import { applyResearchCorrection } from "@/lib/research/corrections";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

/**
 * ONE endpoint for every research-object correction (plan §Web surfaces
 * "PATCH routes follow the annotation route verbatim ... or a cleaner
 * single corrections endpoint with zod-discriminated union" — this lane
 * took the single-endpoint option: six object types × up to eight actions
 * would otherwise be ~20 near-identical `[id]/verb/route.ts` files for
 * logic that's already centralized in one function,
 * `applyResearchCorrection`). Every branch below delegates to it — this
 * route's own job is auth/flag/rate-limit (`requireResearchApiUser`),
 * shape validation, and translating its typed result to an HTTP status.
 * Owner-scoped 404-not-403: an object that doesn't exist or isn't the
 * caller's own comes back from `applyResearchCorrection` as
 * `{ ok: false, error: "not_found" }`, mapped to 404 below — the caller can
 * never distinguish "wrong id" from "someone else's object".
 */

const reasonSchema = z.string().trim().max(2000).optional();
const uuidSchema = z.string().uuid();

const statusActionSchema = z.enum(["verified", "disputed", "hidden", "restored"]);

const baseSchema = z.object({
  objectType: z.enum(["claim", "relationship", "cluster", "chamber", "hypothesis", "gap"]),
  objectId: uuidSchema,
  action: z.enum(["verified", "disputed", "hidden", "restored", "edited", "reclassified", "split", "merged"]),
  reason: reasonSchema,
  changes: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;

  const parsed = baseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid correction request." }, { status: 400 });
  const body = parsed.data;

  if (body.objectType !== "claim") {
    if (!statusActionSchema.safeParse(body.action).success) {
      return NextResponse.json({ error: `${body.objectType} objects only support verify/dispute/hide/restore.` }, { status: 400 });
    }
    const result = await applyResearchCorrection({
      userId,
      editor: "user",
      objectType: body.objectType,
      objectId: body.objectId,
      action: body.action as "verified" | "disputed" | "hidden" | "restored",
      reason: body.reason,
    });
    return respond(result);
  }

  // objectType === "claim" — every action is available.
  if (statusActionSchema.safeParse(body.action).success) {
    const result = await applyResearchCorrection({
      userId,
      editor: "user",
      objectType: "claim",
      objectId: body.objectId,
      action: body.action as "verified" | "disputed" | "hidden" | "restored",
      reason: body.reason,
    });
    return respond(result);
  }

  if (body.action === "edited") {
    const changes = z
      .object({ claimText: z.string().trim().min(1).max(2000).optional(), supportingExcerpt: z.string().trim().min(1).max(4000).optional() })
      .refine((c) => c.claimText !== undefined || c.supportingExcerpt !== undefined, { message: "Provide claimText and/or supportingExcerpt." })
      .safeParse(body.changes);
    if (!changes.success) return NextResponse.json({ error: "Provide claimText and/or supportingExcerpt to edit." }, { status: 400 });
    const result = await applyResearchCorrection({ userId, editor: "user", objectType: "claim", objectId: body.objectId, action: "edited", reason: body.reason, changes: changes.data });
    return respond(result);
  }

  if (body.action === "reclassified") {
    const changes = z.object({ claimNature: z.string() }).safeParse(body.changes);
    if (!changes.success) return NextResponse.json({ error: "Provide a claimNature to reclassify to." }, { status: 400 });
    const result = await applyResearchCorrection({ userId, editor: "user", objectType: "claim", objectId: body.objectId, action: "reclassified", reason: body.reason, changes: changes.data });
    return respond(result);
  }

  if (body.action === "split") {
    const changes = z
      .object({ excerpts: z.array(z.string().trim().min(1)).min(2).max(10), claimTexts: z.array(z.string().trim().min(1)).max(10).optional() })
      .safeParse(body.changes);
    if (!changes.success) return NextResponse.json({ error: "A split needs at least two non-empty excerpts." }, { status: 400 });
    const result = await applyResearchCorrection({ userId, editor: "user", objectType: "claim", objectId: body.objectId, action: "split", reason: body.reason, changes: changes.data });
    return respond(result);
  }

  // body.action === "merged"
  const changes = z
    .object({
      otherClaimIds: z.array(uuidSchema).min(1).max(10),
      claimText: z.string().trim().min(1).max(2000),
      supportingExcerpt: z.string().trim().min(1).max(4000),
    })
    .safeParse(body.changes);
  if (!changes.success) return NextResponse.json({ error: "A merge needs otherClaimIds plus the merged claimText/supportingExcerpt." }, { status: 400 });
  const result = await applyResearchCorrection({ userId, editor: "user", objectType: "claim", objectId: body.objectId, action: "merged", reason: body.reason, changes: changes.data });
  return respond(result);
}

function respond(result: Awaited<ReturnType<typeof applyResearchCorrection>>) {
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 400;
    return NextResponse.json({ error: result.message ?? (result.error === "not_found" ? "Not found" : "Invalid correction.") }, { status });
  }
  return NextResponse.json({ ok: true, objectType: result.objectType, objectId: result.objectId, revision: result.revision, newClaimIds: result.newClaimIds });
}
