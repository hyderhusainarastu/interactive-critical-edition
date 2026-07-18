import { notFound } from "next/navigation";
import type { Expertise } from "@ice/roadmap";
import { requireSession } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import { getOwnedDocument } from "@/lib/works";
import { RoadmapView } from "./RoadmapView";

export default async function RoadmapPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;

  const doc = await getOwnedDocument(workId, session.user.id);
  if (!doc) notFound();

  // Default the roadmap's level to the expertise chosen at onboarding.
  const prefs = await getUserPreferences(session.user.id);
  const initialExpertise = (prefs.expertise as Expertise | undefined) ?? "advanced";

  return <RoadmapView workId={workId} title={doc.title} initialExpertise={initialExpertise} />;
}
