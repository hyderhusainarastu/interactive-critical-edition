import { NextResponse } from "next/server";
import { z } from "zod";
import { createRagConversation, listRagConversations } from "@/lib/ragData";
import { isRagApiError, requireRagApiUser } from "@/lib/ragApi";
import { getOwnedDocument } from "@/lib/works";

const createSchema = z.object({ contextWorkId: z.string().uuid().nullable().optional() });

export async function GET() {
  const userId = await requireRagApiUser("rag-conversations");
  if (isRagApiError(userId)) return userId;
  return NextResponse.json({ conversations: await listRagConversations(userId) });
}

export async function POST(request: Request) {
  const userId = await requireRagApiUser("rag-conversations");
  if (isRagApiError(userId)) return userId;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid conversation context." }, { status: 400 });
  if (parsed.data.contextWorkId && !await getOwnedDocument(parsed.data.contextWorkId, userId)) {
    // Keep the established 404 posture for a foreign work id.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ conversation: await createRagConversation(userId, parsed.data.contextWorkId) }, { status: 201 });
}
