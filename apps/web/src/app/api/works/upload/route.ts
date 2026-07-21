import { db, documents, processingJobs, works } from "@ice/db";
import { enqueueExtractText } from "@ice/db";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { scanWithOptionalClamAv, uploadDocumentFile, validateUploadContent } from "@ice/ingestion";
import { getApiUserId } from "@/lib/auth";
import { enforceUserRateLimit } from "@/lib/apiRateLimit";
import { rateLimitResponse } from "@/lib/apiResponse";
import { reportWebError } from "@/lib/telemetry";

const ACCEPTED_TYPES = new Set(["application/pdf", "application/epub+zip", "text/plain", "text/markdown"]);
const MAX_SIZE_BYTES = 50 * 1024 * 1024;
const USER_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rate = await enforceUserRateLimit({ userId, scope: "upload", limit: 20, windowMs: 60 * 60_000 });
  if (!rate.allowed) return rateLimitResponse(rate);

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
  // SUM(int) may arrive as a bigint string in serverless production.
  const usedBytes = Number(used);
  if (!Number.isFinite(usedBytes) || usedBytes + file.size > USER_STORAGE_QUOTA_BYTES) {
    return NextResponse.json(
      { error: "You've reached your storage quota (500MB)." },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const validation = validateUploadContent(buffer, file.type);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400 },
    );
  }

  const scan = await scanWithOptionalClamAv(buffer);
  if (!scan.valid) {
    return NextResponse.json(
      { error: scan.error },
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
    reportWebError(err, { scope: "api.upload", workId: work.id, userId });
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
