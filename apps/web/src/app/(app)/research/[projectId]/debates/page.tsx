import { phase25FeatureEnabled } from "@ice/config";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResearchBreadcrumb } from "@/components/research/ResearchBreadcrumb";
import { requireSession } from "@/lib/auth";
import { listDebateClustersForProject } from "@/lib/research/debates";
import { getOwnedResearchProject } from "@/lib/research/projects";

export default async function ResearchDebatesPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const clusters = await listDebateClustersForProject(session.user.id, projectId);

  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-labelledby="research-debates-title">
      <ResearchBreadcrumb items={[{ label: "Research", href: "/research" }, { label: project.title, href: `/research/${projectId}` }, { label: "Debates" }]} />
      <h1 id="research-debates-title" className="mt-1 font-serif text-2xl font-semibold">Debates</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
        Clusters of connected claims — support, contradiction, and nuance relationships grouped into named debates.
      </p>

      <ul className="app-reveal-stagger mt-6 space-y-2" aria-label="Debate clusters">
        {clusters.map((cluster) => (
          <li key={cluster.id} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
            <Link href={`/research/${projectId}/debates/${cluster.id}`} className="font-medium underline">{cluster.name}</Link>
            {cluster.researchQuestion && <p className="mt-1 text-[var(--color-text-muted)]">{cluster.researchQuestion}</p>}
            <p className="mt-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              {cluster.status === "active" ? "Active" : "Superseded membership"} · {cluster.edgeCount} relationship(s)
              {cluster.latestChamberId ? " · Chamber synthesized" : ""}
            </p>
          </li>
        ))}
        {!clusters.length && <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">No debates found yet — run relationship detection and clustering on this project first.</li>}
      </ul>
    </section>
  );
}
