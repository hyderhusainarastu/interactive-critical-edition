import { phase25FeatureEnabled } from "@ice/config";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResearchBreadcrumb } from "@/components/research/ResearchBreadcrumb";
import { requireSession } from "@/lib/auth";
import { listEvidenceChambersForProject } from "@/lib/research/chambers";
import { getOwnedResearchProject } from "@/lib/research/projects";

/**
 * Project-level Evidence Chambers view (stage5-research-spec.md §3). A read-
 * only list over the already-existing, owner-scoped
 * `listEvidenceChambersForProject` query (built for the Phase 28.5 Writer
 * evidence panel, never called from a page before this) — no new query, no
 * new table. `/research/chambers/[chamberId]` itself is unchanged and lives
 * outside this route segment.
 */

const VERIFICATION_LABEL: Record<string, string> = {
  unreviewed: "Unreviewed",
  user_verified: "Verified",
  source_verified: "Source-verified",
  disputed: "Disputed",
  rejected: "Rejected",
};

export default async function ResearchChambersPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const chambers = await listEvidenceChambersForProject(session.user.id, projectId);

  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-labelledby="research-chambers-title">
      <ResearchBreadcrumb
        items={[
          { label: "Research", href: "/research" },
          { label: project.title, href: `/research/${projectId}` },
          { label: "Evidence Chambers" },
        ]}
      />
      <h1 id="research-chambers-title" className="mt-1 font-serif text-2xl font-semibold">Evidence Chambers</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
        A synthesized comparison of the positions in a debate: shared ground, the point of divergence, and what
        would resolve it.
      </p>

      <ul className="app-reveal-stagger mt-6 space-y-2" aria-label="Evidence chambers">
        {chambers.map((chamber) => (
          <li key={chamber.id} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
            <Link href={`/research/chambers/${chamber.id}`} className="font-medium underline">
              {chamber.question}
            </Link>
            <p className="mt-1 text-[var(--color-text-muted)]">{chamber.clusterName}</p>
            <p className="mt-2 flex flex-wrap gap-2">
              <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">
                {VERIFICATION_LABEL[chamber.verificationStatus] ?? chamber.verificationStatus}
              </span>
              {chamber.hidden && (
                <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">Hidden</span>
              )}
            </p>
          </li>
        ))}
        {!chambers.length && (
          <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">
            No evidence chambers yet — open a debate and synthesize one, or generate hypotheses that resolve to one.
          </li>
        )}
      </ul>
    </section>
  );
}
