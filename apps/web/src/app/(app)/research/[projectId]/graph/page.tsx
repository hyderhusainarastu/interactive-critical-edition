import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { KnowledgeMapWorkspace } from "@/components/knowledge-map";
import { requireSession } from "@/lib/auth";
import { getOwnedResearchProject } from "@/lib/research/projects";

/**
 * The research project's own Knowledge Map tab (integration step
 * "focus-modes-map-tabs" (b)) — real, not the Stage 5 stub this route used
 * to be ("A Knowledge Map scoped to this project's own claims and works is
 * planned for a later integration stage. Open the full Knowledge Map
 * below," linking out to the bare global `/graph` with no project scope at
 * all). Mounts the SAME `KnowledgeMapWorkspace` the work-context tab uses
 * (`/works/[workId]/graph/page.tsx`), pre-selected to this project's own
 * "question" context via `initialContext` — `KnowledgeMapWorkspace`'s
 * `loadQuestionContext` then synthesizes a real, bounded neighborhood of
 * this project's own claims and debate clusters (see that function's doc
 * comment for the honest scope this does and does not cover).
 *
 * Return navigation is preserved automatically, not by anything this page
 * does: `research/[projectId]/layout.tsx` already renders the persistent
 * `ResearchProjectNav` subnav above `{children}` for every route under
 * `/research/[projectId]/*`, so switching to this tab keeps every other
 * project tab (Overview/Corpus/Claims/Debates/...) one click away — the
 * exact same pattern `WorkContextHeader`'s tab strip already provides for
 * the work-context Knowledge Map tab. No extra breadcrumb/heading is added
 * here on top of that subnav, matching charter §10's "minimize global
 * chrome in Reader, Knowledge Map, and Writer" and the work-context route's
 * own precedent (which also renders `KnowledgeMapWorkspace` bare beneath
 * its own persistent tab strip, no second header).
 */
export default async function ResearchProjectGraphPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();

  return (
    <>
      {/* A real, screen-reader-visible page heading (matching every other
          project tab's own "<h1>" per `research/[projectId]/layout.tsx`'s
          doc comment) — but visually hidden (`sr-only`, zero height), since
          `.knowledge-map-workspace`'s own CSS (`globals.css`) sizes itself
          to fill the viewport BELOW the global context bar only; a visible
          heading here would add height nothing in that calc accounts for
          and get the canvas clipped. The persistent `ResearchProjectNav`'s
          `aria-current="page"` on this tab, plus the Knowledge Map
          toolbar's own live context label, already give a sighted user the
          "where am I" orientation a visible heading would otherwise add. */}
      <h1 className="sr-only">{project.title} — Knowledge Map</h1>
      <KnowledgeMapWorkspace userId={session.user.id} initialContext={{ kind: "question", id: projectId }} />
    </>
  );
}
