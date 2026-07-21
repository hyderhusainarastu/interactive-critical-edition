import { OpenAIEmbeddingsClient, estimateEmbeddingCostUsd } from "@ice/ai-adapters";
import { db, workEmbeddings, workRelationshipCandidates, works } from "@ice/db";
import { canAfford, overSoftCap, type CostBudget } from "@ice/research";
import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const MAX_CANDIDATES_PER_WORK = 20;

export function compactWorkSignal(input: {
  title: string;
  author: string | null;
  concepts: readonly string[];
  claims: readonly { claim: string; supportingExcerpt: string }[];
}): string {
  return [
    `Title: ${input.title}`,
    input.author ? `Author: ${input.author}` : null,
    input.concepts.length ? `Concepts: ${input.concepts.slice(0, 16).join("; ")}` : null,
    input.claims.length
      ? `Grounded claims: ${input.claims.slice(0, 12).map((claim) => `${claim.claim} — ${claim.supportingExcerpt}`).join("\n")}`
      : null,
  ].filter((value): value is string => Boolean(value)).join("\n").slice(0, 12_000);
}

export function workSignalHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return null;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

/**
 * Persist a compact, source-grounded work embedding and cheap candidate pairs.
 * The candidates are only retrieval evidence; relationship judgement remains
 * in Phase 12.5. Missing API configuration degrades to no vector — never a
 * made-up approximation — and no call begins beyond the existing caps.
 */
export async function persistV4WorkSignals(input: {
  runId: string;
  workId: string;
  userId: string;
  signal: string;
  budget: CostBudget;
  logUsage: (model: string, inputTokens: number, cost: number) => void;
}): Promise<{ embedded: boolean; candidates: number }> {
  const signal = input.signal.trim();
  if (!signal) return { embedded: false, candidates: 0 };
  const inputHash = workSignalHash(signal);
  const [existing] = await db
    .select({ id: workEmbeddings.id })
    .from(workEmbeddings)
    .where(and(eq(workEmbeddings.workId, input.workId), eq(workEmbeddings.model, EMBEDDING_MODEL), eq(workEmbeddings.inputHash, inputHash)))
    .limit(1);
  if (existing) return { embedded: false, candidates: 0 };

  const projectedCost = estimateEmbeddingCostUsd(EMBEDDING_MODEL, Math.ceil(signal.length / 4));
  if (!canAfford(input.budget, projectedCost) || overSoftCap(input.budget)) return { embedded: false, candidates: 0 };

  const client = new OpenAIEmbeddingsClient();
  if (!client.available) return { embedded: false, candidates: 0 };

  let result;
  try {
    result = await client.embed(signal, EMBEDDING_MODEL);
  } catch (error) {
    console.error("[v4] embedding failed; continuing without a cross-work vector:", error);
    return { embedded: false, candidates: 0 };
  }
  const cost = estimateEmbeddingCostUsd(result.model, result.inputTokens);
  input.logUsage(result.model, result.inputTokens, cost);
  await db.insert(workEmbeddings).values({
    runId: input.runId,
    workId: input.workId,
    model: result.model,
    inputHash,
    embedding: result.embedding,
  }).onConflictDoNothing({ target: [workEmbeddings.workId, workEmbeddings.model, workEmbeddings.inputHash] });

  const otherEmbeddings = await db
    .select({
      workId: workEmbeddings.workId,
      embedding: workEmbeddings.embedding,
      inputHash: workEmbeddings.inputHash,
    })
    .from(workEmbeddings)
    .innerJoin(works, eq(works.id, workEmbeddings.workId))
    .where(and(eq(works.userId, input.userId), ne(workEmbeddings.workId, input.workId), eq(workEmbeddings.model, result.model)));
  const candidates = otherEmbeddings
    .map((other) => ({
      targetWorkId: other.workId,
      targetInputHash: other.inputHash,
      score: cosineSimilarity(result.embedding, other.embedding as number[]),
    }))
    .filter((candidate): candidate is { targetWorkId: string; targetInputHash: string; score: number } => candidate.score !== null && candidate.score >= 0.25)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CANDIDATES_PER_WORK);
  if (candidates.length) {
    await db.insert(workRelationshipCandidates).values(candidates.map((candidate) => ({
      sourceWorkId: input.workId,
      targetWorkId: candidate.targetWorkId,
      method: "embedding-v4",
      score: candidate.score,
      basis: { model: result.model, sourceInputHash: inputHash, targetInputHash: candidate.targetInputHash },
    }))).onConflictDoNothing({
      target: [workRelationshipCandidates.sourceWorkId, workRelationshipCandidates.targetWorkId, workRelationshipCandidates.method],
    });
    for (const candidate of candidates) {
      await db.update(workRelationshipCandidates).set({
        score: candidate.score,
        basis: { model: result.model, sourceInputHash: inputHash, targetInputHash: candidate.targetInputHash },
        createdAt: new Date(),
      }).where(and(
        eq(workRelationshipCandidates.sourceWorkId, input.workId),
        eq(workRelationshipCandidates.targetWorkId, candidate.targetWorkId),
        eq(workRelationshipCandidates.method, "embedding-v4"),
      ));
    }
  }
  return { embedded: true, candidates: candidates.length };
}
