import { db, documents, works } from "@ice/db";
import { createSignedUploadUrl } from "@ice/ingestion";
import { and, eq, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";

const schema = z.object({ name: z.string().min(1).max(240), type: z.enum(["application/pdf", "application/epub+zip", "text/plain", "text/markdown"]), size: z.number().int().positive().max(50 * 1024 * 1024) });
const USER_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Unsupported file or invalid upload metadata." }, { status: 400 });
  // `uploaded` is a short-lived staging state: a signed URL has been issued,
  // but the browser has not yet proven that it stored an object and queued
  // extraction. Counting it here made a failed browser request permanently
  // consume quota even though it never uploaded a document.
  const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${documents.fileSize}), 0)` }).from(documents).where(and(eq(documents.userId, userId), ne(documents.processingStatus, "uploaded")));
  if (used + input.data.size > USER_STORAGE_QUOTA_BYTES) return NextResponse.json({ error: "You've reached your storage quota (500MB)." }, { status: 413 });
  const title = input.data.name.replace(/\.[^./]+$/, "").replace(/[_-]+/g, " ");
  const [work] = await db.insert(works).values({ userId, title, workType: "primary" }).returning({ id: works.id });
  const filename = input.data.name.replace(/[^\w.\-]+/g, "_").slice(0, 200);
  const storagePath = `${userId}/${work.id}/${filename}`;
  try {
    const [document] = await db.insert(documents).values({ userId, workId: work.id, storagePath, originalFilename: input.data.name, mimeType: input.data.type, fileSize: input.data.size, processingStatus: "uploaded" }).returning({ id: documents.id });
    const signed = await createSignedUploadUrl(storagePath);
    return NextResponse.json({ workId: work.id, documentId: document.id, uploadUrl: signed.url });
  } catch (error) {
    await db.delete(works).where(eq(works.id, work.id));
    console.error("[upload/init] could not create signed upload URL", error);
    return NextResponse.json({ error: "Could not prepare the upload. Please try again." }, { status: 500 });
  }
}
