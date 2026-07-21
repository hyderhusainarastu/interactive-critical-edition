import { bookmarks, db, footnotes, highlights, noteHighlights, notes } from "@ice/db";
import { getSignedDocumentUrl } from "@ice/ingestion";
import { phase12FeatureEnabled } from "@ice/config";
import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getAnnotationsForDocument } from "@/lib/annotations";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workId } = await params;

  const doc = await getOwnedDocument(workId, userId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (doc.processingStatus !== "ready") {
    return NextResponse.json(
      { error: "This work isn't ready to read yet." },
      { status: 409 },
    );
  }

  const [docFootnotes, docHighlights, docNotes, docBookmarks, docAnnotations] = await Promise.all([
    db.select().from(footnotes).where(eq(footnotes.documentId, doc.documentId)),
    db
      .select()
      .from(highlights)
      .where(eq(highlights.documentId, doc.documentId))
      .orderBy(desc(highlights.createdAt)),
    db.select().from(notes).where(eq(notes.documentId, doc.documentId)),
    db.select().from(bookmarks).where(eq(bookmarks.documentId, doc.documentId)),
    getAnnotationsForDocument(doc.documentId),
  ]);
  const links = phase12FeatureEnabled("interactiveReader") && docNotes.length
    ? await db.select().from(noteHighlights).where(inArray(noteHighlights.noteId, docNotes.map((note) => note.id)))
    : [];
  const highlightIdsByNote = new Map<string, string[]>();
  for (const link of links) {
    const ids = highlightIdsByNote.get(link.noteId) ?? [];
    ids.push(link.highlightId);
    highlightIdsByNote.set(link.noteId, ids);
  }

  const isPdf = doc.mimeType === "application/pdf";

  return NextResponse.json({
    documentId: doc.documentId,
    title: doc.title,
    mimeType: doc.mimeType,
    extractedText: isPdf ? null : doc.extractedText,
    fileUrl: isPdf ? await getSignedDocumentUrl(doc.storagePath) : null,
    lastPosition: doc.lastPosition,
    analysisStatus: doc.analysisStatus,
    analysisError: doc.analysisError,
    footnotes: docFootnotes,
    highlights: docHighlights,
    notes: docNotes.map((note) => ({
      ...note,
      highlightIds: highlightIdsByNote.get(note.id) ?? (note.highlightId ? [note.highlightId] : []),
    })),
    bookmarks: docBookmarks,
    annotations: docAnnotations,
  });
}
