import { isCorpusProvider, lookupCorpusItemById, normalizeCorpusItem, type CorpusProvider } from "@ice/research";
import * as repo from "./repository";
import type { ResearchJobOutcome, ResearchJobRunContext } from "./jobRunner";

/**
 * import_corpus handler (Phase 28.2, plan §Pipeline "import-research-corpus"
 * queue). Replaces `apps/worker/src/index.ts`'s honest no-op for this job
 * type. Zero AI cost by design — every step is a real network lookup
 * against a scholarly provider, or a read-only/idempotent DB write; nothing
 * here calls `ctx.logUsage()` because nothing here spends against the
 * research budget.
 *
 * Scope shape: `{ projectId?: string, items: [{ provider, externalId }] }`.
 * For each item: fetch its full metadata by id from its own provider,
 * normalize + dedup-upsert into `research_corpus_item` (never a fabricated
 * field — see `normalizeCorpusItem`'s own anti-hallucination doc comment),
 * best-effort READ-ONLY match against the shared `bibliographic_record`
 * catalog by DOI (no creation this lane), and — when `projectId` is present
 * — link the item into that project as a `corpus_item` member. Every
 * outcome (imported / already-in-corpus / not-found / failed) is recorded
 * per-item in the job's `note`, never silently dropped.
 */

export interface ImportCorpusItemRequest {
  provider: string;
  externalId: string;
}

export interface ImportCorpusScope {
  projectId?: string;
  items: ImportCorpusItemRequest[];
}

export function parseImportCorpusScope(scope: unknown): ImportCorpusScope | null {
  const s = scope as { projectId?: unknown; items?: unknown } | null;
  if (!s || !Array.isArray(s.items) || s.items.length === 0) return null;
  const items: ImportCorpusItemRequest[] = [];
  for (const raw of s.items) {
    const item = raw as { provider?: unknown; externalId?: unknown } | null;
    if (!item || typeof item.provider !== "string" || typeof item.externalId !== "string" || !item.externalId.trim()) return null;
    items.push({ provider: item.provider, externalId: item.externalId });
  }
  const projectId = typeof s.projectId === "string" && s.projectId.length > 0 ? s.projectId : undefined;
  return { projectId, items };
}

export interface ImportCorpusOutcome extends ResearchJobOutcome {
  imported: number;
  /** One line per requested item, in request order — the honest per-item
   *  outcome list this handler's own doc comment promises. Also what
   *  `ResearchJobOutcome.note` is built from. */
  itemOutcomes: string[];
}

/**
 * The testable core: DI'd `lookupById` (real `lookupCorpusItemById` in
 * production, a mock in tests) — the `extractClaimsForWork(caller, ...)`
 * precedent. `ctx` still owns stage/heartbeat reporting even though nothing
 * here charges its budget.
 */
export async function importCorpusForScope(
  lookupById: typeof lookupCorpusItemById,
  ctx: ResearchJobRunContext,
  scope: ImportCorpusScope,
): Promise<ImportCorpusOutcome> {
  if (scope.projectId) {
    const owns = await repo.userOwnsResearchProject(ctx.request.userId, scope.projectId);
    if (!owns) throw new Error(`Research project ${scope.projectId} does not belong to the requesting user.`);
  }

  const itemOutcomes: string[] = [];
  let imported = 0;

  for (let i = 0; i < scope.items.length; i++) {
    const item = scope.items[i];
    await ctx.setStage("importing-corpus-item", { index: i + 1, total: scope.items.length });
    const label = `${item.provider}:${item.externalId}`;

    if (!isCorpusProvider(item.provider)) {
      itemOutcomes.push(`${label} — unsupported provider; skipped.`);
      continue;
    }
    const provider: CorpusProvider = item.provider;

    try {
      const { resource, attempt } = await lookupById(provider, item.externalId);
      if (!resource) {
        const reason = attempt.error ? `${attempt.status}: ${attempt.error}` : attempt.status;
        itemOutcomes.push(`${label} — not found (${reason}).`);
        continue;
      }

      const normalized = normalizeCorpusItem(provider, resource);
      if (!normalized) {
        itemOutcomes.push(`${label} — provider payload lacked a usable title/id; skipped.`);
        continue;
      }

      const upserted = await repo.upsertResearchCorpusItem(ctx.request.userId, normalized);
      if (upserted.wasNew) imported += 1;
      let outcomeLine = `${label} — ${upserted.wasNew ? "imported" : "already in corpus (deduped)"}`;

      if (normalized.doi) {
        const match = await repo.findBibliographicRecordByDoi(normalized.doi);
        if (match) outcomeLine += `; matched existing bibliographic_record ${match.id}`;
      }

      if (scope.projectId) {
        const linked = await repo.linkCorpusItemToProject(scope.projectId, upserted.id);
        outcomeLine += linked ? "; linked to project" : "; already a project member";
      }

      itemOutcomes.push(`${outcomeLine}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      itemOutcomes.push(`${label} — failed: ${message.slice(0, 200)}.`);
    }
  }

  // Network-only, zero AI cost: every requested item was actually attempted
  // (no chunk/budget cap could stop this handler partway), so the honest
  // coverage claim is always "full" — a per-item failure is recorded in
  // `note`, not hidden behind a downgraded coverage value.
  return { coverage: "full", note: itemOutcomes.join(" | ").slice(0, 2000), imported, itemOutcomes };
}

/** Real-provider wrapper wired into the worker's queue handler. */
export async function importCorpus(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseImportCorpusScope(ctx.request.scope);
  if (!scope) {
    throw new Error(
      'import_corpus scope must be {"items": [{"provider": "semanticscholar"|"openalex"|"arxiv", "externalId": string}], "projectId"?: string}.',
    );
  }
  const outcome = await importCorpusForScope(lookupCorpusItemById, ctx, scope);
  return { coverage: outcome.coverage, note: outcome.note };
}
