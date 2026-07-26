import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { ResearchClaimsTable } from "@/components/research/ResearchClaimsTable";
import { requireSession } from "@/lib/auth";
import { listResearchClaimNaturesInUse, listResearchClaims } from "@/lib/research/claims";
import { getOwnedResearchProject, listResearchProjectMembers } from "@/lib/research/projects";

export default async function ResearchProjectClaimsPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const [initial, naturesInUse, members] = await Promise.all([
    listResearchClaims(session.user.id, projectId, {}, { page: 1 }),
    listResearchClaimNaturesInUse(session.user.id, projectId),
    listResearchProjectMembers(projectId),
  ]);
  const memberWorks = members.filter((m) => m.workId && m.workTitle).map((m) => ({ id: m.workId as string, title: m.workTitle as string }));
  return <ResearchClaimsTable project={project} initial={initial} naturesInUse={naturesInUse} memberWorks={memberWorks} />;
}
