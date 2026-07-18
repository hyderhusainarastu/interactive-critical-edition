import { notFound } from "next/navigation";
import { GraphView } from "@/components/graph/GraphView";
import { requireSession } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

export default async function WorkGraphPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;
  const doc = await getOwnedDocument(workId, session.user.id);
  if (!doc) notFound();

  return (
    <GraphView endpoint={`/api/works/${workId}/graph`} backHref={`/works/${workId}`} backLabel={doc.title} />
  );
}
