import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
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

  return <RoadmapView workId={workId} title={doc.title} />;
}
