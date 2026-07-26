import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { ResearchHypothesesView } from "@/components/research/ResearchHypothesesView";
import { requireSession } from "@/lib/auth";
import { listResearchGaps, listResearchHypotheses } from "@/lib/research/hypotheses";
import { getOwnedResearchProject } from "@/lib/research/projects";

export default async function ResearchProjectHypothesesPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const [hypotheses, gaps] = await Promise.all([
    listResearchHypotheses(session.user.id, projectId),
    listResearchGaps(session.user.id, projectId),
  ]);
  return <ResearchHypothesesView project={project} initialHypotheses={hypotheses} initialGaps={gaps} />;
}
