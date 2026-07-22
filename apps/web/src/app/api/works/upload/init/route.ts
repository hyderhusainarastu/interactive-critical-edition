import { phase12FeatureEnabled } from "@ice/config";
import { db, documents, learningResources, works } from "@ice/db";
import { createSignedUploadUrl } from "@ice/ingestion";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { enforceUserRateLimit } from "@/lib/apiRateLimit";
import { rateLimitResponse } from "@/lib/apiResponse";
import { reportWebError } from "@/lib/telemetry";

const schema = z.object({
  name: z.string().min(1).max(240),
  type: z.enum(["application/pdf", "application/epub+zip", "text/plain", "text/markdown"]),
  size: z.number().int().positive().max(50 * 1024 * 1024),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  duplicateResolution: z.enum(["add_edition"]).optional(),
  /**
   * Phase 20.4: set when this upload is attaching source text to an
   * existing Library entry (a `learning_resource` discovered/recommended
   * but never uploaded) rather than starting a brand-new work from
   * scratch. The resource itself is shared/unowned, so only its
   * existence — not ownership — is validated here; the Library detail
   * page already scopes which resources a given user may see this
   * control for.
   */
  learningResourceId: z.string().uuid().optional(),
});
const USER_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rate = await enforceUserRateLimit({ userId, scope: "upload-init", limit: 30, windowMs: 60 * 60_000 });
  if (!rate.allowed) return rateLimitResponse(rate);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Unsupported file or invalid upload metadata." }, { status: 400 });
  // Resolve the Library entry this upload is attaching to, if any (plan
  // §20.4). Read-only and existence-only — `learning_resource` is a shared
  // catalog row, not a per-user secret, so there is nothing to authorize
  // beyond "does this id exist."
  let attachResource: { workIdentityId: string | null; title: string } | null = null;
  if (input.data.learningResourceId) {
    const [resource] = await db
      .select({ workIdentityId: learningResources.workIdentityId, title: learningResources.title })
      .from(learningResources)
      .where(eq(learningResources.id, input.data.learningResourceId))
      .limit(1);
    if (!resource) return NextResponse.json({ error: "That Library entry could not be found." }, { status: 404 });
    attachResource = resource;
  }
  // The browser's hash is a duplicate lookup hint, not a trust boundary. The
  // worker recomputes and stores the SHA-256 from the verified Storage bytes.
  if (phase12FeatureEnabled("libraryIdentity") && input.data.contentHash && input.data.duplicateResolution !== "add_edition") {
    const [duplicate] = await db
      .select({ workId: works.id, title: works.title })
      .from(documents)
      .innerJoin(works, eq(works.id, documents.workId))
      .where(and(eq(documents.userId, userId), eq(documents.contentHash, input.data.contentHash.toLowerCase()), isNull(works.deletedAt)))
      .limit(1);
    if (duplicate) {
      return NextResponse.json({
        duplicate: {
          workId: duplicate.workId,
          title: duplicate.title,
          message: "This file is already in your Library.",
        },
      });
    }
  }
  // A direct signed-upload row is a quota reservation from the moment its
  // URL is issued. The browser controls the declared size and can abandon a
  // PUT before completion, so excluding `uploaded` rows lets one account
  // accumulate unaccounted Storage objects indefinitely. Completion verifies
  // the object's actual byte count before releasing this into processing.
  const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${documents.fileSize}), 0)` }).from(documents).where(eq(documents.userId, userId));
  // PostgreSQL SUM(int) is bigint. Some production drivers decode bigint as
  // a string, so normalize it before arithmetic (string + number would
  // concatenate and falsely exceed the quota after the first upload).
  const usedBytes = Number(used);
  if (!Number.isFinite(usedBytes) || usedBytes + input.data.size > USER_STORAGE_QUOTA_BYTES) return NextResponse.json({ error: "You've reached your storage quota (500MB)." }, { status: 413 });
  // A resource-driven title (the canonical title already known from
  // discovery) beats a filename-derived guess when this upload is
  // attaching to a specific Library entry — the reader recognizes the
  // work by its real title immediately, not by whatever the uploaded
  // file happened to be named.
  const title = attachResource ? attachResource.title : input.data.name.replace(/\.[^./]+$/, "").replace(/[_-]+/g, " ");
  // Canonical-identity association (plan §20.4/§9.5). Two independent
  // sources, deliberately not merged into one `??` chain: an explicit
  // "add another edition" of a byte-identical file the user already owns
  // is a stronger, more specific signal than the Library entry's own
  // recorded identity, so it must win outright rather than only being
  // preferred when non-null.
  let workIdentityIdForNewWork: string | null = null;
  if (phase12FeatureEnabled("libraryIdentity") && input.data.contentHash && input.data.duplicateResolution === "add_edition") {
    const [duplicate] = await db
      .select({ workIdentityId: works.workIdentityId })
      .from(documents)
      .innerJoin(works, eq(works.id, documents.workId))
      .where(and(eq(documents.userId, userId), eq(documents.contentHash, input.data.contentHash.toLowerCase()), isNull(works.deletedAt)))
      .limit(1);
    workIdentityIdForNewWork = duplicate?.workIdentityId ?? null;
  } else if (attachResource) {
    workIdentityIdForNewWork = phase12FeatureEnabled("libraryIdentity") ? attachResource.workIdentityId : null;
  }
  const [work] = await db
    .insert(works)
    .values({ userId, title, workType: "primary", workIdentityId: workIdentityIdForNewWork })
    .returning({ id: works.id });
  const filename = input.data.name.replace(/[^\w.\-]+/g, "_").slice(0, 200);
  const storagePath = `${userId}/${work.id}/${filename}`;
  try {
    const [document] = await db.insert(documents).values({ userId, workId: work.id, storagePath, originalFilename: input.data.name, mimeType: input.data.type, fileSize: input.data.size, processingStatus: "uploaded" }).returning({ id: documents.id });
    const signed = await createSignedUploadUrl(storagePath);
    return NextResponse.json({ workId: work.id, documentId: document.id, uploadUrl: signed.url });
  } catch (error) {
    await db.delete(works).where(eq(works.id, work.id));
    reportWebError(error, { scope: "api.upload.init", userId, workId: work.id });
    return NextResponse.json({ error: "Could not prepare the upload. Please try again." }, { status: 500 });
  }
}
