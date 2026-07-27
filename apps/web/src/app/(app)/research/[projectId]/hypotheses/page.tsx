import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { ResearchHypothesesView } from "@/components/research/ResearchHypothesesView";
import { requireSession } from "@/lib/auth";
import { listResearchGaps, listResearchHypotheses } from "@/lib/research/hypotheses";
import { listResearchJobRequestsForProject } from "@/lib/research/jobs";
import { getOwnedResearchProject } from "@/lib/research/projects";

export default async function ResearchProjectHypothesesPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const [hypotheses, gaps, jobRequests] = await Promise.all([
    listResearchHypotheses(session.user.id, projectId),
    listResearchGaps(session.user.id, projectId),
    listResearchJobRequestsForProject(session.user.id, projectId),
  ]);
  // Item 1 (owner-reported scope addition, honest zero-result explanations):
  // the most recently completed `generate_hypotheses` run's own note is the
  // only record of WHY a run produced zero — see
  // `lib/research/hypothesesNote.ts`'s doc comment.
  const latestCompletedGenerateHypothesesNote =
    jobRequests.find((r) => r.jobType === "generate_hypotheses" && r.status === "complete")?.note ?? null;
  return (
    <ResearchHypothesesView
      project={project}
      initialHypotheses={hypotheses}
      initialGaps={gaps}
      latestCompletedNote={latestCompletedGenerateHypothesesNote}
    />
  );
}
