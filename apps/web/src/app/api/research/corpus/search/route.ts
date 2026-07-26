import { isCorpusProvider, normalizeCorpusItem, searchCorpusCandidates, type CorpusItemInsertShape } from "@ice/research";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

/**
 * Corpus provider search (Phase 30 fix lane, plan §route-map's previously
 * unbuilt `/research/[projectId]/corpus`). Network-only, zero AI cost —
 * `searchCorpusCandidates` (`@ice/research`) fans out to Semantic Scholar,
 * OpenAlex, and arXiv and reports every provider's attempt honestly, the
 * same `ProviderAttempt` contract `runMonitor.ts`/`discover.ts` already use.
 *
 * A search here NEVER writes to `research_corpus_item` — results are
 * returned to the client for review only; only a subsequent explicit
 * "Import" action (`POST /api/research/projects/[projectId]/jobs` with
 * `jobType: "import_corpus"`) persists anything, matching this codebase's
 * house rule that a lookup and a write are always two distinct, separately
 * auditable steps (the `add-to-corpus` monitor-hit precedent).
 *
 * `normalizeCorpusItem` reshapes each real provider payload into the exact
 * insert shape a later import would use (never inventing a field — see its
 * own anti-hallucination doc comment); `raw` is stripped before the
 * response goes over the wire since the client only needs the display
 * fields plus `source`/`externalId` to build an "Import" request.
 */

const postSchema = z.object({
  query: z.string().trim().min(1).max(300),
});

const RESULT_LIMIT = 15;
const SEARCH_TIMEOUT_MS = 12_000;

export async function POST(request: Request) {
  // Ownership is per-import, not per-search — a search touches no project,
  // just the (rate-limited, authenticated) real provider fan-out.
  const userId = await requireResearchApiUser("research-corpus-search");
  if (isResearchApiError(userId)) return userId;

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A search query is required." }, { status: 400 });

  const { candidates, attempts } = await searchCorpusCandidates(parsed.data.query, {
    limit: RESULT_LIMIT,
    timeoutMs: SEARCH_TIMEOUT_MS,
  });

  const results: Omit<CorpusItemInsertShape, "raw">[] = [];
  for (const candidate of candidates) {
    if (!isCorpusProvider(candidate.provider)) continue; // guards against a future non-corpus adapter leaking into this fan-out
    const normalized = normalizeCorpusItem(candidate.provider, candidate);
    if (!normalized) continue; // payload lacked a usable title/id — the same skip `importCorpusForScope` applies at import time
    const { raw: _raw, ...displayFields } = normalized;
    results.push(displayFields);
  }

  return NextResponse.json({ results, attempts });
}
