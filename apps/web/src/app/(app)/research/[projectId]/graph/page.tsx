import { phase25FeatureEnabled } from "@ice/config";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResearchBreadcrumb } from "@/components/research/ResearchBreadcrumb";
import { requireSession } from "@/lib/auth";
import { getOwnedResearchProject } from "@/lib/research/projects";

/**
 * Knowledge Map stub for a research project (stage5-research-spec.md §4). An
 * honest "not built yet" stub, not a functional contextual graph: a project-
 * scoped Knowledge Map (filtered to this project's own claims and works) is
 * deferred to a later integration stage. This route exists so the persistent
 * nav's "Knowledge Map" tab is a real route with real content rather than a
 * dead link, and links out to the existing, unmodified global `/graph` route
 * (`graph/**`, outside this lane's ownership).
 */
export default async function ResearchProjectGraphPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();

  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-labelledby="research-graph-title">
      <ResearchBreadcrumb
        items={[
          { label: "Research", href: "/research" },
          { label: project.title, href: `/research/${projectId}` },
          { label: "Knowledge Map" },
        ]}
      />
      <h1 id="research-graph-title" className="mt-1 font-serif text-2xl font-semibold">Knowledge Map</h1>
      <p className="app-empty app-mount mt-6 max-w-2xl rounded p-3 text-sm text-[var(--color-text-muted)]">
        A Knowledge Map scoped to this project&apos;s own claims and works is planned for a later integration
        stage. Open the full Knowledge Map below.
      </p>
      <Link href="/graph" className="app-control app-press mt-4 inline-block min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-sm font-medium underline">
        Open the full Knowledge Map
      </Link>
    </section>
  );
}
