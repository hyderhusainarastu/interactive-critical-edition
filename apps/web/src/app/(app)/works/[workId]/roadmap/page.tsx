import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getUserReaderLevel } from "@/lib/readerLevel";
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

  // Default the roadmap's level to the reader level chosen at onboarding
  // (plan §34.4 9.4); "research" (full view) when the reader never chose one.
  const readerLevel = await getUserReaderLevel(session.user.id);

  return <RoadmapView workId={workId} title={doc.title} initialReaderLevel={readerLevel ?? "research"} />;
}
