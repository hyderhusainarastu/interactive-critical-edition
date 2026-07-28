import { KnowledgeMapWorkspace } from "@/components/knowledge-map";
import { requireSession } from "@/lib/auth";

/**
 * The global Knowledge Map (redesign Stage 3, spec §1.2: "Edited, not
 * deleted" — same route, same auth responsibility, `KnowledgeMapWorkspace`
 * swapped in for the legacy `GraphView`). No `initialContext` — a bare
 * `/graph` intentionally opens the context chooser (charter §8/§9), never
 * an implicit whole-corpus render.
 */
export default async function GlobalGraphPage() {
  const session = await requireSession();
  return <KnowledgeMapWorkspace userId={session.user.id} />;
}
