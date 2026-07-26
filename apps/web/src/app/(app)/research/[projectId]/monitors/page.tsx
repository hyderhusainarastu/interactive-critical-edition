import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { MonitorsView } from "@/components/research/MonitorsView";
import { requireSession } from "@/lib/auth";
import { listHitsForUser, listMonitorsForUser } from "@/lib/research/monitors";
import { getOwnedResearchProject } from "@/lib/research/projects";

export default async function ResearchProjectMonitorsPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!phase25FeatureEnabled("research") || !phase25FeatureEnabled("monitoring")) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const project = await getOwnedResearchProject(session.user.id, projectId, true);
  if (!project) notFound();
  const [monitors, hits] = await Promise.all([
    listMonitorsForUser(session.user.id, projectId),
    listHitsForUser(session.user.id, { projectId }),
  ]);
  return <MonitorsView project={project} initialMonitors={monitors} initialHits={hits} />;
}
