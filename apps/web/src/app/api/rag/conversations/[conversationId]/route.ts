import { z } from "zod";
import { NextResponse } from "next/server";
import type { CompetencyNoticeView } from "@/lib/competencyData";
import { answerRagConversation, getRagConversationView } from "@/lib/ragData";
import { isRagApiError, requireRagApiUser } from "@/lib/ragApi";

const messageSchema = z.object({ message: z.string().trim().min(2).max(2_000) });

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Sub-phase 22.9b (plan §3.5): "own 6s cap, fail-silent — a competency
// failure or timeout never fails the answer; emit nothing." Races the
// orchestrator's promise (which already fails closed internally) against a
// timer that resolves empty, so a slow/erroring competency pass can never
// delay or break the `done` event the reader is actually waiting on.
const COMPETENCY_NOTICE_TIMEOUT_MS = 6_000;

async function withCompetencyTimeout(promise: Promise<CompetencyNoticeView[]>): Promise<CompetencyNoticeView[]> {
  try {
    return await Promise.race([
      promise,
      new Promise<CompetencyNoticeView[]>((resolve) => setTimeout(() => resolve([]), COMPETENCY_NOTICE_TIMEOUT_MS)),
    ]);
  } catch {
    return [];
  }
}

function streamAnswer(answer: NonNullable<Awaited<ReturnType<typeof answerRagConversation>>>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sse("user", answer.user)));
      for (const token of answer.assistant.content.match(/\S+\s*/g) ?? []) controller.enqueue(encoder.encode(sse("delta", { text: token })));
      for (const citation of answer.assistant.citations) controller.enqueue(encoder.encode(sse("citation", citation)));
      const notices = await withCompetencyTimeout(answer.competencyPromise);
      for (const notice of notices) controller.enqueue(encoder.encode(sse("competency", notice)));
      controller.enqueue(encoder.encode(sse("done", { message: answer.assistant, notFound: answer.notFound })));
      controller.close();
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const userId = await requireRagApiUser("rag-conversations");
  if (isRagApiError(userId)) return userId;
  const { conversationId } = await params;
  const view = await getRagConversationView(userId, conversationId);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view);
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const userId = await requireRagApiUser("rag-answer");
  if (isRagApiError(userId)) return userId;
  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ask a question between 2 and 2,000 characters." }, { status: 400 });
  const { conversationId } = await params;
  const answer = await answerRagConversation({ userId, conversationId, question: parsed.data.message });
  if (!answer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(streamAnswer(answer), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
