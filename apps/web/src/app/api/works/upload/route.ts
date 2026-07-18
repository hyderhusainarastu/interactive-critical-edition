import { db, documents, processingJobs, works } from "@ice/db";
import { enqueueExtractText } from "@ice/db";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { uploadDocumentFile } from "@ice/ingestion";
import { reportError } from "@ice/observability";
import { getApiUserId } from "@/lib/auth";

const ACCEPTED_TYPES = new Set(["application/pdf", "text/plain", "text/markdown"]);
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const USER_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024;

/**
 * Malware scanning is stubbed for Phase 2 — the plan calls for
 * ClamAV/a hosted scanning API, which needs its own infra. Tracked as
 * known debt in CLAUDE.md rather than silently skipped. This function
 * is the seam a real scanner plugs into later.
 */
async function scanForMalware(_buffer: Buffer): Promise<{ clean: boolean }> {
  return { clean: true };
}

// Lightweight content-vs-claimed-type check — not a substitute for the
// malware scan above, just catches an obviously mislabeled upload
// (plan §14/§15: "MIME-sniffed, not trusted by extension").
function contentMatchesType(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "application/pdf") {
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  }
  // text/plain, text/markdown: reject anything with embedded NUL bytes
  // (a reliable signal of binary content mislabeled as text).
  return !buffer.subarray(0, 8000).includes(0);
}

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type." },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File exceeds the 50MB limit." },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }

  const [{ used }] = await db
    .select({ used: sql<number>`coalesce(sum(${documents.fileSize}), 0)` })
    .from(documents)
    .where(eq(documents.userId, userId));
  if (used + file.size > USER_STORAGE_QUOTA_BYTES) {
    return NextResponse.json(
      { error: "You've reached your storage quota (500MB)." },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!contentMatchesType(buffer, file.type)) {
    return NextResponse.json(
      { error: "File content doesn't match its declared type." },
      { status: 400 },
    );
  }

  const scan = await scanForMalware(buffer);
  if (!scan.clean) {
    return NextResponse.json(
      { error: "File failed a security scan." },
      { status: 400 },
    );
  }

  const titleGuess = file.name.replace(/\.[^./]+$/, "").replace(/[_-]+/g, " ");

  const [work] = await db
    .insert(works)
    .values({ userId, title: titleGuess, workType: "primary" })
    .returning({ id: works.id });

  const sanitizedFilename = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 200);
  const storagePath = `${userId}/${work.id}/${sanitizedFilename}`;

  try {
    await uploadDocumentFile({
      path: storagePath,
      data: buffer,
      contentType: file.type,
    });
  } catch (err) {
    await db.delete(works).where(eq(works.id, work.id));
    reportError(err, { scope: "api.upload", workId: work.id, userId });
    return NextResponse.json(
      { error: "Upload failed — please try again." },
      { status: 500 },
    );
  }

  const [document] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath,
      originalFilename: file.name,
      mimeType: file.type,
      fileSize: file.size,
      processingStatus: "uploaded",
    })
    .returning({ id: documents.id });

  const jobId = await enqueueExtractText(document.id);
  await db.insert(processingJobs).values({
    documentId: document.id,
    jobType: "extract-text",
    status: "pending",
    pgBossJobId: jobId,
  });

  return NextResponse.json({ workId: work.id, documentId: document.id });
}
