import { phase12FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { KnowledgeMapWorkspace } from "@/components/knowledge-map";
import { requireSession } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/**
 * A work-scoped Knowledge Map (redesign Stage 3, spec §1.2: "Edited, not
 * deleted"). `initialContext` pre-selects this work so the route never
 * shows the generic 5-tab chooser for something already inherently scoped
 * to one work — `KnowledgeMapWorkspace`'s own doc comment on that prop.
 */
export default async function WorkGraphPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;
  const doc = await getOwnedDocument(workId, session.user.id);
  if (!doc) notFound();

  return <KnowledgeMapWorkspace userId={session.user.id} initialContext={{ kind: "work", id: workId }} writerEnabled={phase12FeatureEnabled("writer")} />;
}
