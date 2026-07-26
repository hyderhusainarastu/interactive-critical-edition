import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { DebateClusterDetail } from "@/components/research/DebateClusterDetail";
import { requireSession } from "@/lib/auth";
import { getDebateClusterDetail } from "@/lib/research/debates";

export default async function DebateClusterPage({ params }: { params: Promise<{ projectId: string; clusterId: string }> }) {
  if (!phase25FeatureEnabled("research")) notFound();
  const session = await requireSession();
  const { projectId, clusterId } = await params;
  const cluster = await getDebateClusterDetail(session.user.id, projectId, clusterId);
  if (!cluster) notFound();
  return <DebateClusterDetail cluster={cluster} />;
}
