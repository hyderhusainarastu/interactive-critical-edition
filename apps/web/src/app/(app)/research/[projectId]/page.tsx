import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { ResearchProjectOverview } from "@/components/research/ResearchProjectOverview";
import { requireSession } from "@/lib/auth";
import { getResearchInsightFeed } from "@/lib/research/feed";
import { listResearchJobRequestsForProject } from "@/lib/research/jobs";
import { getResearchProjectDetail, listOwnedWorksForResearch } from "@/lib/research/projects";

export default async function ResearchProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const detail = await getResearchProjectDetail(session.user.id, projectId);
  if (!detail) notFound();
  const [availableWorks, feed, jobRequests] = await Promise.all([
    listOwnedWorksForResearch(session.user.id),
    getResearchInsightFeed(session.user.id, projectId),
    listResearchJobRequestsForProject(session.user.id, projectId),
  ]);
  return (
    <ResearchProjectOverview
      project={detail.project}
      initialQuestions={detail.questions}
      initialMembers={detail.members}
      availableWorks={availableWorks}
      initialFeed={feed}
      initialJobRequests={jobRequests}
    />
  );
}
