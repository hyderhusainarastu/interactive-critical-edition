/**
 * Phase 18 is an additive local-release gate. It defaults off so a code push
 * cannot expose chat or trigger automatic embeddings before its migration and
 * production authorization are separately approved.
 */
export function phase18RagEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.PHASE_18_RAG_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
