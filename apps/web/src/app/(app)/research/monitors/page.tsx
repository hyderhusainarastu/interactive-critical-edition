import { phase25FeatureEnabled } from "@ice/config";
import { notFound } from "next/navigation";
import { MonitorsView } from "@/components/research/MonitorsView";
import { requireSession } from "@/lib/auth";
import { listHitsForUser, listMonitorsForUser } from "@/lib/research/monitors";

/** Global monitors view — every monitor + hit the user owns, across all
 *  projects. `/research/[projectId]/monitors` is the project-scoped sibling. */
export default async function ResearchMonitorsPage() {
  if (!phase25FeatureEnabled("research") || !phase25FeatureEnabled("monitoring")) notFound();
  const session = await requireSession();
  const [monitors, hits] = await Promise.all([
    listMonitorsForUser(session.user.id),
    listHitsForUser(session.user.id),
  ]);
  return <MonitorsView initialMonitors={monitors} initialHits={hits} />;
}
