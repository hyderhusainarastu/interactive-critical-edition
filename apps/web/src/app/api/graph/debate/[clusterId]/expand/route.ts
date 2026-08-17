import { phase25FeatureEnabled } from "@ice/config";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { loadDebateClusterExpansion } from "@/lib/graph/graphDebate";
import { notFound } from "@/lib/api/apiResponse";

const paramsSchema = z.object({ clusterId: z.string().uuid() });

/**
 * Debate-cluster expansion (Phase 28.4, `graphDebateLayer`-flagged): the ONE
 * next-zoom-level request `GraphView`'s "Expand debate" control makes,
 * returning an additive `GraphExpansionDelta` (`nodes`/`links` only — no
 * `stats`, this is never rendered standalone) the client merges into its
 * already-loaded graph via `mergeGraphDelta` (`@/components/graph/types`).
 * Owner-scoped 404-not-403, matching every other graph/research route in
 * this codebase (`api/graph/expansion/route.ts`, `api/research/projects/
 * [projectId]/route.ts`): "not found" and "not yours" are the same response,
 * never a signal an attacker can use to enumerate other users' cluster ids.
 * Zero LLM calls — `loadDebateClusterExpansion` is a pure DB read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ clusterId: string }> }) {
  if (!phase25FeatureEnabled("graphDebateLayer")) return notFound();
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return notFound();

  const expansion = await loadDebateClusterExpansion(userId, parsed.data.clusterId);
  if (!expansion) return notFound();

  return NextResponse.json(expansion);
}
