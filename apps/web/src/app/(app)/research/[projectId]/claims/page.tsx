import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { ResearchClaimsTable } from "@/components/research/ResearchClaimsTable";
import { requireSession } from "@/lib/auth";
import { listResearchClaimNaturesInUse, listResearchClaims } from "@/lib/research/claims";
import { listResearchJobRequestsForProject } from "@/lib/research/jobs";
import { getOwnedResearchProject, listResearchProjectMembers } from "@/lib/research/projects";

const ACTIVE_STATUSES = new Set(["planned", "queued", "running"]);

export default async function ResearchProjectClaimsPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const [initial, naturesInUse, members, jobRequests] = await Promise.all([
    listResearchClaims(session.user.id, projectId, {}, { page: 1 }),
    listResearchClaimNaturesInUse(session.user.id, projectId),
    listResearchProjectMembers(projectId),
    listResearchJobRequestsForProject(session.user.id, projectId),
  ]);
  const memberWorks = members.filter((m) => m.workId && m.workTitle).map((m) => ({ id: m.workId as string, title: m.workTitle as string }));
  // Item 1(c): a running/queued `extract_claims` job dispatched from the
  // overview or Corpus page means this table's own list is about to change
  // — a "simple approach" poll-only-while-active, per the fix lane's own
  // wording, rather than this page dispatching or displaying jobs itself.
  const initialActiveExtractionJobs = jobRequests
    .filter((r) => r.jobType === "extract_claims" && ACTIVE_STATUSES.has(r.status))
    .map((r) => ({ id: r.id, status: r.status }));
  return (
    <ResearchClaimsTable
      project={project}
      initial={initial}
      naturesInUse={naturesInUse}
      memberWorks={memberWorks}
      initialActiveExtractionJobs={initialActiveExtractionJobs}
    />
  );
}
