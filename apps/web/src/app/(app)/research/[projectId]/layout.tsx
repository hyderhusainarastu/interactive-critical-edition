import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { ResearchProjectNav } from "@/components/research/ResearchProjectNav";
import { requireSession } from "@/lib/auth";
import { getOwnedResearchProject } from "@/lib/research/projects";

/**
 * Wraps every route nested under `/research/[projectId]` (stage5-research-spec.md
 * §2.1) with the persistent project subnav. Purely additive: no existing
 * page's own markup changes because of this layout — no breadcrumb, no
 * heading, no page chrome here, just the nav above `{children}`. Existing
 * per-page `phase25FeatureEnabled("research")`/ownership guards are left in
 * place (Next always runs `layout.tsx` before the child `page.tsx`, so those
 * checks become unreachable dead code, not incorrect code, once this layout
 * is in place — removing them is a separate, purely cosmetic change outside
 * this step's scope).
 */
export default async function ResearchProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const monitoringEnabled = phase25FeatureEnabled("monitoring");

  return (
    <>
      <ResearchProjectNav projectId={project.id} monitoringEnabled={monitoringEnabled} />
      {children}
    </>
  );
}
