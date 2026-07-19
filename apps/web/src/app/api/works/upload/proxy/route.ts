import { db, documents } from "@ice/db";
import { uploadDocumentFile } from "@ice/ingestion";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";

/**
 * Same-origin upload fallback. The primary path is the browser's direct PUT to
 * a signed Supabase Storage URL (no serverless body limit), but some client
 * environments block cross-origin PUTs to supabase.co outright ("load failed"
 * with the direct path verified healthy server-side — observed 2026-07-19).
 * For files that fit the serverless request-body ceiling (~4.5MB on Vercel),
 * the browser can instead POST the bytes here and the server performs the
 * Storage write with the service role. Larger files must use the direct path.
 *
 * Auth + ownership enforced; only a document still in the `uploaded` staging
 * state may receive bytes, and the byte count must match what /init recorded,
 * so this can't overwrite a processed document or smuggle a different file.
 */
const PROXY_MAX_BYTES = 4 * 1024 * 1024; // stay safely under Vercel's ~4.5MB body cap

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId") ?? "";
  const workId = url.searchParams.get("workId") ?? "";
  if (!documentId || !workId) return NextResponse.json({ error: "Missing upload identifiers." }, { status: 400 });

  const [document] = await db
    .select({
      id: documents.id,
      storagePath: documents.storagePath,
      mimeType: documents.mimeType,
      fileSize: documents.fileSize,
      processingStatus: documents.processingStatus,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.workId, workId), eq(documents.userId, userId)))
    .limit(1);
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (document.processingStatus !== "uploaded") {
    return NextResponse.json({ error: "This upload has already been processed." }, { status: 409 });
  }
  if (document.fileSize > PROXY_MAX_BYTES) {
    return NextResponse.json(
      { error: "File is too large for the fallback upload path (4MB). Use the direct upload." },
      { status: 413 },
    );
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength !== document.fileSize) {
    return NextResponse.json({ error: "Uploaded bytes do not match the declared file size." }, { status: 400 });
  }

  try {
    await uploadDocumentFile({ path: document.storagePath, data: body, contentType: document.mimeType });
  } catch (error) {
    // upsert:false → a retry after a successful store surfaces as a duplicate;
    // treat that as success so the client can proceed to /complete.
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|duplicate/i.test(message)) {
      console.error("[upload/proxy] storage write failed", error);
      return NextResponse.json({ error: "Could not store the file. Please try again." }, { status: 502 });
    }
  }
  return NextResponse.json({ ok: true });
}
